import { totalDecisions } from '@/lib/presentation/decisions'
import { channelPhrase, readPresentation } from './frozen'
import type {
  Timeline, TimelineDay, TimelineEvent, TimelineInput, TimelineOutcome, TimelineTone,
} from './types'
import { openThreads } from './threads'

/**
 * Ten tables, one story.
 *
 * Pure and I/O-free: every function here takes rows and returns events, so the
 * thing that decides what a history *reads* like is testable without a
 * database and cannot quietly start doing a query.
 *
 * The sentences are written here rather than in the components on purpose.
 * Two surfaces render this (the customer record and the vehicle record) plus a
 * compressed third on the prep sheet, and a phrase that lives in a component
 * is a phrase that says something slightly different on each of them.
 */

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function words(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

// ===========================================================================
// APPOINTMENTS
// ===========================================================================

const APPOINTMENT_TITLE: Record<string, string> = {
  SCHEDULED: 'Appointment booked',
  CONFIRMED: 'Appointment confirmed',
  ARRIVED: 'Arrived at the drive',
  IN_SERVICE: 'In service',
  READY: 'Ready for pickup',
  DELIVERED: 'Visit completed',
  NO_SHOW: 'No-show',
  CANCELLED: 'Appointment cancelled',
}

const APPOINTMENT_TONE: Record<string, TimelineTone> = {
  DELIVERED: 'GOOD',
  NO_SHOW: 'WARN',
  CANCELLED: 'WARN',
}

export function appointmentEvents(input: TimelineInput): TimelineEvent[] {
  return input.appointments.map((a) => {
    const detail: string[] = []
    if (a.visitContext === 'FIRST_SERVICE') {
      detail.push('First service, booked at delivery.')
    }
    if (a.concerns) detail.push(`Their words: “${a.concerns}”`)
    if (a.advisorName) detail.push(`Advisor: ${a.advisorName}`)
    if (a.cancellationReason) detail.push(`Reason: ${a.cancellationReason}`)

    return {
      /*
        A cancellation is dated by when it was cancelled, not by the slot it
        vacated. The slot is in the future on a cancellation made today, and an
        event that sorts into next Tuesday because somebody rang off it this
        morning is the timeline telling a plain lie about the order of things.
      */
      at: a.status === 'CANCELLED' && a.cancelledAt ? a.cancelledAt : a.scheduledAt,
      id: `appointments:${a.id}`,
      source: 'appointments' as const,
      rowId: a.id,
      kind: 'APPOINTMENT' as const,
      vehicleId: a.vehicleId,
      title: `${APPOINTMENT_TITLE[a.status] ?? words(a.status)} · ${words(a.transportType)}`,
      detail,
      amount: null,
      tone: APPOINTMENT_TONE[a.status] ?? 'NEUTRAL',
      href: `/drive/${a.id}`,
    }
  })
}

// ===========================================================================
// MENU PRESENTATIONS
// ===========================================================================

/**
 * "3 yes, 1 call-me, 1 no", or the honest silence.
 *
 * Counted by `totalDecisions`, which is already tested and already the
 * authority on what the customer's screen showed — including the rule that an
 * accepted line with no confirmed price contributes to the count and not to
 * the money. Re-implementing the tally here to save an import is how two
 * surfaces end up disagreeing about what a customer said.
 */
function answerPhrase(totals: {
  accepted: number; declined: number; callMe: number
}): string {
  const parts: string[] = []
  if (totals.accepted > 0) parts.push(`${totals.accepted} yes`)
  if (totals.callMe > 0) parts.push(`${totals.callMe} call-me`)
  if (totals.declined > 0) parts.push(`${totals.declined} no`)
  return parts.length > 0 ? parts.join(', ') : 'no answer yet'
}

export function menuEvents(input: TimelineInput): TimelineEvent[] {
  const vehicleByAppointment = new Map(
    input.appointments.map((a) => [a.id, a.vehicleId]),
  )

  return input.presentations.map((p) => {
    const { items, decisions } = readPresentation(p)
    const totals = totalDecisions(
      items.map((i) => ({ id: i.id, customerPrice: i.customerOutOfPocket })),
      decisions,
    )

    const sentence = [
      `Menu of ${items.length} presented ${channelPhrase(p.channel)}`,
      answerPhrase(totals),
    ]
    if (p.authorizedAt && p.authorizedName) {
      sentence.push(`authorised by ${p.authorizedName}`)
    }

    const detail: string[] = []
    for (const item of items) {
      const answer = decisions[item.id]
      if (answer === 'ACCEPTED') detail.push(`Yes — ${item.title}`)
      else if (answer === 'CALL_ME') detail.push(`Call me about — ${item.title}`)
      else if (answer === 'DECLINED') detail.push(`Not today — ${item.title}`)
    }

    return {
      id: `presentation_sessions:${p.id}`,
      source: 'presentation_sessions' as const,
      rowId: p.id,
      kind: 'MENU' as const,
      /*
        Dated by the authorisation when there is one. `startedAt` is when the
        advisor pushed the menu; the moment worth reading back is when the
        customer put their name to it, and on a link that can be hours later.
      */
      at: p.authorizedAt ?? p.startedAt,
      vehicleId: p.appointmentId ? vehicleByAppointment.get(p.appointmentId) ?? null : null,
      title: sentence.join(' · '),
      detail,
      amount: totals.authorisedAmount > 0 ? totals.authorisedAmount : null,
      tone: totals.accepted > 0 ? 'GOOD' : 'NEUTRAL',
      href: p.appointmentId ? `/drive/${p.appointmentId}` : null,
    }
  })
}

// ===========================================================================
// REPAIR ORDERS
// ===========================================================================

const SOLD_LINE_STATUSES = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETE'])

export function repairOrderEvents(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const ro of input.repairOrders) {
    const sold = ro.lines.filter((l) => SOLD_LINE_STATUSES.has(l.status))
    const lineDetail = sold.map(
      (l) => `${l.description}${l.customerAmount > 0 ? ` — ${money(l.customerAmount)}` : ` — ${words(l.payType)}`}`,
    )

    const opened: string[] = []
    if (ro.mileageIn !== null) opened.push(`${ro.mileageIn.toLocaleString()} miles in`)
    if (ro.advisorName) opened.push(`Advisor: ${ro.advisorName}`)

    events.push({
      id: `repair_orders:${ro.id}:opened`,
      source: 'repair_orders',
      rowId: ro.id,
      kind: 'REPAIR_ORDER',
      at: ro.openedAt,
      vehicleId: ro.vehicleId,
      title: `RO ${ro.roNumber} opened`,
      // An open ticket's lines are what is happening right now and belong on
      // the only event it has. Once it closes they move to the closing event,
      // where they are a record of what was sold rather than a work list.
      detail: ro.closedAt ? opened : [...opened, ...lineDetail],
      amount: null,
      tone: 'NEUTRAL',
      href: null,
    })

    if (ro.closedAt) {
      events.push({
        id: `repair_orders:${ro.id}:closed`,
        source: 'repair_orders',
        rowId: ro.id,
        kind: 'REPAIR_ORDER',
        at: ro.closedAt,
        vehicleId: ro.vehicleId,
        title: `RO ${ro.roNumber} closed · ${plural(sold.length, 'line')} sold`,
        detail: lineDetail,
        amount: ro.customerPayTotal > 0 ? ro.customerPayTotal : null,
        tone: ro.customerPayTotal > 0 ? 'GOOD' : 'NEUTRAL',
        href: null,
      })
    }
  }

  return events
}

// ===========================================================================
// DECLINED WORK
// ===========================================================================

export function declineEvents(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const d of input.declines) {
    const detail: string[] = []
    if (d.declineReason) detail.push(`Reason: ${d.declineReason}`)

    events.push({
      id: `declined_services:${d.id}:declined`,
      source: 'declined_services',
      rowId: d.id,
      kind: 'DECLINE',
      at: d.declinedAt,
      vehicleId: d.vehicleId,
      title: `Declined — ${d.description}`,
      detail,
      amount: d.quotedAmount > 0 ? d.quotedAmount : null,
      // Still open is a WARN; it is work the car needs that nobody has done.
      tone: d.resolvedAt ? 'NEUTRAL' : 'WARN',
      href: null,
    })

    /*
      The resurrection, as its own event.

      "Declined in March, sold in June" is the single most persuasive thing a
      timeline can show an advisor, and it is invisible if the resolution only
      mutates the earlier row's colour. Two moments, two events, one row id —
      which is why event identity carries a third segment.
    */
    if (d.resolvedAt) {
      events.push({
        id: `declined_services:${d.id}:resolved`,
        source: 'declined_services',
        rowId: d.id,
        kind: 'DECLINE',
        at: d.resolvedAt,
        vehicleId: d.vehicleId,
        title: `Sold after all — ${d.description}`,
        detail: [`Declined ${d.declinedAt.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        })}.`],
        amount: null,
        tone: 'GOOD',
        href: null,
      })
    }
  }

  return events
}

// ===========================================================================
// VISIT OUTCOMES
// ===========================================================================

const OUTCOME_WORD: Record<string, string> = {
  ACCEPTED: 'approved',
  DECLINED: 'declined',
  CALL_ME: 'wants a call',
  SKIPPED: 'never raised',
}

/**
 * One event per visit, not one per opportunity.
 *
 * D6's table lists this source as "visit outcomes per opportunity", and per
 * opportunity is how the rows are stored — but a fully worked sheet is twelve
 * of them decided within the same minute, and rendering twelve entries between
 * "arrived" and "RO closed" buries the visit inside its own paperwork. So the
 * *event* is the visit and the opportunities are its detail lines, which is
 * how an advisor would describe it out loud.
 *
 * The cost is the one place in this module where `rowId` is not a row id: it is
 * the appointment these outcomes were decided on, which is the thing the event
 * actually identifies. Stated here because identity is otherwise a rule with no
 * exceptions.
 */
export function visitOutcomeEvents(input: TimelineInput): TimelineEvent[] {
  const byAppointment = new Map<string, TimelineOutcome[]>()
  for (const o of input.outcomes) {
    const existing = byAppointment.get(o.appointmentId)
    if (existing) existing.push(o)
    else byAppointment.set(o.appointmentId, [o])
  }

  const events: TimelineEvent[] = []
  for (const [appointmentId, group] of byAppointment) {
    const counts = new Map<string, number>()
    let accepted = 0
    for (const o of group) {
      counts.set(o.outcome, (counts.get(o.outcome) ?? 0) + 1)
      if (o.outcome === 'ACCEPTED') accepted += o.estimatedAmount
    }

    /*
      Ordered by how much the reader cares, not alphabetically. A call-me sits
      second because it is the line somebody has to act on — and before this
      phase it could not appear here at all: `toOutcome` wrote every call-me as
      SKIPPED, so this sentence said "never raised" about the customer's
      warmest answer. See src/lib/performance/types.ts.
    */
    const order = ['ACCEPTED', 'CALL_ME', 'DECLINED', 'SKIPPED']
    const summary = order
      .filter((k) => (counts.get(k) ?? 0) > 0)
      .map((k) => `${counts.get(k)} ${OUTCOME_WORD[k]}`)
      .join(', ')

    events.push({
      id: `prep_sheet_outcomes:${appointmentId}:visit`,
      source: 'prep_sheet_outcomes',
      rowId: appointmentId,
      kind: 'VISIT_OUTCOMES',
      // The visit is dated by its last decision — when the advisor finished it.
      at: group.reduce((latest, o) => (o.decidedAt > latest ? o.decidedAt : latest), group[0]!.decidedAt),
      vehicleId: group[0]!.vehicleId,
      title: `Sheet worked · ${summary}`,
      detail: group.map((o) => `${o.title} — ${OUTCOME_WORD[o.outcome] ?? words(o.outcome)}`),
      amount: accepted > 0 ? accepted : null,
      /*
        Never WARN, even when items went unraised.

        The performance module is private by construction — an advisor's
        capture rate is about their own process and is shown to nobody else.
        This is a shared record page. Stating "2 never raised" as a fact of the
        visit is what D6 asked for and is the truth of the morning; colouring
        it amber turns the same row into a verdict on a named advisor on a page
        their manager and their colleagues can open. The scorecard is where
        that conversation belongs, and it is already there.
      */
      tone: accepted > 0 ? 'GOOD' : 'NEUTRAL',
      href: `/drive/${appointmentId}`,
    })
  }

  return events
}

// ===========================================================================
// THE REST
// ===========================================================================

export function handoffEvents(input: TimelineInput): TimelineEvent[] {
  const vehicleByAppointment = new Map(input.appointments.map((a) => [a.id, a.vehicleId]))

  return input.handoffs.map((h) => {
    const detail = [h.message]
    /*
      Said here for the same reason the hand-off panel says it: the mock
      adapter reports success and persists nothing, and a history that shows
      "handed off" against a DMS that never received anything is worse than
      showing no hand-off at all.
    */
    if (!h.writesPersisted) detail.push('Nothing was written to the DMS.')

    return {
      id: `dms_handoffs:${h.id}`,
      source: 'dms_handoffs' as const,
      rowId: h.id,
      kind: 'HANDOFF' as const,
      at: h.createdAt,
      vehicleId: h.appointmentId ? vehicleByAppointment.get(h.appointmentId) ?? null : null,
      title: `Handed off to ${h.vendor} · ${plural(h.acceptedCount, 'line')} accepted`,
      detail,
      amount: null,
      tone: h.status === 'SUCCESS' && h.writesPersisted ? 'GOOD' : 'WARN',
      href: h.appointmentId ? `/drive/${h.appointmentId}` : null,
    }
  })
}

export function callEvents(input: TimelineInput): TimelineEvent[] {
  return input.calls.map((c) => {
    const detail: string[] = []
    if (c.userName) detail.push(`By ${c.userName}`)
    if (c.durationSeconds !== null && c.durationSeconds > 0) {
      detail.push(`${Math.round(c.durationSeconds / 60)} min`)
    }
    if (c.notes) detail.push(c.notes)
    if (c.bookedSomething) detail.push('Booked an appointment.')

    return {
      id: `call_logs:${c.id}`,
      source: 'call_logs' as const,
      rowId: c.id,
      kind: 'CALL' as const,
      at: c.startedAt,
      vehicleId: c.vehicleId,
      title: `${c.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} call${
        c.outcome ? ` · ${words(c.outcome)}` : ''
      }`,
      detail,
      amount: null,
      tone: c.bookedSomething ? 'GOOD' : 'NEUTRAL',
      href: null,
    }
  })
}

export function taskEvents(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const t of input.tasks) {
    events.push({
      id: `cadence_tasks:${t.id}:queued`,
      source: 'cadence_tasks',
      rowId: t.id,
      kind: 'TASK',
      at: t.createdAt,
      vehicleId: t.vehicleId,
      title: `Follow-up queued · ${t.title}`,
      detail: [
        `Triggered by ${words(t.trigger)}.`,
        ...(t.detail ? [t.detail] : []),
      ],
      amount: t.estimatedValue > 0 ? t.estimatedValue : null,
      tone: 'NEUTRAL',
      href: null,
    })

    if (t.completedAt) {
      events.push({
        id: `cadence_tasks:${t.id}:completed`,
        source: 'cadence_tasks',
        rowId: t.id,
        kind: 'TASK',
        at: t.completedAt,
        vehicleId: t.vehicleId,
        title: `Follow-up done · ${t.title}`,
        detail: t.outcome ? [words(t.outcome)] : [],
        amount: null,
        tone: 'GOOD',
        href: null,
      })
    }
  }

  return events
}

export function noteEvents(input: TimelineInput): TimelineEvent[] {
  return input.notes.map((n) => ({
    id: `customer_notes:${n.id}`,
    source: 'customer_notes' as const,
    rowId: n.id,
    kind: 'NOTE' as const,
    at: n.createdAt,
    vehicleId: n.vehicleId,
    title: n.body,
    detail: [
      ...(n.authorName ? [`By ${n.authorName}`] : []),
      ...(n.isPinned ? ['Pinned — shows on every prep sheet.'] : []),
    ],
    amount: null,
    tone: 'NEUTRAL' as const,
    href: null,
  }))
}

export function mileageEvents(input: TimelineInput): TimelineEvent[] {
  return input.mileage.map((m) => ({
    id: `mileage_readings:${m.id}`,
    source: 'mileage_readings' as const,
    rowId: m.id,
    kind: 'MILEAGE' as const,
    at: m.recordedAt,
    vehicleId: m.vehicleId,
    title: `${m.mileage.toLocaleString()} miles · ${words(m.source)}`,
    detail: m.overrideReason
      // An odometer cannot decrease, so a reading that did is the one thing on
      // this list somebody may have to explain later.
      ? [`Accepted a reading that went backwards: ${words(m.overrideReason)}.`]
      : [],
    amount: null,
    tone: m.overrideReason ? 'WARN' : 'NEUTRAL',
    href: null,
  }))
}

// ===========================================================================
// THE MERGE
// ===========================================================================

/**
 * Every source, merged newest first.
 *
 * The tiebreak on `id` is not cosmetic: several events legitimately share a
 * timestamp (a menu authorised at the same second it was answered, a sheet
 * worked and an RO closed on the same click), and a comparator that returns 0
 * for them leaves the order to whatever the loader happened to fetch first.
 * That makes a screenshot unstable and a test flaky, so ties resolve on
 * identity, which is stable by construction.
 */
export function mergeEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort(
    (a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id),
  )
}

export function assembleEvents(input: TimelineInput): TimelineEvent[] {
  return mergeEvents([
    ...appointmentEvents(input),
    ...menuEvents(input),
    ...repairOrderEvents(input),
    ...declineEvents(input),
    ...visitOutcomeEvents(input),
    ...handoffEvents(input),
    ...callEvents(input),
    ...taskEvents(input),
    ...noteEvents(input),
    ...mileageEvents(input),
  ])
}

/**
 * The whole read-model: the story and what is still owed, from one set of rows.
 *
 * Both halves in one call because they are two readings of the same fetch. An
 * open-threads list assembled from a second query pass would be a second
 * definition of "open", and the two would drift the first time either changed.
 */
export function assembleTimeline(input: TimelineInput): Timeline {
  return { events: assembleEvents(input), threads: openThreads(input) }
}

/**
 * Grouped by day, newest day first.
 *
 * By day rather than by visit, which was the other candidate. Most of the ten
 * sources have no visit at all — a note, a call, a cadence task, an odometer
 * reading off a quick-lube pull — so visit-grouping needs an "everything else"
 * bucket that, for a customer who comes twice a year, is most of the list. A
 * date heading is true of every event, and "the 14th of March" is how somebody
 * actually narrates a history.
 *
 * The key is the local calendar day, so events either side of midnight UTC do
 * not split a single evening in two.
 */
export function groupByDay(events: TimelineEvent[]): TimelineDay[] {
  const days = new Map<string, TimelineEvent[]>()

  for (const event of events) {
    const d = event.at
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    const existing = days.get(key)
    if (existing) existing.push(event)
    else days.set(key, [event])
  }

  return [...days.entries()].map(([key, group]) => ({
    key,
    at: group[0]!.at,
    events: group,
  }))
}
