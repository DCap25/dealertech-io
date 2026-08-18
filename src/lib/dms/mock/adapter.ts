import 'server-only'
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import type { DmsAdapter } from '../adapter'
import type {
  DateRange, DmsCapabilities, DmsCoverage, DmsCoverageProduct, DmsCustomer, DmsDeclinedService,
  DmsDriveBundle, DmsPriceBookEntry, DmsPushResult, DmsVehicle, DmsVehicleDetail,
  FollowUpOutcomePayload, HandOffPayload,
} from '../types'
import { emptyBundle } from '../map'
import { applyCoverageScenario, isCoverageScenario, type CoverageScenario } from './scenarios'

/**
 * Mock DMS.
 *
 * Backed by the seeded Postgres rather than by a fixture file, which is a
 * deliberate choice: the demo data is already a realistic dealership, and an
 * adapter reading it means every existing surface keeps working while now
 * going through the interface. A hand-written fixture would drift from the
 * seed within a week and quietly stop representing anything.
 *
 * It is still a *mock*: reads are deterministic for a given seed and date,
 * coverage can be overlaid with a scenario, and pushes go to an in-memory log
 * instead of anywhere real.
 */

const CAPABILITIES: DmsCapabilities = {
  vendor: 'Mock',
  canPullAppointments: true,
  canPullCoverages: true,
  canPullInspections: true,
  canPullServiceHistory: true,
  canPullPriceBook: true,
  canPushHandOff: true,
  canPushFollowUpOutcome: true,
  // False here and on every adapter: DealerTech owns the book (DRIVE_PLAN D1),
  // and a booking reaches the DMS as part of the hand-off. The booking screen
  // reads this to say so plainly.
  canPushAppointment: false,
  // Honest: a real integration would set this true. Nothing here leaves the
  // process, and any UI that says "sent to your DMS" should read this first.
  writesArePersisted: false,
}

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Product types we model; anything else is carried through as OTHER. */
const KNOWN_PRODUCTS: DmsCoverageProduct[] = [
  'VSC', 'PPM', 'TIRE_WHEEL', 'PDR', 'WINDSHIELD', 'KEY', 'APPEARANCE', 'THEFT', 'GAP',
]

function toProduct(raw: string): DmsCoverageProduct {
  return (KNOWN_PRODUCTS as string[]).includes(raw) ? (raw as DmsCoverageProduct) : 'OTHER'
}

function toStatus(raw: string): DmsCoverage['status'] {
  if (raw === 'ACTIVE') return 'ACTIVE'
  if (raw === 'CANCELLED') return 'CANCELLED'
  return 'EXPIRED'
}

function mapCustomer(c: typeof schema.customers.$inferSelect): DmsCustomer {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    companyName: c.companyName,
    phone: c.mobilePhone ?? c.homePhone ?? null,
    email: c.email,
    preferredChannel: c.preferredChannel,
    doNotCall: c.doNotCall,
    smsConsent: c.smsConsent,
    visitCount: c.visitCount,
    lifetimeSpend: num(c.lifetimeSpend),
    lastVisitAt: c.lastVisitAt,
  }
}

function mapVehicle(
  v: typeof schema.vehicles.$inferSelect,
  customerId: string | null,
  isOriginalOwner: boolean,
): DmsVehicle {
  return {
    id: v.id,
    customerId,
    vin: v.vin,
    make: v.make,
    model: v.model,
    modelYear: v.modelYear,
    trim: v.trim,
    licensePlate: v.licensePlate,
    inServiceDate: v.inServiceDate ? new Date(v.inServiceDate) : null,
    currentMileage: v.currentMileage,
    avgMilesPerDay: v.avgMilesPerDay ? num(v.avgMilesPerDay) : null,
    isHybridOrEv: v.isHybridOrEv,
    // Fuel type is what the DMS actually records; 'Electric' is the signal
    // that there is no oil, no plugs and no induction service to sell.
    isFullyElectric: (v.fuelType ?? '').toLowerCase() === 'electric',
    driveType: normalizeDriveType(v.driveType),
    /**
     * Read from the ownership link, never assumed.
     *
     * Several OEM powertrain terms are original-owner-only — Hyundai, Kia and
     * Genesis 10yr/100k among them. Defaulting this to true would hand a
     * second owner five years of coverage they do not have, and the advisor
     * would find out when the claim was denied with the car on the lift.
     */
    isOriginalOwner,
  }
}

function mapCoverage(c: typeof schema.contracts.$inferSelect): DmsCoverage {
  return {
    id: c.id,
    vehicleId: c.vehicleId,
    customerId: c.customerId ?? null,
    productType: toProduct(c.productType),
    adminCompany: c.adminCompany,
    contractNumber: c.contractNumber,
    purchaseDate: new Date(c.purchaseDate),
    purchaseMileage: c.purchaseMileage,
    termMonths: c.termMonths,
    termMiles: c.termMiles,
    expirationDate: c.expirationDate ? new Date(c.expirationDate) : null,
    expirationMiles: c.expirationMiles,
    deductibleAmount: num(c.deductibleAmount),
    deductibleType: c.deductibleType,
    coverageTier: c.coverageTier,
    tierType: c.tierType === 'INCLUSIONARY' ? 'INCLUSIONARY' : 'EXCLUSIONARY',
    // The seed does not carry per-component lists; the engine falls back to
    // tier semantics, which is correct for exclusionary and conservative for
    // inclusionary. Inventing entries here would fabricate coverage.
    coveredComponentGroups: [],
    excludedComponentGroups: [],
    requiresPriorAuthorization: c.requiresPriorAuthorization,
    claimPhone: c.claimPhone,
    status: toStatus(c.status),
    minimumTreadDepth32nds: c.minimumTreadDepth32nds,
    perTireLimit: c.perTireLimit ? num(c.perTireLimit) : null,
    source: c.source,
    verifiedAt: c.verifiedAt,
  }
}

/**
 * The op code a real DMS would have written on the declined line.
 *
 * `declined_services.op_code` is nullable and every row the seed has ever
 * written predates it, so a mock that only passed the column through would make
 * every demo decline unpriceable — which is the fall-through, not the normal
 * case, and would hide the behaviour this exists to show.
 *
 * The seed builds each decline *from* one of the store's own operations, so the
 * component group names the code it came from. Groups with no honest answer are
 * left null on purpose: the price then falls back to the old quote, marked as an
 * estimate, and the customer is told the price is to be confirmed rather than
 * quoted a figure from a repair order two years old.
 */
const MOCK_DECLINE_OP_CODES: Record<string, string> = {
  // Front and rear brakes share this group and cost different money, which is
  // exactly why a group is not a price key. The seed only ever declines the
  // front job, so for mock data this one is not a guess.
  BRAKE_PADS_SHOES: 'BRK-FR',
  TIRES: 'TIRE4',
  WHEEL_ALIGNMENT: 'ALIGN',
  TRANS_FLUID_SERVICE: 'TRANS-SVC',
  SPARK_PLUGS: 'PLUGS',
  COOLANT_SERVICE: 'COOL-FL',
}

function mapDecline(d: typeof schema.declinedServices.$inferSelect): DmsDeclinedService {
  return {
    id: d.id,
    vehicleId: d.vehicleId,
    customerId: d.customerId,
    description: d.description,
    componentGroupKey: d.componentGroupKey,
    quotedAmount: num(d.quotedAmount),
    opCode: d.opCode
      ?? (d.componentGroupKey ? MOCK_DECLINE_OP_CODES[d.componentGroupKey] ?? null : null),
    declinedAt: d.declinedAt,
    mileageAtDecline: d.mileageAtDecline,
    resolvedAt: d.resolvedAt,
  }
}

/**
 * Pushes, kept in memory.
 *
 * Inspectable from tests and from a debug surface, so "did the hand-off go
 * anywhere" has an answer during development rather than a shrug.
 */
const pushLog: { at: Date; kind: 'HAND_OFF' | 'FOLLOW_UP'; payload: unknown }[] = []

export function mockPushLog(): readonly { at: Date; kind: string; payload: unknown }[] {
  return pushLog
}

export function clearMockPushLog(): void {
  pushLog.length = 0
}

function scenarioFromEnv(): CoverageScenario {
  const raw = process.env.DMS_MOCK_SCENARIO
  return isCoverageScenario(raw) ? raw : 'AS_SEEDED'
}

export class MockDmsAdapter implements DmsAdapter {
  readonly capabilities = CAPABILITIES

  constructor(private readonly scenario: CoverageScenario = scenarioFromEnv()) {}

  async pullDriveBundle(storeId: string, range: DateRange): Promise<DmsDriveBundle> {
    const db = getDb()

    const appointmentRows = await db
      .select()
      .from(schema.appointments)
      .where(and(
        eq(schema.appointments.storeId, storeId),
        gte(schema.appointments.scheduledAt, range.from),
        lt(schema.appointments.scheduledAt, range.to),
      ))
      .orderBy(schema.appointments.scheduledAt)

    if (appointmentRows.length === 0) return emptyBundle()

    const vehicleIds = [...new Set(appointmentRows.map((a) => a.vehicleId).filter(isId))]
    const customerIds = [...new Set(appointmentRows.map((a) => a.customerId).filter(isId))]
    const advisorIds = [...new Set(appointmentRows.map((a) => a.advisorId).filter(isId))]
    if (vehicleIds.length === 0 || customerIds.length === 0) return emptyBundle()

    const [
      vehicleRows, customerRows, advisorRows, coverageRows, entitlementRows,
      declineRows, inspectionRows, recallRows, noteRows, ownershipRows, lineRows,
    ] = await Promise.all([
      db.select().from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds)),
      db.select().from(schema.customers).where(inArray(schema.customers.id, customerIds)),
      advisorIds.length
        ? db.select().from(schema.users).where(inArray(schema.users.id, advisorIds))
        : Promise.resolve([]),
      db.select().from(schema.contracts).where(and(
        inArray(schema.contracts.vehicleId, vehicleIds),
        eq(schema.contracts.status, 'ACTIVE'),
      )),
      db.select().from(schema.prepaidEntitlements)
        .where(inArray(schema.prepaidEntitlements.vehicleId, vehicleIds)),
      db.select().from(schema.declinedServices).where(and(
        inArray(schema.declinedServices.vehicleId, vehicleIds),
        isNull(schema.declinedServices.resolvedAt),
      )),
      db.select().from(schema.inspections)
        .where(inArray(schema.inspections.vehicleId, vehicleIds))
        .orderBy(desc(schema.inspections.completedAt)),
      db.select().from(schema.vehicleRecalls).where(and(
        inArray(schema.vehicleRecalls.vehicleId, vehicleIds),
        isNull(schema.vehicleRecalls.completedAt),
      )),
      db.select().from(schema.customerNotes).where(and(
        inArray(schema.customerNotes.customerId, customerIds),
        eq(schema.customerNotes.isPinned, true),
      )),
      db.select({
        vehicleId: schema.customerVehicles.vehicleId,
        customerId: schema.customerVehicles.customerId,
        isOriginalOwner: schema.customerVehicles.isOriginalOwner,
      })
        .from(schema.customerVehicles)
        .where(and(
          inArray(schema.customerVehicles.vehicleId, vehicleIds),
          eq(schema.customerVehicles.isCurrent, true),
        )),
      db.select({
        repairOrderId: schema.roLines.repairOrderId,
        vehicleId: schema.repairOrders.vehicleId,
        componentGroupKey: schema.roLines.componentGroupKey,
        description: schema.roLines.description,
        mileage: schema.repairOrders.mileageIn,
        closedAt: schema.repairOrders.closedAt,
        payType: schema.roLines.payType,
        laborAmount: schema.roLines.laborAmount,
        partsAmount: schema.roLines.partsAmount,
        customerAmount: schema.roLines.customerAmount,
      })
        .from(schema.roLines)
        .innerJoin(schema.repairOrders, eq(schema.roLines.repairOrderId, schema.repairOrders.id))
        .where(inArray(schema.repairOrders.vehicleId, vehicleIds)),
    ])

    const inspectionIds = inspectionRows.map((i) => i.id)
    const itemRows = inspectionIds.length
      ? await db.select().from(schema.inspectionItems)
          .where(inArray(schema.inspectionItems.inspectionId, inspectionIds))
      : []

    const advisorNameById = new Map(advisorRows.map((u) => [u.id, u.fullName]))
    const customerIdByVehicle = new Map(
      appointmentRows
        .filter((a) => a.vehicleId && a.customerId)
        .map((a) => [a.vehicleId as string, a.customerId as string]),
    )
    const ownershipByVehicle = new Map(
      ownershipRows.map((o) => [o.vehicleId, o]),
    )

    const bundle: DmsDriveBundle = {
      appointments: appointmentRows.map((a) => ({
        id: a.id,
        customerId: a.customerId,
        vehicleId: a.vehicleId,
        advisorId: a.advisorId,
        advisorName: a.advisorId ? advisorNameById.get(a.advisorId) ?? null : null,
        scheduledAt: a.scheduledAt,
        promisedAt: a.promisedAt,
        transportType: a.transportType,
        status: a.status,
        customerConcerns: a.customerConcerns,
      })),
      customers: customerRows.map(mapCustomer),
      vehicles: vehicleRows.map((v) => {
        const ownership = ownershipByVehicle.get(v.id)
        return mapVehicle(
          v,
          ownership?.customerId ?? customerIdByVehicle.get(v.id) ?? null,
          ownership?.isOriginalOwner ?? false,
        )
      }),
      coverages: coverageRows.map(mapCoverage),
      prepaidEntitlements: entitlementRows.map((e) => ({
        vehicleId: e.vehicleId,
        contractId: e.contractId,
        componentGroupKey: e.componentGroupKey,
        label: e.label,
        totalAllowed: e.totalAllowed,
        used: e.used,
        expiresOn: e.expiresOn ? new Date(e.expiresOn) : null,
      })),
      inspections: inspectionRows.map((i) => ({
        id: i.id,
        vehicleId: i.vehicleId,
        mileage: i.mileage,
        recordedAt: i.completedAt ?? i.createdAt,
        items: itemRows
          .filter((item) => item.inspectionId === i.id)
          .map((item) => ({
            itemKey: item.itemKey,
            componentGroupKey: item.componentGroupKey,
            value: item.measurementValue === null ? null : num(item.measurementValue),
            unit: item.measurementUnit,
            position: item.wheelPosition,
          })),
      })),
      declinedServices: declineRows.map(mapDecline),
      recalls: recallRows.map((r) => ({
        vehicleId: r.vehicleId,
        campaignNumber: r.campaignNumber,
        description: r.summary ?? '',
        componentGroupKeys: r.componentGroupKeys
          ? (JSON.parse(r.componentGroupKeys) as string[])
          : [],
        isCandidate: r.isCandidate,
        parkIt: r.parkIt,
        parkOutside: r.parkOutside,
      })),
      serviceLines: lineRows.map((l) => ({
        repairOrderId: l.repairOrderId,
        vehicleId: l.vehicleId,
        componentGroupKey: l.componentGroupKey,
        description: l.description,
        mileage: l.mileage,
        closedAt: l.closedAt,
        payType: l.payType,
        amount: num(l.laborAmount) + num(l.partsAmount),
        customerAmount: num(l.customerAmount),
      })),
      customerNotes: noteRows.map((n) => ({
        customerId: n.customerId,
        body: n.body,
        isPinned: n.isPinned,
      })),
    }

    return applyCoverageScenario(bundle, this.scenario, range.from)
  }

  /**
   * The store's priced operations.
   *
   * Returns what is already on file, so a sync against the mock is a truthful
   * no-op: the pipeline runs end to end and reports nothing moved, which is
   * exactly what a morning with no price changes should look like.
   *
   * `DMS_PRICE_DRIFT` nudges a few prices so the sync has something to do —
   * for demonstrating the feature and for exercising the guards. Deliberately
   * opt-in: a mock that quietly changed prices every morning would make the
   * seeded demo unreproducible.
   */
  async pullPriceBook(storeId: string): Promise<DmsPriceBookEntry[] | null> {
    const rows = await getDb()
      .select()
      .from(schema.opCodes)
      .where(and(eq(schema.opCodes.storeId, storeId), eq(schema.opCodes.isActive, true)))
      // Ordered so the simulated drift below is reproducible. Without it the
      // row order varies between calls, so two runs bumped two different sets
      // of five codes and the demo data crept upward instead of settling.
      .orderBy(schema.opCodes.code)

    const drift = process.env.DMS_PRICE_DRIFT === '1'

    return rows.map((o, i) => {
      const labor = o.laborAmount === null ? null : num(o.laborAmount)
      const parts = o.partsAmount === null ? null : num(o.partsAmount)
      // Every fifth code up by 4%, rounded to the dollar the way a real book is.
      const bump = drift && i % 5 === 0
      return {
        code: o.code,
        description: o.description,
        laborHours: o.laborHours === null ? null : num(o.laborHours),
        laborAmount: bump && labor !== null ? Math.round(labor * 1.04) : labor,
        partsAmount: parts,
      }
    })
  }

  async pullVehicleDetail(storeId: string, vehicleId: string): Promise<DmsVehicleDetail | null> {
    const db = getDb()

    const [vehicle] = await db
      .select()
      .from(schema.vehicles)
      .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.storeId, storeId)))
      .limit(1)
    if (!vehicle) return null

    const [ownerLink] = await db
      .select({
        customerId: schema.customerVehicles.customerId,
        isOriginalOwner: schema.customerVehicles.isOriginalOwner,
      })
      .from(schema.customerVehicles)
      .where(and(
        eq(schema.customerVehicles.vehicleId, vehicleId),
        eq(schema.customerVehicles.isCurrent, true),
      ))
      .limit(1)

    const customerId = ownerLink?.customerId ?? null

    const [customerRows, coverageRows, entitlementRows, inspectionRows, declineRows, recallRows, lineRows] =
      await Promise.all([
        customerId
          ? db.select().from(schema.customers).where(eq(schema.customers.id, customerId)).limit(1)
          : Promise.resolve([]),
        db.select().from(schema.contracts).where(eq(schema.contracts.vehicleId, vehicleId)),
        db.select().from(schema.prepaidEntitlements)
          .where(eq(schema.prepaidEntitlements.vehicleId, vehicleId)),
        db.select().from(schema.inspections)
          .where(eq(schema.inspections.vehicleId, vehicleId))
          .orderBy(desc(schema.inspections.completedAt)),
        db.select().from(schema.declinedServices)
          .where(eq(schema.declinedServices.vehicleId, vehicleId)),
        db.select().from(schema.vehicleRecalls)
          .where(and(
            eq(schema.vehicleRecalls.vehicleId, vehicleId),
            isNull(schema.vehicleRecalls.completedAt),
          )),
        db.select({
          repairOrderId: schema.roLines.repairOrderId,
          vehicleId: schema.repairOrders.vehicleId,
          componentGroupKey: schema.roLines.componentGroupKey,
          description: schema.roLines.description,
          mileage: schema.repairOrders.mileageIn,
          closedAt: schema.repairOrders.closedAt,
          payType: schema.roLines.payType,
          laborAmount: schema.roLines.laborAmount,
          partsAmount: schema.roLines.partsAmount,
          customerAmount: schema.roLines.customerAmount,
        })
          .from(schema.roLines)
          .innerJoin(schema.repairOrders, eq(schema.roLines.repairOrderId, schema.repairOrders.id))
          .where(eq(schema.repairOrders.vehicleId, vehicleId)),
      ])

    const inspectionIds = inspectionRows.map((i) => i.id)
    const itemRows = inspectionIds.length
      ? await db.select().from(schema.inspectionItems)
          .where(inArray(schema.inspectionItems.inspectionId, inspectionIds))
      : []

    const customerRow = customerRows[0]

    return {
      vehicle: mapVehicle(vehicle, customerId, ownerLink?.isOriginalOwner ?? false),
      customer: customerRow ? mapCustomer(customerRow) : null,
      coverages: coverageRows.map(mapCoverage),
      prepaidEntitlements: entitlementRows.map((e) => ({
        vehicleId: e.vehicleId,
        contractId: e.contractId,
        componentGroupKey: e.componentGroupKey,
        label: e.label,
        totalAllowed: e.totalAllowed,
        used: e.used,
        expiresOn: e.expiresOn ? new Date(e.expiresOn) : null,
      })),
      inspections: inspectionRows.map((i) => ({
        id: i.id,
        vehicleId: i.vehicleId,
        mileage: i.mileage,
        recordedAt: i.completedAt ?? i.createdAt,
        items: itemRows
          .filter((item) => item.inspectionId === i.id)
          .map((item) => ({
            itemKey: item.itemKey,
            componentGroupKey: item.componentGroupKey,
            value: item.measurementValue === null ? null : num(item.measurementValue),
            unit: item.measurementUnit,
            position: item.wheelPosition,
          })),
      })),
      serviceLines: lineRows.map((l) => ({
        repairOrderId: l.repairOrderId,
        vehicleId: l.vehicleId,
        componentGroupKey: l.componentGroupKey,
        description: l.description,
        mileage: l.mileage,
        closedAt: l.closedAt,
        payType: l.payType,
        amount: num(l.laborAmount) + num(l.partsAmount),
        customerAmount: num(l.customerAmount),
      })),
      declinedServices: declineRows.map(mapDecline),
      recalls: recallRows.map((r) => ({
        vehicleId: r.vehicleId,
        campaignNumber: r.campaignNumber,
        description: r.summary ?? '',
        componentGroupKeys: r.componentGroupKeys
          ? (JSON.parse(r.componentGroupKeys) as string[])
          : [],
        isCandidate: r.isCandidate,
        parkIt: r.parkIt,
        parkOutside: r.parkOutside,
      })),
    }
  }

  async pullCoverages(storeId: string, vehicleId: string): Promise<DmsCoverage[]> {
    const detail = await this.pullVehicleDetail(storeId, vehicleId)
    return detail?.coverages ?? []
  }

  async pushHandOff(_storeId: string, payload: HandOffPayload): Promise<DmsPushResult> {
    pushLog.push({ at: new Date(), kind: 'HAND_OFF', payload })
    return {
      ok: true,
      externalRef: `mock-handoff-${pushLog.length}`,
      // Says plainly that nothing left the process. A mock that claims to have
      // written to a DMS is how a demo becomes a false promise in a pilot.
      message: `Recorded ${payload.accepted.length} approved line(s) to the mock DMS log. Nothing was sent to a real system.`,
    }
  }

  async pushFollowUpOutcome(
    _storeId: string,
    payload: FollowUpOutcomePayload,
  ): Promise<DmsPushResult> {
    pushLog.push({ at: new Date(), kind: 'FOLLOW_UP', payload })
    return {
      ok: true,
      externalRef: `mock-followup-${pushLog.length}`,
      message: `Recorded outcome ${payload.outcome} to the mock DMS log.`,
    }
  }
}

function isId(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * DMS records write drive type a dozen different ways.
 *
 * Anything unrecognised becomes null rather than a guess — a wrong driveline
 * puts a transfer case service on a front-wheel-drive car, which is the kind
 * of line an advisor has to delete in front of the customer.
 */
function normalizeDriveType(raw: string | null): 'FWD' | 'RWD' | 'AWD' | 'FOUR_WD' | null {
  if (!raw) return null
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (v === 'FWD' || v.includes('FRONT')) return 'FWD'
  if (v === 'RWD' || v.includes('REAR')) return 'RWD'
  if (v === 'AWD' || v.includes('ALLWHEEL')) return 'AWD'
  if (v === '4WD' || v === '4X4' || v === 'FOURWD' || v.includes('4WHEEL')) return 'FOUR_WD'
  return null
}
