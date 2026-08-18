import 'server-only'
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import type { AdvisorOnDuty, ScheduledAppointment } from './capacity'
import type { DayRules } from './rules'

/**
 * The one file in this folder that reads anything.
 *
 * Everything else under `src/lib/scheduling/` is pure and tested without a
 * database; this is the seam that feeds it. Each loader comes in two forms —
 * a wrapper that opens a scope, and a `…Scoped` variant taking the caller's
 * transaction — because the booking action must do its reads inside the same
 * scope as its writes. Opening a second scope in there would ask the pool for
 * a second connection while holding its only one, which is a deadlock rather
 * than a slow query (src/db/README.md).
 */

/** Roles that take appointments. Matches `DRIVE_ROLES` in src/lib/manager/load.ts. */
const DRIVE_ROLES = ['ADVISOR', 'SERVICE_MANAGER'] as const

export async function loadSchedulingRules(storeId: string): Promise<DayRules[]> {
  return withCurrentUserScope((db) => loadSchedulingRulesScoped(db, storeId))
}

/**
 * A store's configured week, or an empty list.
 *
 * Empty is a normal answer, not a failure: no store has configured anything
 * yet, and `dayRulesFor` falls through to the shipped defaults so the booking
 * screen works on day one. The engine draws the distinction between "no rows"
 * and "no row for this weekday" — see rules.ts — so this returns exactly what
 * the table holds and decides nothing.
 */
export async function loadSchedulingRulesScoped(
  db: ScopedDb,
  storeId: string,
): Promise<DayRules[]> {
  const rows = await db
    .select()
    .from(schema.schedulingRules)
    .where(eq(schema.schedulingRules.storeId, storeId))
    .orderBy(asc(schema.schedulingRules.weekday))

  return rows.map((r) => ({
    weekday: r.weekday,
    openMinute: r.openMinute,
    closeMinute: r.closeMinute,
    slotMinutes: r.slotMinutes,
    maxPerAdvisorSlot: r.maxPerAdvisorSlot,
    maxPerAdvisorDay: r.maxPerAdvisorDay,
    maxWaitersPerSlot: r.maxWaitersPerSlot,
    autoAssign: r.autoAssign,
  }))
}

export async function loadAdvisorsOnDuty(storeId: string): Promise<AdvisorOnDuty[]> {
  return withCurrentUserScope((db) => loadAdvisorsOnDutyScoped(db, storeId))
}

/**
 * Everyone who could take an appointment at this rooftop.
 *
 * `working` is true for every active advisor, because **nothing in the schema
 * records a shift**. There is no roster calendar, so "their guy is off
 * Tuesdays" — which D4 leans on twice — is not a fact the system can know
 * today. Stated rather than faked: the flag stays in the engine's input so a
 * shift source can feed it without touching the cascade, and until one exists
 * the off-shift branch is unreachable in production and exercised only in
 * tests. The alternative, dropping the flag, would mean discovering later that
 * it has to thread through four signatures.
 */
export async function loadAdvisorsOnDutyScoped(
  db: ScopedDb,
  storeId: string,
): Promise<AdvisorOnDuty[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.fullName,
      email: schema.users.email,
    })
    .from(schema.userStoreRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userStoreRoles.userId))
    .where(and(
      eq(schema.userStoreRoles.storeId, storeId),
      inArray(schema.userStoreRoles.role, [...DRIVE_ROLES]),
      eq(schema.userStoreRoles.isActive, true),
    ))

  return rows
    .map((r) => ({ advisorId: r.id, name: r.name ?? r.email, working: true }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadDayBook(storeId: string, day: Date): Promise<ScheduledAppointment[]> {
  return withCurrentUserScope((db) => loadDayBookScoped(db, storeId, day))
}

/**
 * One day's book, narrow.
 *
 * Deliberately not `loadDriveRange`: the week view needs prep sheets because it
 * renders what is on each car, and this needs four fields to count with.
 * Building forty opportunity engines to paint a load bar would be waste, and
 * the counts would be identical.
 *
 * Cancelled and no-show appointments are excluded — a car that is not coming
 * does not occupy a slot, and counting it would have the booker turning
 * customers away from a morning that is actually empty.
 */
export async function loadDayBookScoped(
  db: ScopedDb,
  storeId: string,
  day: Date,
): Promise<ScheduledAppointment[]> {
  const from = new Date(day)
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  const rows = await db
    .select({
      id: schema.appointments.id,
      advisorId: schema.appointments.advisorId,
      scheduledAt: schema.appointments.scheduledAt,
      transportType: schema.appointments.transportType,
      status: schema.appointments.status,
    })
    .from(schema.appointments)
    .where(and(
      eq(schema.appointments.storeId, storeId),
      gte(schema.appointments.scheduledAt, from),
      lt(schema.appointments.scheduledAt, to),
    ))

  return rows
    .filter((r) => r.status !== 'CANCELLED' && r.status !== 'NO_SHOW')
    .map((r) => ({
      appointmentId: r.id,
      advisorId: r.advisorId,
      scheduledAt: r.scheduledAt,
      isWaiter: r.transportType === 'WAITER',
    }))
}
