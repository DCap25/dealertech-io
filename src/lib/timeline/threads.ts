import { followUpPriority, needsFollowUp } from '@/lib/presentation/decisions'
import { readPresentation } from './frozen'
import type { OpenThread, TimelineInput } from './types'

/**
 * What this customer is still owed — the timeline's other half.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `needsFollowUp` and `followUpPriority` have been sitting in
 * src/lib/presentation/decisions.ts with no callers anywhere (MENU_REVIEW F5's
 * resolution note). They encode a real product decision — a call-me outranks a
 * decline by a wide margin, because the customer asked a direct question and
 * being ignored after asking one is worse than the lost sale — and until
 * something consumed them, that decision was a comment.
 *
 * This is the consumer. A history is only half of what an advisor wants from a
 * customer record; the other half is "what am I supposed to do about it", and
 * that is a *different shape* from a timeline — ordered by urgency rather than
 * by date, and containing only what is still open.
 *
 * Pure and I/O-free. Built from the same rows `assemble.ts` reads, in the same
 * pass, so "N open threads" means one thing everywhere it is printed.
 */

/**
 * Are two descriptions of work the same work?
 *
 * Deliberately crude — case and punctuation only. It is used for one job: a
 * line a customer declined on a menu becomes a `declined_services` row the
 * moment the visit is written up, and listing both would tell an advisor to
 * chase the same brake job twice. Where they match, the `declined_services`
 * row wins: it is the durable record, it carries an op code the price book can
 * re-quote, and it knows whether the work has since been sold.
 *
 * A miss shows a duplicate, which is visible and annoying. The opposite
 * failure — collapsing two genuinely different jobs — hides work the car
 * needs, so the comparison stays strict rather than clever.
 */
function sameWork(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return key(a) === key(b)
}

const OPEN_TASK_STATUSES = new Set(['PENDING', 'IN_PROGRESS'])

/**
 * Channels a customer can answer on.
 *
 * PRINT is excluded because nothing comes back from paper — a printed menu has
 * an empty `decisions` column by construction, so it would contribute nothing
 * anyway. Naming it is cheaper than leaving a reader to work that out.
 */
const ANSWERABLE_CHANNELS = new Set(['TABLET', 'LINK'])

export function openThreads(input: TimelineInput): OpenThread[] {
  const label = (vehicleId: string | null) =>
    vehicleId ? input.vehicleLabels[vehicleId] ?? null : null

  const vehicleByAppointment = new Map(input.appointments.map((a) => [a.id, a.vehicleId]))

  // ---------------------------------------------------- menu answers
  /*
    One thread per piece of work, not one per time it was answered.

    A visit has more than one conversation by design, and the same line can be
    answered on both — plus opportunity keys are derived from what the work is,
    so the same recommendation carries the same id across visits and years. The
    newest answer is the one that stands, exactly as `mergeCustomerAnswers`
    treats a later presentation within a visit.
  */
  const latestAnswer = new Map<string, OpenThread>()

  for (const p of input.presentations) {
    if (!ANSWERABLE_CHANNELS.has(p.channel)) continue

    const { items, decisions } = readPresentation(p)
    const at = p.authorizedAt ?? p.startedAt
    const vehicleId = p.appointmentId
      ? vehicleByAppointment.get(p.appointmentId) ?? null
      : null

    for (const item of items) {
      const answer = decisions[item.id]
      if (!answer || !needsFollowUp(answer)) continue

      const key = `${vehicleId ?? 'customer'}:${item.id}`
      const existing = latestAnswer.get(key)
      if (existing && existing.at >= at) continue

      latestAnswer.set(key, {
        id: `presentation_sessions:${p.id}:${item.id}`,
        kind: answer === 'CALL_ME' ? 'CALL_ME' : 'MENU_DECLINE',
        priority: followUpPriority(answer),
        at,
        title: item.title,
        detail: answer === 'CALL_ME'
          ? 'They asked to be called about this.'
          : 'Said not today on the menu.',
        // A line whose price was never confirmed shows no figure, the same
        // rule every customer-facing total in this codebase follows.
        amount: item.priceConfirmed && item.customerOutOfPocket > 0
          ? item.customerOutOfPocket
          : null,
        vehicleId,
        vehicleLabel: label(vehicleId),
        href: p.appointmentId ? `/drive/${p.appointmentId}` : null,
      })
    }
  }

  // ---------------------------------------------------- open declines
  const openDeclines = input.declines.filter((d) => d.resolvedAt === null)

  const declineThreads: OpenThread[] = openDeclines.map((d) => ({
    id: `declined_services:${d.id}`,
    kind: 'OPEN_DECLINE',
    // The same number `followUpPriority` gives a declined answer, taken from it
    // rather than written as 100 here — one scale, one authority.
    priority: followUpPriority('DECLINED'),
    at: d.declinedAt,
    title: d.description,
    detail: d.declineReason ? `Reason given: ${d.declineReason}` : 'Never came back for it.',
    amount: d.quotedAmount > 0 ? d.quotedAmount : null,
    vehicleId: d.vehicleId,
    vehicleLabel: label(d.vehicleId),
    href: null,
  }))

  const menuThreads = [...latestAnswer.values()].filter((thread) => {
    // A call-me is never the same fact as a declined_services row — nobody
    // declined it — so only menu *declines* are candidates for collapsing.
    if (thread.kind !== 'MENU_DECLINE') return true
    return !openDeclines.some(
      (d) => d.vehicleId === thread.vehicleId && sameWork(d.description, thread.title),
    )
  })

  // ---------------------------------------------------- cadence tasks
  /*
    The cadence engine's own priority, used as-is.

    `cadence_tasks.priority` is already "lower shows first" — see
    src/lib/cadence/worklist.ts, which orders by it ascending — so it composes
    with `followUpPriority` on one scale without translation. That means a
    store that has set a rule to priority 10 sees those tasks above a decline
    at 100, which is the store's own stated ordering and not ours to override.
    A call-me still leads everything, because `followUpPriority` puts it at 0
    and nothing in the cadence rules goes below that.
  */
  const taskThreads: OpenThread[] = input.tasks
    .filter((t) => OPEN_TASK_STATUSES.has(t.status))
    .map((t) => ({
      id: `cadence_tasks:${t.id}`,
      kind: 'CADENCE_TASK',
      priority: t.priority,
      at: t.dueAt,
      title: t.title,
      detail: t.detail,
      amount: t.estimatedValue > 0 ? t.estimatedValue : null,
      vehicleId: t.vehicleId,
      vehicleLabel: label(t.vehicleId),
      href: '/follow-up',
    }))

  /*
    Priority, then recency, then identity.

    Recency descending within a priority band: two declines are worked newest
    first, because a customer who said no last week is warmer than one who said
    no in 2019. Identity last so the order is stable across renders rather than
    left to whichever source happened to be assembled first.
  */
  return [...menuThreads, ...declineThreads, ...taskThreads].sort(
    (a, b) =>
      a.priority - b.priority ||
      b.at.getTime() - a.at.getTime() ||
      a.id.localeCompare(b.id),
  )
}
