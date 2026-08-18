import 'server-only'
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import type { AdvisorOnDuty, ScheduledAppointment } from './capacity'
import type { MaintenanceIntervalRow } from './first-service'
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

/**
 * The customer's advisor, or null — DRIVE_PLAN D4 step 2.
 *
 * The whole of the owning seam's read side. `assignAdvisor` has had an
 * `owningAdvisorId` input since P2 that every caller answered null; this is the
 * loader that makes it a real answer, and it stayed one line for exactly that
 * reason — landing P3 was meant to be a loader change and not a change to how
 * assignment decides.
 *
 * Selected narrowly rather than through `loadCustomerRecord`: the booking
 * action needs one uuid, and building a customer record with its repair orders
 * and consent history to read it would be waste on the hot path of every
 * booking. Scoped, so another store's customer resolves to null rather than to
 * their advisor.
 */
export async function loadOwningAdvisorScoped(
  db: ScopedDb,
  customerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ owningAdvisorId: schema.customers.owningAdvisorId })
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1)

  return row?.owningAdvisorId ?? null
}

export async function loadMaintenanceIntervals(
  storeId: string,
  make: string,
): Promise<MaintenanceIntervalRow[]> {
  return withCurrentUserScope((db) => loadMaintenanceIntervalsScoped(db, storeId, make))
}

/**
 * What this make's maintenance schedule says, for the first-service default.
 *
 * `maintenance_schedules.store_id` is nullable and the null rows are shared
 * reference data every tenant may read, so both are pulled and the engine
 * picks the shortest interval among them. That is deliberate rather than
 * preferring the store's own: a rooftop that adds a row is adding a service,
 * not overriding the manufacturer, and "soonest wins" is the right rule for
 * *first* service either way.
 *
 * An empty result is the normal state today — nothing ships rows in this table
 * — and `firstServiceDefault` answers with the stated fallback and says which
 * it used, so the form is honest on a store that has configured nothing.
 */
export async function loadMaintenanceIntervalsScoped(
  db: ScopedDb,
  storeId: string,
  make: string,
): Promise<MaintenanceIntervalRow[]> {
  const rows = await db
    .select({
      make: schema.maintenanceSchedules.make,
      modelYearFrom: schema.maintenanceSchedules.modelYearFrom,
      modelYearTo: schema.maintenanceSchedules.modelYearTo,
      intervalMiles: schema.maintenanceSchedules.intervalMiles,
      intervalMonths: schema.maintenanceSchedules.intervalMonths,
      description: schema.maintenanceSchedules.description,
    })
    .from(schema.maintenanceSchedules)
    .where(and(
      eq(schema.maintenanceSchedules.isActive, true),
      eq(schema.maintenanceSchedules.make, make.trim().toUpperCase()),
      or(
        isNull(schema.maintenanceSchedules.storeId),
        eq(schema.maintenanceSchedules.storeId, storeId),
      ),
    ))

  return rows
}
