import 'server-only'
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import type { Period } from '@/lib/performance'
import type {
  ManagerAdvisor, ManagerAppointment, ManagerFollowUp, ManagerRepairOrder,
} from './board'

/**
 * Data access for the manager board.
 *
 * Reads closed repair orders, today's appointments and the open follow-up
 * backlog — and nothing from `prep_sheet_outcomes`. See board.ts for why that
 * line exists.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Matches the scorecard: a line the customer approved, not a recommendation. */
const SOLD_LINE_STATUSES = ['APPROVED', 'IN_PROGRESS', 'COMPLETE'] as const

/** Roles that take appointments and close repair orders. */
const DRIVE_ROLES = ['ADVISOR', 'SERVICE_MANAGER'] as const

export async function loadAdvisors(storeId: string): Promise<ManagerAdvisor[]> {
  return withCurrentUserScope((db) => loadAdvisorsScoped(db, storeId))
}

async function loadAdvisorsScoped(db: ScopedDb, storeId: string): Promise<ManagerAdvisor[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.fullName,
      email: schema.users.email,
      role: schema.userStoreRoles.role,
    })
    .from(schema.userStoreRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userStoreRoles.userId))
    .where(
      and(
        eq(schema.userStoreRoles.storeId, storeId),
        inArray(schema.userStoreRoles.role, [...DRIVE_ROLES]),
        eq(schema.userStoreRoles.isActive, true),
      ),
    )

  return rows.map((r) => ({ advisorId: r.id, name: r.name ?? r.email, role: r.role }))
}

export async function loadAppointments(
  storeId: string,
  from: Date,
  to: Date,
): Promise<ManagerAppointment[]> {
  return withCurrentUserScope((db) => loadAppointmentsScoped(db, storeId, from, to))
}

async function loadAppointmentsScoped(db: ScopedDb, 
  storeId: string,
  from: Date,
  to: Date,
): Promise<ManagerAppointment[]> {
  const rows = await db
    .select({
      advisorId: schema.appointments.advisorId,
      scheduledAt: schema.appointments.scheduledAt,
      status: schema.appointments.status,
    })
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.storeId, storeId),
        gte(schema.appointments.scheduledAt, from),
        lt(schema.appointments.scheduledAt, to),
      ),
    )

  return rows.map((r) => ({
    advisorId: r.advisorId,
    scheduledAt: r.scheduledAt,
    status: r.status,
  }))
}

/**
 * Closed repair orders in a window, rolled up from their sold lines.
 *
 * The stored `customer_pay_total` on the repair order is deliberately not
 * used: it is a denormalised rollup that a partial import can leave stale,
 * and this figure appears on a screen managers make decisions from. Summing
 * the lines that are actually marked sold is slower and correct.
 */
export async function loadRepairOrders(
  storeId: string,
  period: Period,
): Promise<ManagerRepairOrder[]> {
  return withCurrentUserScope((db) => loadRepairOrdersScoped(db, storeId, period))
}

async function loadRepairOrdersScoped(db: ScopedDb, 
  storeId: string,
  period: Period,
): Promise<ManagerRepairOrder[]> {

  const ros = await db
    .select({
      id: schema.repairOrders.id,
      advisorId: schema.repairOrders.advisorId,
      closedAt: schema.repairOrders.closedAt,
      laborGross: schema.repairOrders.laborGross,
      hoursSold: schema.repairOrders.hoursSold,
    })
    .from(schema.repairOrders)
    .where(
      and(
        eq(schema.repairOrders.storeId, storeId),
        isNotNull(schema.repairOrders.closedAt),
        gte(schema.repairOrders.closedAt, period.start),
        lt(schema.repairOrders.closedAt, period.end),
      ),
    )
  if (ros.length === 0) return []

  const lines = await db
    .select({
      repairOrderId: schema.roLines.repairOrderId,
      laborAmount: schema.roLines.laborAmount,
      partsAmount: schema.roLines.partsAmount,
      customerAmount: schema.roLines.customerAmount,
      status: schema.roLines.status,
    })
    .from(schema.roLines)
    .where(
      and(
        inArray(schema.roLines.repairOrderId, ros.map((r) => r.id)),
        inArray(schema.roLines.status, [...SOLD_LINE_STATUSES]),
      ),
    )

  const soldById = new Map<string, { sold: number; customerPay: number }>()
  for (const line of lines) {
    const acc = soldById.get(line.repairOrderId) ?? { sold: 0, customerPay: 0 }
    acc.sold += num(line.laborAmount) + num(line.partsAmount)
    acc.customerPay += num(line.customerAmount)
    soldById.set(line.repairOrderId, acc)
  }

  return ros.map((r) => {
    const totals = soldById.get(r.id) ?? { sold: 0, customerPay: 0 }
    return {
      repairOrderId: r.id,
      advisorId: r.advisorId,
      closedAt: r.closedAt!,
      sold: totals.sold,
      customerPay: totals.customerPay,
      laborGross: num(r.laborGross),
      hoursSold: num(r.hoursSold),
    }
  })
}

/**
 * The open follow-up backlog.
 *
 * Ownership comes from the cadence rule, not from the task: DealerTech assigns
 * follow-ups by role today, not to a named person. Attributing them to an
 * individual by guessing from the source repair order would put a number
 * beside someone's name that nothing in the system actually says.
 */
export async function loadBacklog(storeId: string): Promise<ManagerFollowUp[]> {
  return withCurrentUserScope((db) => loadBacklogScoped(db, storeId))
}

async function loadBacklogScoped(db: ScopedDb, storeId: string): Promise<ManagerFollowUp[]> {
  const rows = await db
    .select({
      trigger: schema.cadenceTasks.trigger,
      dueAt: schema.cadenceTasks.dueAt,
      estimatedValue: schema.cadenceTasks.estimatedValue,
      assignToRole: schema.cadenceRules.assignToRole,
      doNotCall: schema.customers.doNotCall,
    })
    .from(schema.cadenceTasks)
    .innerJoin(schema.customers, eq(schema.cadenceTasks.customerId, schema.customers.id))
    .leftJoin(schema.cadenceRules, eq(schema.cadenceTasks.cadenceRuleId, schema.cadenceRules.id))
    .where(
      and(
        eq(schema.cadenceTasks.storeId, storeId),
        inArray(schema.cadenceTasks.status, ['PENDING', 'IN_PROGRESS']),
      ),
    )

  return (
    rows
      // Matches the worklist: a customer who asked not to be contacted is not
      // backlog, so counting them would inflate a number nobody may action.
      .filter((r) => !r.doNotCall)
      .map((r) => ({
        ownerRole: r.assignToRole === 'BDC' ? ('BDC' as const) : ('ADVISOR' as const),
        trigger: r.trigger,
        dueAt: r.dueAt,
        estimatedValue: num(r.estimatedValue),
      }))
  )
}
