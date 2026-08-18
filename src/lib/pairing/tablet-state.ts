import type { DeviceSnapshot } from './snapshot'

/**
 * What is on the tablet's screen, and what a poll does to it.
 *
 * The tablet component is a shell around this: fetch, render, and nothing else
 * worth arguing about. The two decisions that were getting made wrong both live
 * here instead — whether the optimistic taps still belong to the menu that just
 * arrived, and which of them the footer is allowed to count.
 *
 * Pure and I/O-free, so both are testable without a browser.
 */

export interface PolledSession {
  id: string
  snapshot: DeviceSnapshot
  decisions: Record<string, string>
}

export type TabletState =
  | { phase: 'LOADING' }
  | { phase: 'ENROLLING'; code: string }
  | { phase: 'IDLE'; deviceName: string | null }
  | {
      phase: 'PRESENTING'
      /** Which session is on screen. The thing `pending` belongs to. */
      sessionId: string
      deviceName: string | null
      snapshot: DeviceSnapshot
      decisions: Record<string, string>
    }

/** What the tablet's own screen holds while a post is in flight. */
export type PendingTaps = Record<string, string>

/**
 * Given what is on screen, the taps still in flight, and what the poll just
 * returned, what should be on screen next — and do those taps survive?
 *
 * `pending` exists so a tap feels instant while the post is in flight, and it
 * is merged over whatever the server last said. That merge is only ever correct
 * against the session the taps were made on:
 *
 *  - The advisor takes the menu back and the session goes away. A tap still in
 *    flight must not be replayed onto whatever is presented next, so the map is
 *    dropped. (The explainer closes on its own: it lives inside ServiceMenu,
 *    which unmounts with the menu.)
 *  - The advisor re-curates and sends again. `pushToDevice` ends the old session
 *    and creates a new one with no decisions on it — a *different* session, even
 *    though the tablet never went idle in between. Carrying the map across put
 *    the previous customer's answers onto a menu they never saw, with the server
 *    holding none of them and the advisor's screen showing the line unanswered.
 *    Ids are stable per visit, so the two sends of one re-curated menu are
 *    exactly where they collide.
 *  - The same session polls again, which is the ordinary case. The map is kept:
 *    dropping it here would make every tap flicker back to unanswered for the
 *    fraction of a second before the server's copy catches up.
 *
 * So: `pending` survives if and only if the session id is unchanged.
 */
export function nextTabletState(
  current: TabletState,
  pending: PendingTaps,
  poll: { deviceName: string | null; session: PolledSession | null },
): { state: TabletState; pending: PendingTaps } {
  if (!poll.session) {
    return { state: { phase: 'IDLE', deviceName: poll.deviceName }, pending: {} }
  }

  const sameSession =
    current.phase === 'PRESENTING' && current.sessionId === poll.session.id

  return {
    state: {
      phase: 'PRESENTING',
      sessionId: poll.session.id,
      deviceName: poll.deviceName,
      snapshot: poll.session.snapshot,
      decisions: poll.session.decisions,
    },
    pending: sameSession ? pending : {},
  }
}

/**
 * Take back a tap the server refused.
 *
 * `pending` is an optimistic paint: the card turns green the instant it is
 * touched, before the post that records it has landed. When that post comes
 * back 409 — the advisor took the menu away between the tap and the request —
 * or 403, or anything else, the paint is a claim nobody is holding up. Removing
 * it here rather than waiting for the poll to overwrite it means the screen
 * stops asserting an answer the moment we know it was not taken, whether or not
 * the poll that follows changes the session at all.
 *
 * Scoped to the one id, because the other taps in the map are innocent: a
 * customer working down a menu has several in flight and only the refused one
 * is a lie. Returns the same object when there is nothing to remove, so a
 * failure for a tap the poll has already absorbed does not re-render.
 */
export function withoutTap(pending: PendingTaps, id: string): PendingTaps {
  if (!(id in pending)) return pending
  const next = { ...pending }
  delete next[id]
  return next
}

/**
 * What the footer says.
 *
 * Every figure is derived from the items on the snapshot in front of the
 * customer, never from the keys of the decisions map. A decision map can hold
 * ids that are not on this menu — an answer that arrived for the session before
 * it, a line the advisor removed when they re-curated — and counting those
 * inflates "you have said yes to N of M" past anything on screen. This is the
 * same derivation `present-menu.tsx` uses, so the advisor's preview and the
 * tablet cannot disagree about how many yeses there are.
 *
 * An unpriced line counts as chosen but adds nothing: we do not know what it
 * costs, which is why the customer is shown "price to be confirmed" rather than
 * our estimate, and quietly adding that estimate to the total would put the
 * unhonourable number back on screen by another route. Tested against `false`
 * rather than for truth because a tablet's snapshot is read back out of jsonb: a
 * row written before the field existed says nothing either way, and reading that
 * silence as "unpriced" would redact a total the customer was already shown.
 */
export function menuTotals(
  snapshot: DeviceSnapshot,
  decisions: Record<string, string>,
): { accepted: number; callMe: number; acceptedTotal: number } {
  const items = snapshot.tiers.flatMap((t) => t.items)
  const accepted = items.filter((i) => decisions[i.id] === 'ACCEPTED')

  return {
    accepted: accepted.length,
    callMe: items.filter((i) => decisions[i.id] === 'CALL_ME').length,
    acceptedTotal: accepted
      .filter((i) => i.priceConfirmed !== false)
      .reduce((sum, i) => sum + i.customerOutOfPocket, 0),
  }
}
