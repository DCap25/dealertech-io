import 'server-only'
import { redirect } from 'next/navigation'
import { salesHome } from './routes'

/**
 * The fence around the smallest role in the product.
 *
 * ---------------------------------------------------------------------------
 * ONE HELPER, NOT A PERMISSIONS FRAMEWORK
 * ---------------------------------------------------------------------------
 * A `SALES` account exists to do exactly one thing — walk a delivery to the
 * service drive and book the first visit (DRIVE_PLAN D5) — and DRIVE_PLAN §9
 * Q2's recommendation is that it may not book anything else. That is a real
 * fence and it needs to hold, but it is also *one rule about one role*, and
 * building a capability system to express it would be inventing an abstraction
 * for a single case. So: one function, called at the top of the workspace
 * pages, next to the `requireUser()` they already call.
 *
 * A redirect rather than `notFound()`, which is what the manager-only pages do
 * to everyone else. The distinction is whether the person has somewhere to be.
 * An advisor who opens /team has no other page waiting for them and a 404 is
 * the honest answer; a salesperson always has /introduce, and bouncing them
 * there turns a wrong turn into the right screen instead of a dead end. It is
 * also the difference between a nav link they should not have followed and a
 * bookmark from before the role existed.
 *
 * This is a guard on top of deny-by-default, not instead of it — the middleware
 * still stops anonymous requests, `requireUser()` still resolves identity
 * server-side, and the roster still decides what role anybody holds.
 */

/**
 * Send a salesperson home, or do nothing.
 *
 * Takes the role rather than the whole user so a caller cannot accidentally
 * pass a session that has not been through `requireUser()`, and so the pure
 * decision (`salesHome`) stays in routes.ts where it is tested without a
 * request.
 *
 * `redirect()` throws, which is how Next unwinds a server component — so this
 * returns nothing and callers must not treat it as a boolean.
 */
export function fenceSales(role: string): void {
  const home = salesHome(role)
  if (home) redirect(home)
}

/**
 * The other half, for server actions.
 *
 * A server action is a POST endpoint whether or not a page ever rendered, so
 * fencing the pages is not fencing the workflow — `bookAppointment` has to
 * refuse a salesperson booking an ordinary appointment with a hand-rolled
 * request, and refusing is a returned error rather than a redirect because the
 * caller is a form waiting for one.
 */
export function isSalesRole(role: string): boolean {
  return role === 'SALES'
}
