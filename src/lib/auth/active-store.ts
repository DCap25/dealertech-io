/**
 * Which dealership a request is for.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 * ---------------------------------------------------------------------------
 * This is the function standing between two dealerships' customer lists, and
 * `session.ts` is marked `server-only` — which is correct for anything touching
 * cookies and Supabase, and also means nothing there can be unit tested. The
 * decision is pure, so it lives here where it can be proved, and the request
 * plumbing stays where it belongs.
 */

export type StaffRole = 'ADVISOR' | 'BDC' | 'SERVICE_MANAGER' | 'TECHNICIAN' | 'ADMIN'

/** One rooftop this person works at, and what they are there. */
export interface StoreMembership {
  storeId: string
  storeName: string
  role: StaffRole
}

/**
 * The cookie naming the rooftop being worked right now.
 *
 * A preference, never a permission. See `resolveActiveStore`.
 */
export const ACTIVE_STORE_COOKIE = 'dt_active_store'

/**
 * Pick the active rooftop from the ones this user actually works.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 * `requested` comes off a cookie, so it is attacker-controlled. It is used only
 * to *pick* from the list of stores the user provably holds an active role at —
 * never to look one up. Anything not on that list is ignored and they get their
 * own first rooftop, so pasting another dealership's uuid into devtools changes
 * nothing.
 *
 * The role comes from the chosen membership too, not from the first one: a
 * person can advise at one store and manage another, and reading the role off
 * the wrong row would hand someone a department view they do not hold.
 */
export function resolveActiveStore(
  memberships: StoreMembership[],
  requested: string | undefined,
): StoreMembership | null {
  if (memberships.length === 0) return null
  return memberships.find((m) => m.storeId === requested) ?? memberships[0]!
}
