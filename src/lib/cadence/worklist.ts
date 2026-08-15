import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm'
import { addDays } from 'date-fns'
import { getDb, schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import { displayDetail } from './run'
import type { CadenceTrigger } from './types'

export interface WorklistItem {
  id: string
  trigger: CadenceTrigger
  title: string
  detail: string
  talkTrack: string | null
  estimatedValue: number
  priority: number
  dueAt: Date
  status: string

  customerId: string
  customerName: string
  customerPhone: string | null
  preferredChannel: string
  /** Consent matters even for a phone call — a DNC customer must not appear. */
  doNotCall: boolean

  vehicleId: string | null
  vehicleLabel: string | null
  vehicleMileage: number | null

  visitCount: number
  lifetimeSpend: number
  lastVisitAt: Date | null

  /** Role the generating rule assigns to — advisor or BDC. */
  assignToRole: string | null
  /** TCPA: a text may only be offered where consent is on file. */
  smsConsent: boolean
}

export interface Worklist {
  items: WorklistItem[]
  totals: {
    count: number
    value: number
    byTrigger: { trigger: CadenceTrigger; count: number; value: number }[]
  }
}

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The BDC's day: everything due now or overdue, ranked so the top of the list
 * is always the most valuable call available.
 */
export async function loadWorklist(
  storeId: string,
  asOf: Date = new Date(),
  trigger?: CadenceTrigger,
  /**
   * How far ahead to include not-yet-due tasks. Zero keeps the historical
   * behaviour — everything due now or overdue and nothing else.
   */
  lookaheadDays = 0,
): Promise<Worklist> {
  return withCurrentUserScope((db) => loadWorklistScoped(db, storeId, asOf, trigger, lookaheadDays))
}

async function loadWorklistScoped(db: ScopedDb, 
  storeId: string,
  asOf: Date = new Date(),
  trigger?: CadenceTrigger,
  /**
   * How far ahead to include not-yet-due tasks. Zero keeps the historical
   * behaviour — everything due now or overdue and nothing else.
   */
  lookaheadDays = 0,
): Promise<Worklist> {
  const horizon = lookaheadDays > 0 ? addDays(asOf, lookaheadDays) : asOf

  const rows = await db
    .select({
      task: schema.cadenceTasks,
      customer: schema.customers,
      vehicle: schema.vehicles,
      // The rule carries the ownership, so a worklist can split advisor work
      // from BDC work without the task table duplicating it.
      assignToRole: schema.cadenceRules.assignToRole,
    })
    .from(schema.cadenceTasks)
    .innerJoin(schema.customers, eq(schema.cadenceTasks.customerId, schema.customers.id))
    .leftJoin(schema.vehicles, eq(schema.cadenceTasks.vehicleId, schema.vehicles.id))
    .leftJoin(schema.cadenceRules, eq(schema.cadenceTasks.cadenceRuleId, schema.cadenceRules.id))
    .where(and(
      eq(schema.cadenceTasks.storeId, storeId),
      inArray(schema.cadenceTasks.status, ['PENDING', 'IN_PROGRESS']),
      lte(schema.cadenceTasks.dueAt, horizon),
      ...(trigger ? [eq(schema.cadenceTasks.trigger, trigger)] : []),
    ))
    .orderBy(asc(schema.cadenceTasks.priority), desc(schema.cadenceTasks.estimatedValue))

  const items: WorklistItem[] = rows
    // A customer who asked not to be contacted must never surface, even if a
    // task was generated before they opted out.
    .filter((r) => !r.customer.doNotCall)
    .map((r) => ({
      id: r.task.id,
      trigger: r.task.trigger,
      title: r.task.title,
      detail: displayDetail(r.task.detail),
      talkTrack: r.task.talkTrack,
      estimatedValue: num(r.task.estimatedValue),
      priority: r.task.priority,
      dueAt: r.task.dueAt,
      status: r.task.status,
      customerId: r.customer.id,
      customerName:
        [r.customer.firstName, r.customer.lastName].filter(Boolean).join(' ') ||
        r.customer.companyName || 'Unknown',
      customerPhone: r.customer.mobilePhone ?? r.customer.homePhone,
      preferredChannel: r.customer.preferredChannel,
      doNotCall: r.customer.doNotCall,
      vehicleId: r.vehicle?.id ?? null,
      vehicleLabel: r.vehicle
        ? `${r.vehicle.modelYear} ${r.vehicle.make} ${r.vehicle.model ?? ''}`.trim()
        : null,
      vehicleMileage: r.vehicle?.currentMileage ?? null,
      visitCount: r.customer.visitCount,
      lifetimeSpend: num(r.customer.lifetimeSpend),
      lastVisitAt: r.customer.lastVisitAt,
      assignToRole: r.assignToRole,
      smsConsent: r.customer.smsConsent,
    }))

  const byTriggerMap = new Map<CadenceTrigger, { count: number; value: number }>()
  for (const item of items) {
    const current = byTriggerMap.get(item.trigger) ?? { count: 0, value: 0 }
    byTriggerMap.set(item.trigger, {
      count: current.count + 1,
      value: current.value + item.estimatedValue,
    })
  }

  return {
    items,
    totals: {
      count: items.length,
      value: items.reduce((sum, i) => sum + i.estimatedValue, 0),
      byTrigger: [...byTriggerMap.entries()]
        .map(([t, v]) => ({ trigger: t, ...v }))
        .sort((a, b) => b.value - a.value),
    },
  }
}

/** Trigger counts across the whole worklist, for the filter chips. */
export async function loadTriggerCounts(storeId: string, asOf: Date = new Date()) {
  const { totals } = await loadWorklist(storeId, asOf)
  return totals.byTrigger
}
