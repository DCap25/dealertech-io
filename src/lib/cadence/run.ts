// Deliberately NOT marked `server-only`. This module runs both from server
// components and from the nightly CLI job, and the server-only guard throws
// outside a React Server Component context. It still cannot reach a browser:
// it imports the database client, which requires DATABASE_URL.
import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { generateCadenceTasks } from './generate'
import type { CadenceRule, CadenceVehicle, ExistingTask, GeneratedTask } from './types'
import type { Contract, PrepaidEntitlement } from '@/lib/coverage'

/**
 * Nightly cadence run.
 *
 * Loads the store's customers in one pass, generates tasks per customer, and
 * writes the new ones. Idempotent: re-running the same day produces nothing
 * new, because the cooldown check sees the tasks written on the first run.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export interface CadenceRunResult {
  customersEvaluated: number
  tasksCreated: number
  byTrigger: Record<string, number>
}

export async function runCadence(
  storeId: string,
  asOf: Date = new Date(),
  lookaheadDays = 7,
): Promise<CadenceRunResult> {
  const db = getDb()

  const [ruleRows, customerRows, vehicleRows, contractRows, entitlementRows,
    declineRows, recallRows, existingRows, upcomingAppointments, historyLines] =
    await Promise.all([
      db.select().from(schema.cadenceRules).where(eq(schema.cadenceRules.storeId, storeId)),
      db.select().from(schema.customers).where(eq(schema.customers.storeId, storeId)),
      db.select().from(schema.vehicles).where(eq(schema.vehicles.storeId, storeId)),
      db.select().from(schema.contracts).where(and(
        eq(schema.contracts.storeId, storeId),
        eq(schema.contracts.status, 'ACTIVE'),
      )),
      db.select().from(schema.prepaidEntitlements)
        .where(eq(schema.prepaidEntitlements.storeId, storeId)),
      db.select().from(schema.declinedServices).where(and(
        eq(schema.declinedServices.storeId, storeId),
        isNull(schema.declinedServices.resolvedAt),
      )),
      db.select().from(schema.vehicleRecalls).where(and(
        eq(schema.vehicleRecalls.storeId, storeId),
        isNull(schema.vehicleRecalls.completedAt),
      )),
      db.select({
        cadenceRuleId: schema.cadenceTasks.cadenceRuleId,
        customerId: schema.cadenceTasks.customerId,
        vehicleId: schema.cadenceTasks.vehicleId,
        sourceKey: schema.cadenceTasks.detail,
        createdAt: schema.cadenceTasks.createdAt,
        status: schema.cadenceTasks.status,
        title: schema.cadenceTasks.title,
      }).from(schema.cadenceTasks).where(eq(schema.cadenceTasks.storeId, storeId)),
      db.select().from(schema.appointments).where(and(
        eq(schema.appointments.storeId, storeId),
        gte(schema.appointments.scheduledAt, asOf),
      )),
      db.select({
        vehicleId: schema.repairOrders.vehicleId,
        componentGroupKey: schema.roLines.componentGroupKey,
        mileage: schema.repairOrders.mileageIn,
      })
        .from(schema.roLines)
        .innerJoin(schema.repairOrders, eq(schema.roLines.repairOrderId, schema.repairOrders.id))
        .where(eq(schema.roLines.storeId, storeId)),
    ])

  // Last closed RO per customer, for the post-visit triggers.
  //
  // Typed as string, not Date: `sql<Date>` is an assertion, not a conversion.
  // A raw aggregate comes back from Postgres as a string and Drizzle passes it
  // straight through, so anything calling Date methods on it blows up. This
  // only bit once a real RO closed recently enough to pass the staleness check.
  const lastClosed = await db
    .select({
      customerId: schema.repairOrders.customerId,
      closedAt: sql<string | null>`max(${schema.repairOrders.closedAt})`.as('closed_at'),
    })
    .from(schema.repairOrders)
    .where(eq(schema.repairOrders.storeId, storeId))
    .groupBy(schema.repairOrders.customerId)

  const lastClosedByCustomer = new Map<string, Date | null>(
    lastClosed.map((r) => {
      if (!r.closedAt) return [r.customerId, null]
      const parsed = new Date(r.closedAt)
      return [r.customerId, Number.isNaN(parsed.getTime()) ? null : parsed]
    }),
  )

  const rules: CadenceRule[] = ruleRows.map((r) => ({
    id: r.id, name: r.name, trigger: r.trigger,
    offsetDays: r.offsetDays, offsetMiles: r.offsetMiles,
    assignToRole: r.assignToRole, talkTrack: r.talkTrack,
    cooldownDays: r.cooldownDays, priority: r.priority, isActive: r.isActive,
  }))

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
  const recallsByVehicle = groupBy(recallRows, (r) => r.vehicleId)
  const declinesByCustomer = groupBy(declineRows, (r) => r.customerId)

  const nextAppointmentByVehicle = new Map<string, Date>()
  for (const appointment of upcomingAppointments) {
    if (!appointment.vehicleId) continue
    const current = nextAppointmentByVehicle.get(appointment.vehicleId)
    if (!current || appointment.scheduledAt < current) {
      nextAppointmentByVehicle.set(appointment.vehicleId, appointment.scheduledAt)
    }
  }

  const lastServiceByVehicle = new Map<string, Record<string, number>>()
  for (const line of historyLines) {
    if (!line.componentGroupKey || line.mileage === null) continue
    const existing = lastServiceByVehicle.get(line.vehicleId) ?? {}
    if (line.mileage > (existing[line.componentGroupKey] ?? 0)) {
      existing[line.componentGroupKey] = line.mileage
    }
    lastServiceByVehicle.set(line.vehicleId, existing)
  }

  // Vehicles belong to the customer who declined work on them, else to whoever
  // owns them via customer_vehicles.
  const ownership = await db.select().from(schema.customerVehicles).where(and(
    eq(schema.customerVehicles.storeId, storeId),
    eq(schema.customerVehicles.isCurrent, true),
  ))
  const vehiclesByCustomer = groupBy(ownership, (r) => r.customerId)
  const vehicleById = new Map(vehicleRows.map((v) => [v.id, v]))

  /** sourceKey is stored in the task's detail prefix, see writeTasks below. */
  const existingTasks: ExistingTask[] = existingRows.map((t) => ({
    cadenceRuleId: t.cadenceRuleId,
    customerId: t.customerId,
    vehicleId: t.vehicleId,
    sourceKey: extractSourceKey(t.sourceKey),
    createdAt: t.createdAt,
    status: t.status,
  }))
  const existingByCustomer = groupBy(existingTasks, (t) => t.customerId)

  const allGenerated: GeneratedTask[] = []

  for (const customer of customerRows) {
    const owned = (vehiclesByCustomer.get(customer.id) ?? [])
      .map((link) => vehicleById.get(link.vehicleId))
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
    const ownershipById = new Map(
      (vehiclesByCustomer.get(customer.id) ?? []).map((l) => [l.vehicleId, l]),
    )

    const vehicles: CadenceVehicle[] = owned.map((v) => {
      const contracts: Contract[] = (contractsByVehicle.get(v.id) ?? []).map((c) => ({
        id: c.id, productType: c.productType, adminCompany: c.adminCompany,
        purchaseDate: new Date(c.purchaseDate), termMonths: c.termMonths, termMiles: c.termMiles,
        expirationDate: c.expirationDate ? new Date(c.expirationDate) : undefined,
        expirationMiles: c.expirationMiles ?? undefined,
        deductibleAmount: num(c.deductibleAmount), deductibleType: c.deductibleType,
        tierType: c.tierType, coveredComponentGroups: [], excludedComponentGroups: [],
        requiresPriorAuthorization: c.requiresPriorAuthorization,
        status: c.status === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED', source: c.source,
      }))
      const prepaidEntitlements: (PrepaidEntitlement & { label: string })[] =
        (entitlementsByVehicle.get(v.id) ?? []).map((e) => ({
          contractId: e.contractId, componentGroupKey: e.componentGroupKey, label: e.label,
          totalAllowed: e.totalAllowed, used: e.used,
          expiresOn: e.expiresOn ? new Date(e.expiresOn) : undefined,
        }))

      return {
        id: v.id, make: v.make, model: v.model, modelYear: v.modelYear, vin: v.vin,
        inServiceDate: v.inServiceDate ? new Date(v.inServiceDate) : null,
        currentMileage: v.currentMileage ?? 0,
        avgMilesPerDay: v.avgMilesPerDay ? num(v.avgMilesPerDay) : null,
        isHybridOrEv: v.isHybridOrEv,
        isOriginalOwner: ownershipById.get(v.id)?.isOriginalOwner ?? false,
        contracts,
        prepaidEntitlements,
        openDeclines: (declinesByVehicle.get(v.id) ?? []).map((d) => ({
          id: d.id, description: d.description, componentGroupKey: d.componentGroupKey,
          quotedAmount: num(d.quotedAmount), declinedAt: d.declinedAt,
        })),
        openRecalls: (recallsByVehicle.get(v.id) ?? []).map((r) => ({
          campaignNumber: r.campaignNumber, description: r.summary ?? '', parkIt: r.parkIt,
        })),
        lastServiceMileageByGroup: lastServiceByVehicle.get(v.id) ?? {},
        nextAppointmentAt: nextAppointmentByVehicle.get(v.id) ?? null,
      }
    })

    if (vehicles.length === 0 && (declinesByCustomer.get(customer.id) ?? []).length === 0) continue

    const generated = generateCadenceTasks({
      asOf,
      lookaheadDays,
      store: { state: 'TX', laborRate: 185 },
      customer: {
        id: customer.id,
        name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown',
        visitCount: customer.visitCount,
        lifetimeSpend: num(customer.lifetimeSpend),
        lastVisitAt: customer.lastVisitAt,
        lastRoClosedAt: lastClosedByCustomer.get(customer.id) ?? null,
        doNotCall: customer.doNotCall,
        smsConsent: customer.smsConsent,
        emailConsent: customer.emailConsent,
        preferredChannel: customer.preferredChannel,
      },
      vehicles,
      rules,
      existingTasks: existingByCustomer.get(customer.id) ?? [],
    })

    allGenerated.push(...generated)
  }

  if (allGenerated.length > 0) {
    await db.insert(schema.cadenceTasks).values(
      allGenerated.map((t) => ({
        storeId,
        cadenceRuleId: t.cadenceRuleId,
        customerId: t.customerId,
        vehicleId: t.vehicleId,
        trigger: t.trigger,
        sourceDeclinedServiceId: t.sourceDeclinedServiceId,
        componentGroupKey: t.componentGroupKey ?? null,
        title: t.title,
        // The source key rides along in detail so a re-run can dedupe without
        // a schema change. Extracted back out by extractSourceKey.
        detail: `[${t.sourceKey ?? ''}] ${t.detail}`,
        talkTrack: t.talkTrack,
        estimatedValue: t.estimatedValue.toFixed(2),
        priority: t.priority,
        dueAt: t.dueAt,
        status: 'PENDING' as const,
      })),
    )
  }

  const byTrigger: Record<string, number> = {}
  for (const task of allGenerated) {
    byTrigger[task.trigger] = (byTrigger[task.trigger] ?? 0) + 1
  }

  return {
    customersEvaluated: customerRows.length,
    tasksCreated: allGenerated.length,
    byTrigger,
  }
}

export function extractSourceKey(detail: string | null): string | null {
  if (!detail) return null
  const match = /^\[([^\]]*)\]/.exec(detail)
  return match?.[1] || null
}

/** Strips the dedupe prefix for display. */
export function displayDetail(detail: string | null): string {
  if (!detail) return ''
  return detail.replace(/^\[[^\]]*\]\s*/, '')
}
