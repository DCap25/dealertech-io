/**
 * How long a menu may stay on a tablet.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A CLOCK AT ALL
 * ---------------------------------------------------------------------------
 * A tablet session used to end only when an advisor took it back or pushed
 * something else. Neither is guaranteed to happen: a customer walks off with
 * the keys, the advisor is called to a car, and a device on a bench spends the
 * night showing a named person, their vehicle, its mileage, what a technician
 * found and what it costs — to anyone who walks past. The idle screen already
 * states the intent ("a tablet between visits should tell a passer-by nothing
 * about the last customer who held it"); this is what makes it true without
 * relying on somebody remembering.
 *
 * ---------------------------------------------------------------------------
 * WHY IDLE, NOT A CAP FROM THE PUSH
 * ---------------------------------------------------------------------------
 * The clock runs from the last customer tap, not from the moment the advisor
 * sent the menu. A cap measured from the push would eventually blank the screen
 * of somebody halfway through answering it, which is the one thing this must
 * never do — and it becomes likelier, not less, if we ever hand the tablet over
 * and let a customer work through the list on their own. Every tap bumps
 * `lastActivityAt` (`recordDeviceDecisions`), so an engaged customer resets the
 * clock simply by being engaged, and only a screen nobody is touching expires.
 *
 * Thirty minutes: long enough that no real conversation at a podium is cut
 * short, short enough that a tablet clears itself before the next customer
 * walks up to it.
 *
 * Pure and I/O-free. Enforcement lives in `activeSessionForDevice`, on read, so
 * it holds regardless of who forgot to end what.
 */

/** Minutes of no customer taps before a tablet session is over. */
export const SESSION_IDLE_MINUTES = 30

/** The moment a session whose last tap was `lastActivityAt` is over. */
export function sessionIdleDeadline(lastActivityAt: Date): Date {
  return new Date(lastActivityAt.getTime() + SESSION_IDLE_MINUTES * 60_000)
}

/**
 * Has this session gone quiet for long enough to end?
 *
 * `>=` at the deadline, matching `isPairingExpired`. The boundary belongs to
 * the expiry either way; being consistent about which side it falls on is worth
 * more than the millisecond.
 */
export function isSessionIdle(lastActivityAt: Date, asOf: Date): boolean {
  return asOf >= sessionIdleDeadline(lastActivityAt)
}
