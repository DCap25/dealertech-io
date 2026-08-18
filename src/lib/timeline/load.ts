import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import { displayDetail } from '@/lib/cadence/run'
import { assembleTimeline } from './assemble'
import { buildVisitCard } from './visit-card'
import { TIMELINE_BOUNDS, type Timeline, type TimelineInput, type VisitCard } from './types'

/**
 * The timeline's fetches. Thin, typed, and the only file here that connects.
 *
 * ---------------------------------------------------------------------------
 * ACCESS
 * ---------------------------------------------------------------------------
 * Scoped, following the record machinery this extends rather than inventing a
 * parallel one: `loadCustomerRecord` runs under `withCurrentUserScope` and
 * `loadVehicleRecord` under `withUserScope`, both of which become the
 * `authenticated` role so row-level security actually evaluates. The `storeId`
 * predicates below are still written and still correct — RLS sits underneath
 * them, so a future edit that drops one returns nothing rather than another
 * dealership's history.
 *
 * That decision has a cost worth naming, because this module reads more tables
 * than anything else in the codebase: a scoped block is one transaction on one
 * connection, so `Promise.all` below batches the code and not the round trips.
 * The queries run in sequence. On a record page that is the right trade, and it
 * is why the bounds in `types.ts` are bounds rather than aspirations.
 *
 * One of the ten tables was not readable under that role at all —
 * `presentation_sessions`, whose every existing query is deliberately
 * privileged because a customer opening a menu link has no session to scope
 * to. Migration 0030 grants the SELECT; see its comment for the seventh
 * instance of "a policy is not a grant".
 *
 * ---------------------------------------------------------------------------
 * QUERY COUNT
 * ---------------------------------------------------------------------------
 * Fourteen for a full customer timeline, thirteen for a vehicle's (which
 * already knows its car and does not have to ask which vehicles a customer
 * owns), and the same number for a customer of thirty years as for one who
 * arrived this morning. Nothing here fans out per visit: the visit-shaped
 * sources (presentations, hand-offs, outcomes) are fetched by the appointment
 * ids already loaded, and `ro_lines` by the repair-order ids already loaded.
 *
 * `include: 'THREADS'` runs six of them. See `loadVisitCard`.
 */

function num(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Whose history.
 *
 * ---------------------------------------------------------------------------
 * PER-CUSTOMER VS PER-VEHICLE
 * ---------------------------------------------------------------------------
 * D6 says both surfaces render a timeline and does not say how they differ.
 * They differ by predicate and by nothing else: a vehicle's timeline is the
 * customer's timeline filtered to one car, and every one of the ten sources
 * agrees to that filter. Eight carry a `vehicle_id` directly; the two that do
 * not — `presentation_sessions` and `dms_handoffs` — carry an appointment id,
 * and the appointment knows the car, which is how `assemble.ts` fills their
 * `vehicleId` in.
 *
 * The filter is pushed into the queries rather than applied to a loaded
 * customer timeline, because a household with four cars would otherwise pay to
 * fetch three of them to render one. Same events, same assembly, narrower
 * WHERE.
 *
 * What deliberately does *not* appear on a vehicle timeline: events whose
 * `vehicleId` is null. A thank-you call, a win-back task and a note about the
 * customer are facts about a person, and pinning them to whichever car
 * happened to be in the shop would be inventing a connection the row does not
 * claim. They live on the customer record, which is where somebody looking for
 * them would go.
 */
export type TimelineScope =
  | { kind: 'CUSTOMER'; customerId: string }
  | { kind: 'VEHICLE'; vehicleId: string }

export interface TimelineOptions {
  /**
   * `ALL` for a record page. `THREADS` for the prep sheet's compressed card,
   * which needs what is still owed and the two visit dates either side of
   * today, and has no business spending fourteen round trips in the lane to
   * print three facts.
   */
  include?: 'ALL' | 'THREADS'
}

const EMPTY: TimelineInput = {
  appointments: [], presentations: [], repairOrders: [], declines: [], outcomes: [],
  handoffs: [], calls: [], tasks: [], notes: [], mileage: [], vehicleLabels: {},
}

// ===========================================================================

export async function loadTimeline(
  storeId: string,
  scope: TimelineScope,
  options: TimelineOptions = {},
): Promise<Timeline> {
  const input = await withCurrentUserScope((db) => gather(db, storeId, scope, options))
  return assembleTimeline(input)
}

/**
 * The compressed card, at compressed cost.
 *
 * Vehicle-scoped on purpose: the advisor is standing at one car, and a thread
 * about the customer's other vehicle is not what "open threads (N)" means to
 * somebody about to walk over to this one.
 */
export async function loadVisitCard(
  storeId: string,
  vehicleId: string,
  asOf: Date,
): Promise<VisitCard> {
  const input = await withCurrentUserScope((db) =>
    gather(db, storeId, { kind: 'VEHICLE', vehicleId }, { include: 'THREADS' }),
  )
  return buildVisitCard(input, asOf)
}

// ===========================================================================

async function gather(
  db: ScopedDb,
  storeId: string,
  scope: TimelineScope,
  options: TimelineOptions,
): Promise<TimelineInput> {
  const full = (options.include ?? 'ALL') === 'ALL'

  /*
    Which vehicles are in play, and what they are called.

    A customer timeline needs the list because `mileage_readings` is the one
    source with no customer_id — an odometer belongs to a car, not to a person
    — and because every thread renders the car it is about.
  */
  let vehicleIds: string[]
  if (scope.kind === 'VEHICLE') {
    vehicleIds = [scope.vehicleId]
  } else {
    const owned = await db
      .select({ vehicleId: schema.customerVehicles.vehicleId })
      .from(schema.customerVehicles)
      .where(and(
        eq(schema.customerVehicles.customerId, scope.customerId),
        eq(schema.customerVehicles.isCurrent, true),
      ))
    vehicleIds = owned.map((o) => o.vehicleId)
  }

  const vehicleRows = vehicleIds.length
    ? await db
        .select({
          id: schema.vehicles.id,
          make: schema.vehicles.make,
          model: schema.vehicles.model,
          modelYear: schema.vehicles.modelYear,
        })
        .from(schema.vehicles)
        .where(and(
          eq(schema.vehicles.storeId, storeId),
          inArray(schema.vehicles.id, vehicleIds),
        ))
    : []

  const vehicleLabels: Record<string, string> = {}
  for (const v of vehicleRows) {
    vehicleLabels[v.id] = `${v.modelYear} ${v.make} ${v.model ?? ''}`.trim()
  }

  // ------------------------------------------------------- appointments
  const appointmentRows = await db
    .select()
    .from(schema.appointments)
    .where(and(
      eq(schema.appointments.storeId, storeId),
      scope.kind === 'CUSTOMER'
        ? eq(schema.appointments.customerId, scope.customerId)
        : eq(schema.appointments.vehicleId, scope.vehicleId),
    ))
    .orderBy(desc(schema.appointments.scheduledAt))
    .limit(TIMELINE_BOUNDS.appointments)

  const appointmentIds = appointmentRows.map((a) => a.id)

  // ------------------------------------------------------- presentations
  /*
    Every channel, not only the two a customer can answer on.

    A printed menu is still a menu that was put in front of somebody, and a
    timeline that omitted it would be silent about a real conversation. It
    contributes no *threads* — nothing comes back from paper — which
    `threads.ts` handles by filtering there rather than by fetching less here.
  */
  const presentationRows = appointmentIds.length
    ? await db
        .select({
          id: schema.presentationSessions.id,
          appointmentId: schema.presentationSessions.appointmentId,
          channel: schema.presentationSessions.channel,
          sequence: schema.presentationSessions.sequence,
          startedAt: schema.presentationSessions.startedAt,
          authorizedAt: schema.presentationSessions.authorizedAt,
          authorizedName: schema.presentationSessions.authorizedName,
          snapshot: schema.presentationSessions.snapshot,
          authorizedSnapshot: schema.presentationSessions.authorizedSnapshot,
          decisions: schema.presentationSessions.decisions,
        })
        .from(schema.presentationSessions)
        .where(and(
          eq(schema.presentationSessions.storeId, storeId),
          inArray(schema.presentationSessions.appointmentId, appointmentIds),
        ))
        .orderBy(desc(schema.presentationSessions.startedAt))
    : []

  // ------------------------------------------------------- declines
  const declineRows = await db
    .select()
    .from(schema.declinedServices)
    .where(and(
      eq(schema.declinedServices.storeId, storeId),
      scope.kind === 'CUSTOMER'
        ? eq(schema.declinedServices.customerId, scope.customerId)
        : eq(schema.declinedServices.vehicleId, scope.vehicleId),
    ))
    .orderBy(desc(schema.declinedServices.declinedAt))
    .limit(TIMELINE_BOUNDS.declines)

  // ------------------------------------------------------- cadence tasks
  const taskRows = await db
    .select()
    .from(schema.cadenceTasks)
    .where(and(
      eq(schema.cadenceTasks.storeId, storeId),
      scope.kind === 'CUSTOMER'
        ? eq(schema.cadenceTasks.customerId, scope.customerId)
        : eq(schema.cadenceTasks.vehicleId, scope.vehicleId),
    ))
    .orderBy(desc(schema.cadenceTasks.dueAt))
    .limit(TIMELINE_BOUNDS.cadenceTasks)

  // ------------------------------------------------------- the rest
  const repairOrderRows = full
    ? await db
        .select()
        .from(schema.repairOrders)
        .where(and(
          eq(schema.repairOrders.storeId, storeId),
          scope.kind === 'CUSTOMER'
            ? eq(schema.repairOrders.customerId, scope.customerId)
            : eq(schema.repairOrders.vehicleId, scope.vehicleId),
        ))
        .orderBy(desc(schema.repairOrders.openedAt))
        .limit(TIMELINE_BOUNDS.repairOrders)
    : []

  const lineRows = repairOrderRows.length
    ? await db
        .select()
        .from(schema.roLines)
        .where(inArray(schema.roLines.repairOrderId, repairOrderRows.map((r) => r.id)))
        .orderBy(schema.roLines.lineNumber)
    : []

  const outcomeRows = full && appointmentIds.length
    ? await db
        .select()
        .from(schema.prepSheetOutcomes)
        .where(and(
          eq(schema.prepSheetOutcomes.storeId, storeId),
          inArray(schema.prepSheetOutcomes.appointmentId, appointmentIds),
        ))
        .orderBy(schema.prepSheetOutcomes.decidedAt)
    : []

  const handoffRows = full && appointmentIds.length
    ? await db
        .select()
        .from(schema.dmsHandoffs)
        .where(and(
          eq(schema.dmsHandoffs.storeId, storeId),
          inArray(schema.dmsHandoffs.appointmentId, appointmentIds),
        ))
        .orderBy(desc(schema.dmsHandoffs.createdAt))
    : []

  const callRows = full
    ? await db
        .select()
        .from(schema.callLogs)
        .where(and(
          eq(schema.callLogs.storeId, storeId),
          scope.kind === 'CUSTOMER'
            ? eq(schema.callLogs.customerId, scope.customerId)
            : eq(schema.callLogs.vehicleId, scope.vehicleId),
        ))
        .orderBy(desc(schema.callLogs.startedAt))
        .limit(TIMELINE_BOUNDS.callLogs)
    : []

  const noteRows = full
    ? await db
        .select()
        .from(schema.customerNotes)
        .where(and(
          eq(schema.customerNotes.storeId, storeId),
          scope.kind === 'CUSTOMER'
            ? eq(schema.customerNotes.customerId, scope.customerId)
            : eq(schema.customerNotes.vehicleId, scope.vehicleId),
        ))
        .orderBy(desc(schema.customerNotes.createdAt))
        .limit(TIMELINE_BOUNDS.notes)
    : []

  const mileageRows = full && vehicleIds.length
    ? await db
        .select()
        .from(schema.mileageReadings)
        .where(and(
          eq(schema.mileageReadings.storeId, storeId),
          inArray(schema.mileageReadings.vehicleId, vehicleIds),
        ))
        .orderBy(desc(schema.mileageReadings.recordedAt))
        .limit(TIMELINE_BOUNDS.mileageReadings)
    : []

  /*
    Names, in one pass.

    Four of the ten sources carry a user id and every one of them renders a
    person's name — "Advisor: Marcus Webb", "By Dana Cho". Resolved together
    rather than per source, because a timeline that fires a query per author is
    exactly the fan-out the bounds exist to prevent.
  */
  const userIds = [...new Set([
    ...appointmentRows.map((a) => a.advisorId),
    ...repairOrderRows.map((r) => r.advisorId),
    ...callRows.map((c) => c.userId),
    ...noteRows.map((n) => n.userId),
  ].filter((id): id is string => id !== null))]

  const userRows = userIds.length
    ? await db
        .select({ id: schema.users.id, fullName: schema.users.fullName })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds))
    : []
  const nameOf = new Map(userRows.map((u) => [u.id, u.fullName]))
  const named = (id: string | null) => (id ? nameOf.get(id) ?? null : null)

  const linesByRo = new Map<string, typeof lineRows>()
  for (const line of lineRows) {
    linesByRo.set(line.repairOrderId, [...(linesByRo.get(line.repairOrderId) ?? []), line])
  }

  return {
    ...EMPTY,
    vehicleLabels,

    appointments: appointmentRows.map((a) => ({
      id: a.id,
      vehicleId: a.vehicleId,
      scheduledAt: a.scheduledAt,
      promisedAt: a.promisedAt,
      status: a.status,
      source: a.source,
      transportType: a.transportType,
      concerns: a.customerConcerns,
      visitContext: a.visitContext,
      cancelledAt: a.cancelledAt,
      cancellationReason: a.cancellationReason,
      advisorName: named(a.advisorId),
    })),

    presentations: presentationRows.map((p) => ({
      id: p.id,
      appointmentId: p.appointmentId,
      channel: p.channel,
      sequence: p.sequence,
      startedAt: p.startedAt,
      authorizedAt: p.authorizedAt,
      authorizedName: p.authorizedName,
      snapshot: p.snapshot,
      authorizedSnapshot: p.authorizedSnapshot,
      decisions: p.decisions,
    })),

    repairOrders: repairOrderRows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicleId,
      roNumber: r.roNumber,
      status: r.status,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      mileageIn: r.mileageIn,
      customerPayTotal: num(r.customerPayTotal),
      advisorName: named(r.advisorId),
      lines: (linesByRo.get(r.id) ?? []).map((l) => ({
        description: l.description,
        payType: l.payType,
        status: l.status,
        customerAmount: num(l.customerAmount),
      })),
    })),

    declines: declineRows.map((d) => ({
      id: d.id,
      vehicleId: d.vehicleId,
      description: d.description,
      quotedAmount: num(d.quotedAmount),
      declinedAt: d.declinedAt,
      declineReason: d.declineReason,
      resolvedAt: d.resolvedAt,
    })),

    outcomes: outcomeRows
      // An outcome row with no appointment cannot be grouped into a visit, and
      // the column is nullable because the appointment can be deleted out from
      // under it. Dropped rather than bucketed under a placeholder id.
      .filter((o): o is typeof o & { appointmentId: string } => o.appointmentId !== null)
      .map((o) => ({
        appointmentId: o.appointmentId,
        vehicleId: o.vehicleId,
        title: o.title,
        outcome: o.outcome,
        estimatedAmount: num(o.estimatedAmount),
        decidedAt: o.decidedAt,
      })),

    handoffs: handoffRows.map((h) => ({
      id: h.id,
      appointmentId: h.appointmentId,
      status: h.status,
      vendor: h.vendor,
      writesPersisted: h.writesPersisted,
      message: h.message,
      acceptedCount: h.acceptedCount,
      createdAt: h.createdAt,
    })),

    calls: callRows.map((c) => ({
      id: c.id,
      vehicleId: c.vehicleId,
      direction: c.direction,
      outcome: c.outcome,
      startedAt: c.startedAt,
      durationSeconds: c.durationSeconds,
      notes: c.notes,
      userName: named(c.userId),
      bookedSomething: c.resultingAppointmentId !== null,
    })),

    tasks: taskRows.map((t) => ({
      id: t.id,
      vehicleId: t.vehicleId,
      title: t.title,
      // The same reader the customer record uses, so a task's detail does not
      // read one way on one page and another way here. It returns '' for an
      // absent detail; null is what the rest of this module means by absent.
      detail: displayDetail(t.detail) || null,
      trigger: t.trigger,
      status: t.status,
      priority: t.priority,
      estimatedValue: num(t.estimatedValue),
      dueAt: t.dueAt,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      outcome: t.outcome,
    })),

    notes: noteRows.map((n) => ({
      id: n.id,
      vehicleId: n.vehicleId,
      body: n.body,
      isPinned: n.isPinned,
      createdAt: n.createdAt,
      authorName: named(n.userId),
    })),

    mileage: mileageRows.map((m) => ({
      id: m.id,
      vehicleId: m.vehicleId,
      mileage: m.mileage,
      recordedAt: m.recordedAt,
      source: m.source,
      overrideReason: m.overrideReason,
    })),
  }
}
