import 'server-only'
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { buildPrepSheet } from './build'
import type { InspectionSnapshot, PrepSheet, PrepSheetInput } from './types'
import type { Contract, PrepaidEntitlement } from '@/lib/coverage'

/**
 * Loads everything the opportunity engine needs for a day's drive.
 *
 * Batched by entity rather than per appointment: the alternative is roughly
 * seven queries per car, which on a 40-RO Saturday is 280 round trips before
 * the advisor sees anything.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export async function loadDriveDay(
  storeId: string,
  day: Date,
  asOf: Date = new Date(),
): Promise<PrepSheet[]> {
  const db = getDb()
  const from = startOfDay(day)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  const appointments = await db
    .select()
    .from(schema.appointments)
    .where(and(
      eq(schema.appointments.storeId, storeId),
      gte(schema.appointments.scheduledAt, from),
      lt(schema.appointments.scheduledAt, to),
    ))
    .orderBy(schema.appointments.scheduledAt)

  if (appointments.length === 0) return []

  const vehicleIds = [...new Set(appointments.map((a) => a.vehicleId).filter((v): v is string => !!v))]
  const customerIds = [...new Set(appointments.map((a) => a.customerId).filter((v): v is string => !!v))]
  const advisorIds = [...new Set(appointments.map((a) => a.advisorId).filter((v): v is string => !!v))]
  if (vehicleIds.length === 0 || customerIds.length === 0) return []

  const [
    vehicles, customers, advisors, contractRows, entitlementRows,
    declineRows, inspectionRows, recallRows, noteRows, historyLines,
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
    // Last odometer at which each maintenance group was performed.
    db.select({
      vehicleId: schema.repairOrders.vehicleId,
      componentGroupKey: schema.roLines.componentGroupKey,
      mileage: schema.repairOrders.mileageIn,
    })
      .from(schema.roLines)
      .innerJoin(schema.repairOrders, eq(schema.roLines.repairOrderId, schema.repairOrders.id))
      .where(inArray(schema.repairOrders.vehicleId, vehicleIds)),
  ])

  const inspectionIds = inspectionRows.map((i) => i.id)
  const inspectionItems = inspectionIds.length
    ? await db.select().from(schema.inspectionItems)
        .where(inArray(schema.inspectionItems.inspectionId, inspectionIds))
    : []

  // ---- index everything by the id we'll look it up with ----
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const advisorById = new Map(advisors.map((u) => [u.id, u]))

  const groupBy = <T, K extends string>(rows: T[], key: (row: T) => K | null | undefined) => {
    const out = new Map<K, T[]>()
    for (const row of rows) {
      const k = key(row)
      if (!k) continue
      out.set(k, [...(out.get(k) ?? []), row])
    }
    return out
  }

  const contractsByVehicle = groupBy(contractRows, (r) => r.vehicleId)
  const entitlementsByVehicle = groupBy(entitlementRows, (r) => r.vehicleId)
  const declinesByVehicle = groupBy(declineRows, (r) => r.vehicleId)
  const inspectionsByVehicle = groupBy(inspectionRows, (r) => r.vehicleId)
  const recallsByVehicle = groupBy(recallRows, (r) => r.vehicleId)
  const notesByCustomer = groupBy(noteRows, (r) => r.customerId)
  const itemsByInspection = groupBy(inspectionItems, (r) => r.inspectionId)

  const lastServiceByVehicle = new Map<string, Record<string, number>>()
  for (const line of historyLines) {
    if (!line.componentGroupKey || line.mileage === null) continue
    const existing = lastServiceByVehicle.get(line.vehicleId) ?? {}
    const current = existing[line.componentGroupKey] ?? 0
    if (line.mileage > current) existing[line.componentGroupKey] = line.mileage
    lastServiceByVehicle.set(line.vehicleId, existing)
  }

  // ---- build one sheet per appointment ----
  const sheets: PrepSheet[] = []
  for (const appointment of appointments) {
    const vehicle = appointment.vehicleId ? vehicleById.get(appointment.vehicleId) : undefined
    const customer = appointment.customerId ? customerById.get(appointment.customerId) : undefined
    if (!vehicle || !customer) continue

    const contracts: Contract[] = (contractsByVehicle.get(vehicle.id) ?? []).map((c) => ({
      id: c.id,
      productType: c.productType,
      adminCompany: c.adminCompany,
      contractNumber: c.contractNumber ?? undefined,
      purchaseDate: new Date(c.purchaseDate),
      purchaseMileage: c.purchaseMileage ?? undefined,
      termMonths: c.termMonths,
      termMiles: c.termMiles,
      expirationDate: c.expirationDate ? new Date(c.expirationDate) : undefined,
      expirationMiles: c.expirationMiles ?? undefined,
      deductibleAmount: num(c.deductibleAmount),
      deductibleType: c.deductibleType,
      coverageTier: c.coverageTier ?? undefined,
      tierType: c.tierType,
      // Coverage items are loaded lazily; the engine falls back to tier
      // semantics with an empty list, which is correct for an exclusionary
      // contract and conservative for an inclusionary one.
      coveredComponentGroups: [],
      excludedComponentGroups: [],
      requiresPriorAuthorization: c.requiresPriorAuthorization,
      claimPhone: c.claimPhone ?? undefined,
      status: c.status === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED',
      minimumTreadDepth32nds: c.minimumTreadDepth32nds ?? undefined,
      perTireLimit: c.perTireLimit ? num(c.perTireLimit) : undefined,
      source: c.source,
      extractionConfidence: c.extractionConfidence ?? undefined,
      verifiedAt: c.verifiedAt ?? undefined,
    }))

    const prepaidEntitlements: (PrepaidEntitlement & { label: string })[] =
      (entitlementsByVehicle.get(vehicle.id) ?? []).map((e) => ({
        contractId: e.contractId,
        componentGroupKey: e.componentGroupKey,
        label: e.label,
        totalAllowed: e.totalAllowed,
        used: e.used,
        expiresOn: e.expiresOn ? new Date(e.expiresOn) : undefined,
      }))

    const inspectionHistory: InspectionSnapshot[] = (inspectionsByVehicle.get(vehicle.id) ?? [])
      .filter((i) => i.mileage !== null)
      .map((i) => ({
        mileage: i.mileage as number,
        recordedAt: i.completedAt ?? i.createdAt,
        items: (itemsByInspection.get(i.id) ?? []).map((item) => ({
          itemKey: item.itemKey,
          componentGroupKey: item.componentGroupKey,
          value: item.measurementValue === null ? null : num(item.measurementValue),
          unit: item.measurementUnit,
          position: item.wheelPosition,
        })),
      }))

    const input: PrepSheetInput = {
      asOf,
      store: { state: 'TX', laborRate: 185 },
      customer: {
        id: customer.id,
        name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName || 'Unknown',
        visitCount: customer.visitCount,
        lifetimeSpend: num(customer.lifetimeSpend),
        lastVisitAt: customer.lastVisitAt,
        preferredChannel: customer.preferredChannel,
        pinnedNotes: (notesByCustomer.get(customer.id) ?? []).map((n) => n.body),
      },
      vehicle: {
        id: vehicle.id,
        vin: vehicle.vin,
        make: vehicle.make,
        model: vehicle.model,
        modelYear: vehicle.modelYear,
        inServiceDate: vehicle.inServiceDate ? new Date(vehicle.inServiceDate) : null,
        currentMileage: vehicle.currentMileage ?? 0,
        avgMilesPerDay: vehicle.avgMilesPerDay ? num(vehicle.avgMilesPerDay) : null,
        isHybridOrEv: vehicle.isHybridOrEv,
        isOriginalOwner: true,
      },
      appointment: {
        id: appointment.id,
        scheduledAt: appointment.scheduledAt,
        promisedAt: appointment.promisedAt,
        transportType: appointment.transportType,
        concerns: appointment.customerConcerns,
        advisorName: appointment.advisorId
          ? advisorById.get(appointment.advisorId)?.fullName ?? null
          : null,
      },
      contracts,
      prepaidEntitlements,
      openDeclines: (declinesByVehicle.get(vehicle.id) ?? []).map((d) => ({
        id: d.id,
        description: d.description,
        componentGroupKey: d.componentGroupKey,
        quotedAmount: num(d.quotedAmount),
        declinedAt: d.declinedAt,
        mileageAtDecline: d.mileageAtDecline,
      })),
      inspectionHistory,
      openRecalls: (recallsByVehicle.get(vehicle.id) ?? []).map((r) => ({
        campaignNumber: r.campaignNumber,
        componentGroupKeys: r.componentGroupKeys ? (JSON.parse(r.componentGroupKeys) as string[]) : [],
        description: r.summary ?? '',
        isCandidate: r.isCandidate,
        parkIt: r.parkIt,
        parkOutside: r.parkOutside,
      })),
      lastServiceMileageByGroup: lastServiceByVehicle.get(vehicle.id),
    }

    sheets.push(buildPrepSheet(input))
  }

  return sheets
}

/** The store to show when no tenant has been selected yet. */
export async function getDefaultStore() {
  const db = getDb()
  const [store] = await db.select().from(schema.stores).limit(1)
  return store
}
