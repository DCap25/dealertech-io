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
