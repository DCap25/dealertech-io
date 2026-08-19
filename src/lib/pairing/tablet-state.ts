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

/**
 * A customer's own sign-off, as it comes back over the wire.
 *
 * `at` is an ISO string rather than a Date because it arrives as JSON on a
 * device. Nothing on the tablet does arithmetic with it — the screen says who
 * confirmed, not when — so parsing it would be inventing a use.
 */
export interface TabletAuthorisation {
  at: string
  name: string
}

export interface PolledSession {
  id: string
  snapshot: DeviceSnapshot
  decisions: Record<string, string>
  /**
   * Whether this menu was handed over rather than presented.
   *
   * Derived on the server from the session's channel, never from the snapshot:
   * the snapshot is the customer-facing whitelist and has no business carrying
   * a fact about how the advisor sent it.
   */
  selfServe: boolean
  /** Set once the customer has typed their name and sent it. */
  authorized: TabletAuthorisation | null
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
      selfServe: boolean
      authorized: TabletAuthorisation | null
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
 *  - The customer finished a self-serve menu. The answers are a record now and
 *    the server refuses further taps, so a tap still in flight is one nobody is
 *    holding up — leaving it painted over a read-only list would put an answer
 *    on the glass that the authorisation does not contain.
 *
 * So: `pending` survives if and only if the session id is unchanged and the
 * session has not been authorised.
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
  const finished = poll.session.authorized !== null

  return {
    state: {
      phase: 'PRESENTING',
      sessionId: poll.session.id,
      deviceName: poll.deviceName,
      snapshot: poll.session.snapshot,
      decisions: poll.session.decisions,
      selfServe: poll.session.selfServe,
      authorized: poll.session.authorized,
    },
    pending: sameSession && !finished ? pending : {},
  }
}

/**
 * The customer typed their name and sent it.
 *
 * Applied here rather than waiting for the next poll because the screen has to
 * change under their hand: they pressed the button, and up to a poll of a menu
 * that still takes taps would be the product looking like it lost the one
 * action that matters most in the whole flow.
 *
 * The taps in flight go with it, for the reason in `nextTabletState`. Anything
 * that had already reached the server is in `decisions` and is what was frozen
 * into the authorisation; anything that had not is refused from this moment on,
 * so it belongs on no screen.
 *
 * A no-op on any other phase, and on a session that is already authorised: the
 * record stops moving, and a second confirmation must not rewrite whose name
 * is on the first.
 */
export function withAuthorisation(
  screen: { state: TabletState; pending: PendingTaps },
  authorized: TabletAuthorisation,
): { state: TabletState; pending: PendingTaps } {
  if (screen.state.phase !== 'PRESENTING' || screen.state.authorized) return screen
  return { state: { ...screen.state, authorized }, pending: {} }
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
 *
 * `answered` is the three real answers and never `PENDING`: a customer who taps
 * a choice and taps it again has taken it back, which is an absence rather than
 * an answer. It is the figure a handed-over tablet shows above its confirm bar
 * and the one the advisor's mirror reads back — one derivation, so "4 of 6
 * answered" cannot mean two different things on the two screens describing the
 * same moment.
 */
export interface MenuTotals {
  accepted: number
  declined: number
  callMe: number
  /** Accepted, declined and call-me together. What "N of M answered" counts. */
  answered: number
  acceptedTotal: number
}

export function menuTotals(
  snapshot: DeviceSnapshot,
  decisions: Record<string, string>,
): MenuTotals {
  const items = snapshot.tiers.flatMap((t) => t.items)
  const count = (value: string) => items.filter((i) => decisions[i.id] === value).length

  const accepted = items.filter((i) => decisions[i.id] === 'ACCEPTED')
  const declined = count('DECLINED')
  const callMe = count('CALL_ME')

  return {
    accepted: accepted.length,
    declined,
    callMe,
    answered: accepted.length + declined + callMe,
    acceptedTotal: accepted
      .filter((i) => i.priceConfirmed !== false)
      .reduce((sum, i) => sum + i.customerOutOfPocket, 0),
  }
}
