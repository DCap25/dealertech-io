/**
 * Which paths need a session.
 *
 * Pure and unit-tested, because route protection is exactly the kind of logic
 * that looks obviously correct and quietly leaks a surface. Deny-by-default:
 * anything not explicitly public requires a signed-in user, so adding a page
 * protects it automatically rather than only when someone remembers.
 */

/** Reachable signed out. Everything else is protected. */
const PUBLIC_PREFIXES = [
  '/login',
  '/auth', // callback + sign-out handlers
  '/demo', // the marketing demo surface
  /**
   * Getting an account in the first place.
   *
   * Both are reached by definition without a session — a prospect starting a
   * trial has none, and an advisor holding an invitation link does not have one
   * yet either. Gating `/invite` was not a theoretical problem: deny-by-default
   * silently turned every invitation into a redirect to a sign-in page for an
   * account that does not exist, which is a dead end with no way out of it.
   *
   * Neither is unauthenticated in the sense of unguarded. `/signup` creates
   * only a brand-new tenant, and `/invite/<token>` shows nothing without 32
   * random bytes and grants only the role that was named when it was issued.
   */
  '/signup',
  '/invite',
  /**
   * A menu link sent to a customer's phone.
   *
   * The person opening it is a customer, not a user — there is no account and
   * never will be, so deny-by-default would send them to a sign-in page for
   * something they cannot have. The token in the URL is the whole authority:
   * 32 random bytes, hashed at rest, expiring in twelve hours, scoped to one
   * visit.
   *
   * Short path on purpose. This goes in a text message, where every character
   * is one more chance of a line break landing in the middle of the token.
   */
  '/m',
  /**
   * The customer tablet. Not public in the sense of open — every action on
   * /api/device is authenticated by the device's own bearer token, and /present
   * shows nothing at all until a tablet has been claimed by an advisor.
   *
   * It is here because a tablet is not a person and has no session cookie to
   * carry. Gating it behind the staff redirect would send a device in a
   * customer's hands to a dealership sign-in page.
   */
  '/present',
  '/api/device',
  /**
   * Scheduled jobs.
   *
   * Public only in the routing sense. Every handler under here authenticates a
   * shared secret and refuses outright when one is not configured — but a
   * scheduler firing at six in the morning has no session cookie, so leaving
   * this to deny-by-default meant Netlify's cron got a redirect to the sign-in
   * page and the job silently never ran.
   */
  '/api/cron',
  /**
   * Stripe's deliveries.
   *
   * Public for exactly the reason `/api/cron` is — Stripe carries no session
   * cookie, and deny-by-default would answer every webhook with a redirect to
   * the sign-in page, leaving billing silently broken in a way that looks like
   * "no customers have paid yet".
   *
   * The guard is the signature, verified against a secret that must be set:
   * an unset `STRIPE_WEBHOOK_SECRET` refuses every request rather than
   * accepting unverified JSON that could mark any dealership as paid.
   */
  '/api/webhooks',
]

/** Never gated: static assets, framework internals, health checks. */
const UNGATED_PREFIXES = ['/_next', '/favicon', '/api/health']

/** The marketing site itself is public; the workspace is not. */
const PUBLIC_EXACT = ['/']

export function isPublicPath(pathname: string): boolean {
  if (UNGATED_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (PUBLIC_EXACT.includes(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Where to send someone after signing in.
 *
 * Only same-origin paths are honoured. An open redirect on a login form is a
 * standard phishing primitive: a link that signs a user in and bounces them to
 * a lookalike host harvests the next thing they type.
 */
export function safeRedirect(target: string | null | undefined, fallback = '/drive'): string {
  if (!target) return fallback
  if (!target.startsWith('/')) return fallback
  // "//evil.com" and "/\evil.com" are protocol-relative URLs, not local paths.
  if (target.startsWith('//') || target.startsWith('/\\')) return fallback
  return target
}

/**
 * Where a freshly signed-in account belongs when it did not ask for anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST /drive
 * ---------------------------------------------------------------------------
 * DealerTech staff hold no dealership role, so the workspace has nothing to
 * show them. Sending them to /drive meant `requireUser()` turned them straight
 * back to the sign-in page, and the only route out was a second bounce that
 * happened to land on the console — a three-hop chain where every hop had to
 * agree about the session, and any disagreement between them is an infinite
 * redirect between /login and /admin rather than a page.
 *
 * Deciding the destination once, at the point we already know who signed in,
 * removes the chain. Pure so the decision is testable without a session.
 */
export function landingPath(account: {
  /** Holds at least one active role at an active dealership. */
  hasStore: boolean
  isPlatformAdmin: boolean
}): string {
  if (account.hasStore) return '/drive'
  if (account.isPlatformAdmin) return '/admin'
  /*
    Neither. An invited user before anybody granted them a role — /drive sends
    them to the sign-in page, which is the surface that explains that state.
  */
  return '/drive'
}

/**
 * Where sign-in sends someone, given what they asked for and what they are.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FUNCTION
 * ---------------------------------------------------------------------------
 * The first attempt at this lived inline in the sign-in action and was dead on
 * arrival, because the login page ran `safeRedirect(next)` before rendering the
 * form. That turns an absent `?next=` into "/drive", so the action saw an
 * explicit request on every single sign-in and never reached the branch that
 * looks at the account. The bug was invisible in review and only showed up as
 * "signing in still doesn't work".
 *
 * Pulling it out makes the distinction that matters — asked for nothing, vs
 * asked for the drive — a thing tests can hold, rather than a property of how
 * two files happen to be wired together.
 *
 * `requested` must be the raw value from the query string. Empty means the
 * account decides.
 */
export function signInDestination(
  requested: string | null | undefined,
  account: { hasStore: boolean; isPlatformAdmin: boolean },
): string {
  if (!requested) return landingPath(account)
  // Sanitised here, so callers can pass user input through untouched.
  return safeRedirect(requested)
}
