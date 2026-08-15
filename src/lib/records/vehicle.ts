import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { schema } from '@/db/client'
import { computeWarrantySnapshot, type WarrantySnapshot } from '@/lib/warranty'
import { reconcileOdometer } from '@/lib/odometer/reconcile'
import { withUserScope } from '@/db/scoped'
import {
  predictWorstCorner, predictWear, TIRE_THRESHOLDS, BRAKE_THRESHOLDS,
  type InspectionSnapshot, type WearPrediction, type WearReading,
} from '@/lib/prep-sheet'

/**
 * The vehicle record.
 *
 * Where the customer record answers "who is this", this answers "what has this
 * car been through, what does it still have coverage for, and what is wearing
 * out". The wear trends are the part no DMS gives you.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export interface VehicleRecord {
  id: string
  vin: string
  vinValid: boolean
  label: string
  make: string
  model: string | null
  modelYear: number
  trim: string | null
  bodyClass: string | null
  fuelType: string | null
  isHybridOrEv: boolean
  licensePlate: string | null
  inServiceDate: Date | null
  /**
   * The odometer this record is reasoned from.
   *
   * Reconciled against the vehicle's own reading history, so it is not always
   * the number on the vehicle row — see `odometerNote`, which is set precisely
   * when the two disagree.
   */
  currentMileage: number | null
  /** Set when the vehicle row's odometer was contradicted by its own history. */
  odometerNote: string | null
  avgMilesPerDay: number | null

  owner: { id: string; name: string; isOriginalOwner: boolean; soldByStore: boolean } | null
  warranty: WarrantySnapshot

  contracts: {
    id: string
    productType: string
    adminCompany: string
    contractNumber: string | null
    coverageTier: string | null
    tierType: string
    deductibleAmount: number
    termMonths: number | null
    termMiles: number | null
    purchaseDate: Date
    requiresPriorAuthorization: boolean
    claimPhone: string | null
    source: string
    verifiedAt: Date | null
  }[]
  entitlements: {
    label: string
    totalAllowed: number
    used: number
    remaining: number
    expiresOn: Date | null
  }[]

  serviceHistory: {
    id: string
    roNumber: string
    openedAt: Date
    mileageIn: number | null
    customerPayTotal: number
    lines: { description: string; payType: string; customerAmount: number }[]
  }[]

  openDeclines: {
    id: string
    description: string
    quotedAmount: number
    declinedAt: Date
    mileageAtDecline: number | null
  }[]

  recalls: {
    campaignNumber: string
    component: string | null
    summary: string | null
    isCandidate: boolean
    parkIt: boolean
  }[]

  /** Measurement trends — what makes wear prediction possible. */
  wear: {
    tires: { position: string; prediction: WearPrediction } | null
    brakes: WearPrediction | null
    /** Raw series for charting, oldest first. */
    treadSeries: { mileage: number; recordedAt: Date; byPosition: Record<string, number> }[]
  }

  /**
   * The same measurement history in the shape the wear chart consumes, so the
   * vehicle page and the drive prep sheet render one component rather than two.
   */
  inspectionHistory: InspectionSnapshot[]

  mileageHistory: { mileage: number; recordedAt: Date }[]
}

/**
 * One vehicle, everything known about it.
 *
 * Runs under the signed-in user's row-level security rather than the
 * privileged connection. The `storeId` filters below are still there and still
 * correct — RLS is underneath them, so a future edit that drops one returns
 * nothing instead of another dealership's vehicle.
 *
 * The queries below are written with Promise.all and now share one connection,
 * so they run in sequence. That is the cost of the guarantee; on a record page
 * it is worth it.
 */
export async function loadVehicleRecord(
  userId: string,
  storeId: string,
  vehicleId: string,
  asOf: Date = new Date(),
): Promise<VehicleRecord | null> {
  return withUserScope(userId, (db) => loadWithin(db, storeId, vehicleId, asOf))
}

async function loadWithin(
  db: Parameters<Parameters<typeof withUserScope>[1]>[0],
  storeId: string,
  vehicleId: string,
  asOf: Date,
): Promise<VehicleRecord | null> {

  const [vehicle] = await db
    .select()
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.storeId, storeId), eq(schema.vehicles.id, vehicleId)))
    .limit(1)
  if (!vehicle) return null

  const [ownership, contractRows, entitlementRows, roRows, declineRows, recallRows,
    inspectionRows, mileageRows] = await Promise.all([
    db.select().from(schema.customerVehicles).where(and(
      eq(schema.customerVehicles.vehicleId, vehicleId),
      eq(schema.customerVehicles.isCurrent, true),
    )).limit(1),
    db.select().from(schema.contracts).where(eq(schema.contracts.vehicleId, vehicleId)),
    db.select().from(schema.prepaidEntitlements)
      .where(eq(schema.prepaidEntitlements.vehicleId, vehicleId)),
    db.select().from(schema.repairOrders)
      .where(eq(schema.repairOrders.vehicleId, vehicleId))
      .orderBy(desc(schema.repairOrders.openedAt)),
    db.select().from(schema.declinedServices).where(and(
      eq(schema.declinedServices.vehicleId, vehicleId),
      isNull(schema.declinedServices.resolvedAt),
    )).orderBy(desc(schema.declinedServices.declinedAt)),
    db.select().from(schema.vehicleRecalls)
      .where(eq(schema.vehicleRecalls.vehicleId, vehicleId)),
    db.select().from(schema.inspections)
      .where(eq(schema.inspections.vehicleId, vehicleId))
      .orderBy(asc(schema.inspections.completedAt)),
    db.select().from(schema.mileageReadings)
      .where(eq(schema.mileageReadings.vehicleId, vehicleId))
      .orderBy(asc(schema.mileageReadings.recordedAt)),
  ])

  const [ownerRow, lineRows, inspectionItemRows] = await Promise.all([
    ownership[0]
      ? db.select().from(schema.customers).where(eq(schema.customers.id, ownership[0].customerId)).limit(1)
      : Promise.resolve([]),
    roRows.length
      ? db.select().from(schema.roLines).where(inArray(schema.roLines.repairOrderId, roRows.map((r) => r.id)))
      : Promise.resolve([]),
    inspectionRows.length
      ? db.select().from(schema.inspectionItems)
          .where(inArray(schema.inspectionItems.inspectionId, inspectionRows.map((i) => i.id)))
      : Promise.resolve([]),
  ])

  const linesByRo = new Map<string, typeof lineRows>()
  for (const line of lineRows) {
    linesByRo.set(line.repairOrderId, [...(linesByRo.get(line.repairOrderId) ?? []), line])
  }
  const itemsByInspection = new Map<string, typeof inspectionItemRows>()
  for (const item of inspectionItemRows) {
    itemsByInspection.set(item.inspectionId, [...(itemsByInspection.get(item.inspectionId) ?? []), item])
  }

  // ---- wear series ----
  const treadByPosition = new Map<string, WearReading[]>()
  const brakeReadings: WearReading[] = []
  const treadSeries: VehicleRecord['wear']['treadSeries'] = []
  const inspectionHistory: InspectionSnapshot[] = []

  for (const inspection of inspectionRows) {
    if (inspection.mileage === null) continue
    const recordedAt = inspection.completedAt ?? inspection.createdAt
    const byPosition: Record<string, number> = {}
    const snapshotItems: InspectionSnapshot['items'] = []

    for (const item of itemsByInspection.get(inspection.id) ?? []) {
      if (item.measurementValue === null) continue
      const value = num(item.measurementValue)
      const reading: WearReading = { mileage: inspection.mileage, value, recordedAt }
      snapshotItems.push({
        itemKey: item.itemKey,
        componentGroupKey: item.componentGroupKey,
        value,
        unit: item.measurementUnit,
        position: item.wheelPosition,
      })

      if (item.componentGroupKey === 'TIRES' && item.wheelPosition) {
        treadByPosition.set(item.wheelPosition, [
          ...(treadByPosition.get(item.wheelPosition) ?? []),
          reading,
        ])
        byPosition[item.wheelPosition] = value
      } else if (item.componentGroupKey === 'BRAKE_PADS_SHOES') {
        brakeReadings.push(reading)
      }
    }
    if (Object.keys(byPosition).length > 0) {
      treadSeries.push({ mileage: inspection.mileage, recordedAt, byPosition })
    }
    if (snapshotItems.length > 0) {
      inspectionHistory.push({ mileage: inspection.mileage, recordedAt, items: snapshotItems })
    }
  }

  /**
   * Reconcile the odometer before anything is decided from it.
   *
   * The same rule the drive uses, on stronger evidence: this page already loads
   * the vehicle's whole reading series, so a stale odometer on the vehicle row
   * is provable from the rows right next to it. Warranty is computed from the
   * result, because a vehicle row reading 50,000 while its own readings show
   * 92,000 would otherwise show factory coverage that expired 42,000 miles ago.
   */
  const odometer = reconcileOdometer(vehicle.currentMileage, [
    ...mileageRows.map((m) => ({
      mileage: m.mileage,
      source: 'an odometer reading',
      recordedAt: m.recordedAt,
    })),
    ...roRows.map((r) => ({
      mileage: r.mileageOut ?? r.mileageIn ?? 0,
      source: 'a closed repair order',
      recordedAt: r.closedAt ?? r.openedAt,
    })),
    ...declineRows.map((d) => ({
      mileage: d.mileageAtDecline ?? 0,
      source: 'work declined at an earlier visit',
      recordedAt: d.declinedAt,
    })),
  ])

  const warranty = computeWarrantySnapshot({
    make: vehicle.make,
    modelYear: vehicle.modelYear,
    inServiceDate: vehicle.inServiceDate ? new Date(vehicle.inServiceDate) : new Date(vehicle.modelYear, 0, 1),
    currentMileage: odometer.mileage,
    asOf,
    isOriginalOwner: ownership[0]?.isOriginalOwner ?? false,
    isHybridOrEv: vehicle.isHybridOrEv,
    state: 'TX',
  })

  const owner = ownerRow[0]
  const avgMilesPerDay = vehicle.avgMilesPerDay ? num(vehicle.avgMilesPerDay) : null

  return {
    id: vehicle.id,
    vin: vehicle.vin,
    vinValid: vehicle.vinValid,
    label: `${vehicle.modelYear} ${vehicle.make} ${vehicle.model ?? ''}`.trim(),
    make: vehicle.make,
    model: vehicle.model,
    modelYear: vehicle.modelYear,
    trim: vehicle.trim,
    bodyClass: vehicle.bodyClass,
    fuelType: vehicle.fuelType,
    isHybridOrEv: vehicle.isHybridOrEv,
    licensePlate: vehicle.licensePlate,
    inServiceDate: vehicle.inServiceDate ? new Date(vehicle.inServiceDate) : null,
    currentMileage: odometer.mileage,
    odometerNote: odometer.correction?.message ?? null,
    avgMilesPerDay,

    owner: owner
      ? {
          id: owner.id,
          name: [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.companyName || 'Unknown',
          isOriginalOwner: ownership[0]?.isOriginalOwner ?? false,
          soldByStore: ownership[0]?.soldByStore ?? false,
        }
      : null,

    warranty,

    contracts: contractRows.map((c) => ({
      id: c.id,
      productType: c.productType,
      adminCompany: c.adminCompany,
      contractNumber: c.contractNumber,
      coverageTier: c.coverageTier,
      tierType: c.tierType,
      deductibleAmount: num(c.deductibleAmount),
      termMonths: c.termMonths,
      termMiles: c.termMiles,
      purchaseDate: new Date(c.purchaseDate),
      requiresPriorAuthorization: c.requiresPriorAuthorization,
      claimPhone: c.claimPhone,
      source: c.source,
      verifiedAt: c.verifiedAt,
    })),

    entitlements: entitlementRows.map((e) => ({
      label: e.label,
      totalAllowed: e.totalAllowed,
      used: e.used,
      remaining: e.totalAllowed - e.used,
      expiresOn: e.expiresOn ? new Date(e.expiresOn) : null,
    })),

    serviceHistory: roRows.map((r) => ({
      id: r.id,
      roNumber: r.roNumber,
      openedAt: r.openedAt,
      mileageIn: r.mileageIn,
      customerPayTotal: num(r.customerPayTotal),
      lines: (linesByRo.get(r.id) ?? []).map((l) => ({
        description: l.description,
        payType: l.payType,
        customerAmount: num(l.customerAmount),
      })),
    })),

    openDeclines: declineRows.map((d) => ({
      id: d.id,
      description: d.description,
      quotedAmount: num(d.quotedAmount),
      declinedAt: d.declinedAt,
      mileageAtDecline: d.mileageAtDecline,
    })),

    recalls: recallRows.map((r) => ({
      campaignNumber: r.campaignNumber,
      component: r.component,
      summary: r.summary,
      isCandidate: r.isCandidate,
      parkIt: r.parkIt,
    })),

    inspectionHistory,
    wear: {
      tires: predictWorstCorner(treadByPosition, TIRE_THRESHOLDS, avgMilesPerDay),
      brakes: predictWear(brakeReadings, BRAKE_THRESHOLDS, avgMilesPerDay),
      treadSeries,
    },

    mileageHistory: mileageRows.map((m) => ({ mileage: m.mileage, recordedAt: m.recordedAt })),
  }
}
