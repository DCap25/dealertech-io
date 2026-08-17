import type { Contract, PrepaidEntitlement } from '@/lib/coverage'
import type { InspectionSnapshot, PrepSheetInput } from '@/lib/prep-sheet'
import { reconcileOdometer } from '@/lib/odometer/reconcile'
import type { PriceBook } from '@/lib/prep-sheet/pricing'
import type {
  DmsCoverage, DmsDriveBundle, DmsInspection, DmsPrepaidEntitlement, DmsServiceLine,
} from './types'

/**
 * DMS shapes to engine inputs.
 *
 * Pure and I/O-free, and the single place the translation happens. Every prep
 * sheet in the product is built from the output of this file, so it is worth
 * more tests than it looks like it needs.
 */

/** An empty pull result. Shared so every adapter returns the same shape. */
export function emptyBundle(): DmsDriveBundle {
  return {
    appointments: [],
    customers: [],
    vehicles: [],
    coverages: [],
    prepaidEntitlements: [],
    inspections: [],
    declinedServices: [],
    recalls: [],
    serviceLines: [],
    customerNotes: [],
  }
}

export interface StoreProfile {
  state?: string
  laborRate: number
}

function customerName(c: { firstName: string | null; lastName: string | null; companyName: string | null }): string {
  const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
  return person || c.companyName || 'Unknown'
}

/**
 * Vendor-neutral product name to the engine's vocabulary.
 *
 * PDR and DENT are the same product — the industry says "paintless dent
 * repair", the engine's taxonomy says DENT. Passing PDR through would enter
 * the coverage engine as a type it has never heard of and silently match
 * nothing, which reads as "not covered" for a product the customer owns.
 *
 * GAP and OTHER have no engine equivalent by design: neither ever pays for
 * service work, so they arbitrate to nothing while still being visible in the
 * ownership summary, which is exactly right.
 */
export function toEngineProductType(product: DmsCoverage['productType']): string {
  return product === 'PDR' ? 'DENT' : product
}

/**
 * A coverage product becomes a contract the engine can arbitrate.
 *
 * Component lists arrive empty from most DMS feeds; the engine falls back to
 * tier semantics, which is correct for an exclusionary contract and
 * conservative for an inclusionary one. Filling them with guesses here would
 * turn "we don't know" into a confident wrong answer about who pays.
 */
export function toContract(coverage: DmsCoverage): Contract {
  return {
    id: coverage.id,
    productType: toEngineProductType(coverage.productType),
    adminCompany: coverage.adminCompany,
    contractNumber: coverage.contractNumber ?? undefined,
    purchaseDate: coverage.purchaseDate,
    purchaseMileage: coverage.purchaseMileage ?? undefined,
    termMonths: coverage.termMonths,
    termMiles: coverage.termMiles,
    expirationDate: coverage.expirationDate ?? undefined,
    expirationMiles: coverage.expirationMiles ?? undefined,
    deductibleAmount: coverage.deductibleAmount,
    deductibleType: coverage.deductibleType,
    coverageTier: coverage.coverageTier ?? undefined,
    tierType: coverage.tierType,
    coveredComponentGroups: coverage.coveredComponentGroups,
    excludedComponentGroups: coverage.excludedComponentGroups,
    requiresPriorAuthorization: coverage.requiresPriorAuthorization,
    claimPhone: coverage.claimPhone ?? undefined,
    // Anything not currently in force is EXPIRED to the engine. Cancelled and
    // lapsed differ commercially but not for "who pays for this repair today".
    status: coverage.status === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED',
    minimumTreadDepth32nds: coverage.minimumTreadDepth32nds ?? undefined,
    perTireLimit: coverage.perTireLimit ?? undefined,
    source: coverage.source,
    verifiedAt: coverage.verifiedAt ?? undefined,
  } as Contract
}

export function toPrepaidEntitlement(
  e: DmsPrepaidEntitlement,
): PrepaidEntitlement & { label: string } {
  return {
    contractId: e.contractId,
    componentGroupKey: e.componentGroupKey,
    label: e.label,
    totalAllowed: e.totalAllowed,
    used: e.used,
    expiresOn: e.expiresOn ?? undefined,
  } as PrepaidEntitlement & { label: string }
}

/** Inspections without an odometer are unusable for wear prediction. */
export function toInspectionSnapshots(inspections: DmsInspection[]): InspectionSnapshot[] {
  return inspections
    .filter((i) => i.mileage !== null)
    .map((i) => ({
      mileage: i.mileage as number,
      recordedAt: i.recordedAt,
      items: i.items.map((item) => ({
        itemKey: item.itemKey,
        componentGroupKey: item.componentGroupKey,
        value: item.value,
        unit: item.unit,
        position: item.position,
      })),
    }))
}

/**
 * Highest odometer at which each component group was last serviced.
 *
 * Highest rather than most recent by date, because odometer is the axis
 * maintenance intervals are measured on and a back-dated RO would otherwise
 * pull the figure backwards.
 */
export function lastServiceMileageByGroup(lines: DmsServiceLine[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of lines) {
    if (!line.componentGroupKey || line.mileage === null) continue
    const current = out[line.componentGroupKey] ?? 0
    if (line.mileage > current) out[line.componentGroupKey] = line.mileage
  }
  return out
}

function indexBy<T, K extends string>(rows: T[], key: (row: T) => K | null | undefined): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    if (!k) continue
    const existing = out.get(k)
    if (existing) existing.push(row)
    else out.set(k, [row])
  }
  return out
}

/**
 * Turn a pulled bundle into one engine input per appointment.
 *
 * Appointments missing a customer or vehicle are dropped rather than faked.
 * They exist in every real DMS — a walk-in keyed before the vehicle is
 * decoded, a cancelled booking — and there is no honest prep sheet to build
 * from one.
 */
export function toPrepSheetInputs(
  bundle: DmsDriveBundle,
  store: StoreProfile,
  asOf: Date,
  priceBook?: PriceBook,
): PrepSheetInput[] {
  const customerById = new Map(bundle.customers.map((c) => [c.id, c]))
  const vehicleById = new Map(bundle.vehicles.map((v) => [v.id, v]))

  const coveragesByVehicle = indexBy(bundle.coverages, (c) => c.vehicleId)
  const entitlementsByVehicle = indexBy(bundle.prepaidEntitlements, (e) => e.vehicleId)
  const inspectionsByVehicle = indexBy(bundle.inspections, (i) => i.vehicleId)
  const declinesByVehicle = indexBy(bundle.declinedServices, (d) => d.vehicleId)
  const recallsByVehicle = indexBy(bundle.recalls, (r) => r.vehicleId)
  const linesByVehicle = indexBy(bundle.serviceLines, (l) => l.vehicleId)
  const notesByCustomer = indexBy(bundle.customerNotes, (n) => n.customerId)

  const inputs: PrepSheetInput[] = []

  for (const appointment of bundle.appointments) {
    const vehicle = appointment.vehicleId ? vehicleById.get(appointment.vehicleId) : undefined
    const customer = appointment.customerId ? customerById.get(appointment.customerId) : undefined
    if (!vehicle || !customer) continue

    /**
     * Check the vehicle record's odometer against the rest of the payload.
     *
     * There is no advisor in an import to ask, but there is usually evidence:
     * a bundle claiming 50,000 miles while carrying an inspection taken at
     * 92,000 has already told us which number is wrong. See reconcileOdometer
     * for why the higher figure wins.
     */
    const odometer = reconcileOdometer(vehicle.currentMileage, [
      ...(inspectionsByVehicle.get(vehicle.id) ?? []).map((i) => ({
        mileage: i.mileage ?? 0,
        source: 'an inspection',
        recordedAt: i.recordedAt,
      })),
      ...(linesByVehicle.get(vehicle.id) ?? []).map((l) => ({
        mileage: l.mileage ?? 0,
        source: 'a closed repair order',
        recordedAt: l.closedAt,
      })),
      ...(declinesByVehicle.get(vehicle.id) ?? []).map((d) => ({
        mileage: d.mileageAtDecline ?? 0,
        source: 'work declined at an earlier visit',
        recordedAt: d.declinedAt,
      })),
    ])

    inputs.push({
      asOf,
      store,
      customer: {
        id: customer.id,
        name: customerName(customer),
        visitCount: customer.visitCount,
        lifetimeSpend: customer.lifetimeSpend,
        lastVisitAt: customer.lastVisitAt,
        preferredChannel: customer.preferredChannel,
        pinnedNotes: (notesByCustomer.get(customer.id) ?? [])
          .filter((n) => n.isPinned)
          .map((n) => n.body),
      },
      vehicle: {
        id: vehicle.id,
        vin: vehicle.vin,
        make: vehicle.make,
        model: vehicle.model,
        modelYear: vehicle.modelYear,
        inServiceDate: vehicle.inServiceDate,
        currentMileage: odometer.mileage,
        avgMilesPerDay: vehicle.avgMilesPerDay,
        isHybridOrEv: vehicle.isHybridOrEv,
        isFullyElectric: vehicle.isFullyElectric,
        driveType: vehicle.driveType,
        isOriginalOwner: vehicle.isOriginalOwner,
      },
      odometerNote: odometer.correction?.message,
      priceBook,
      appointment: {
        id: appointment.id,
        scheduledAt: appointment.scheduledAt,
        promisedAt: appointment.promisedAt,
        transportType: appointment.transportType,
        concerns: appointment.customerConcerns,
        advisorName: appointment.advisorName,
      },
      contracts: (coveragesByVehicle.get(vehicle.id) ?? []).map(toContract),
      prepaidEntitlements: (entitlementsByVehicle.get(vehicle.id) ?? []).map(toPrepaidEntitlement),
      openDeclines: (declinesByVehicle.get(vehicle.id) ?? [])
        .filter((d) => d.resolvedAt === null)
        .map((d) => ({
          id: d.id,
          description: d.description,
          componentGroupKey: d.componentGroupKey,
          quotedAmount: d.quotedAmount,
          // Carried so the engine re-prices the work rather than re-offering
          // the figure on the old repair order.
          opCode: d.opCode ?? null,
          declinedAt: d.declinedAt,
          mileageAtDecline: d.mileageAtDecline,
        })),
      inspectionHistory: toInspectionSnapshots(inspectionsByVehicle.get(vehicle.id) ?? []),
      openRecalls: (recallsByVehicle.get(vehicle.id) ?? []).map((r) => ({
        campaignNumber: r.campaignNumber,
        componentGroupKeys: r.componentGroupKeys,
        description: r.description,
        isCandidate: r.isCandidate,
        parkIt: r.parkIt,
        parkOutside: r.parkOutside,
      })),
      lastServiceMileageByGroup: lastServiceMileageByGroup(linesByVehicle.get(vehicle.id) ?? []),
    })
  }

  return inputs
}
