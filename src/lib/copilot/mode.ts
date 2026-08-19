import type { CopilotIntent } from './types'

/**
 * Two decisions about where the Co-Pilot appears and what it is answering.
 *
 * Both live here rather than in the route and the component because both are
 * the kind of thing that looks obvious and is quietly wrong at one edge — a
 * question about the product grounded in a customer's coverage, or a chat box
 * floating over a screen a customer is holding. The route handler and the
 * launcher stay thin; the decisions are pure and tested.
 */

export type CopilotMode = 'VISIT' | 'APP_HELP'

export type ModeSelection =
  | { mode: 'APP_HELP' }
  | { mode: 'VISIT'; appointmentId: string }
  | { error: string }

/**
 * Which competence is being asked for.
 *
 * The intent decides, not the payload. `APP_HELP` never touches a visit even
 * when the question was asked from inside a prep sheet — the app-help grounding
 * is the product guide and the asker's role, and no customer belongs in it. A
 * visit intent without an appointment has nothing to be grounded in, and
 * answering it from the guide would silently turn "what should I present next"
 * into a tour of the software.
 */
export function selectMode(input: {
  intent: CopilotIntent
  appointmentId?: string | undefined
}): ModeSelection {
  if (input.intent === 'APP_HELP') return { mode: 'APP_HELP' }
  if (input.appointmentId) return { mode: 'VISIT', appointmentId: input.appointmentId }
  return { error: 'appointmentId is required for a question about a visit.' }
}

/**
 * Does the floating help button belong on this path?
 *
 * ---------------------------------------------------------------------------
 * THE CUSTOMER SURFACES ARE EXCLUDED TWICE, ON PURPOSE
 * ---------------------------------------------------------------------------
 * The launcher is mounted in `AppFrame`, and `/present` and `/m/[token]` are
 * wrapped by `CustomerFrame` instead — a different component in a different
 * module, so a customer holding a tablet or opening a menu link neither renders
 * the launcher nor receives its JavaScript. That separation is the real
 * guarantee and it is structural.
 *
 * They are named here anyway. The frames are separate to keep a dealership's
 * billing state and now its staff tooling off a customer's screen, and somebody
 * who does not know that could reasonably "simplify" the two back into one.
 * This list makes the second mistake fail loudly rather than shipping a chat
 * box onto a customer's phone.
 *
 * ---------------------------------------------------------------------------
 * AND THE PREP SHEET, WHICH ALREADY HAS ONE
 * ---------------------------------------------------------------------------
 * `/drive/[appointmentId]` mounts its own Co-Pilot launcher, sitting above that
 * screen's sticky action bar and opening onto the visit. Two floating buttons
 * in one corner is worse than either. The visit panel there answers app-help
 * questions too — see the "How this screen works" action — so nothing is lost
 * by standing down on that one path.
 */
export function showsHelpLauncher(pathname: string): boolean {
  // Screens a customer holds. Never, under any circumstances.
  if (pathname === '/present' || pathname.startsWith('/present/')) return false
  if (pathname === '/m' || pathname.startsWith('/m/')) return false

  // Signed-out doors and the marketing site. They are not the product, and
  // there is no signed-in user for the API to answer as.
  if (pathname === '/' || pathname === '/demo' || pathname.startsWith('/demo/')) return false
  if (pathname === '/login' || pathname.startsWith('/login/')) return false
  if (pathname === '/signup' || pathname.startsWith('/signup/')) return false
  if (pathname === '/invite' || pathname.startsWith('/invite/')) return false

  /*
    The trust and legal pages, for the same reason. None of them mounts the
    workspace frame today, so nothing renders the launcher there in practice —
    but this function is the written answer to "is this the product?", and
    leaving it answering yes for /legal/terms makes it wrong about a page it
    describes rather than merely unused.
  */
  for (const page of ['/legal', '/security', '/compliance', '/responsible-ai', '/status', '/press']) {
    if (pathname === page || pathname.startsWith(`${page}/`)) return false
  }

  /*
    DealerTech's own console. Not the dealership product, and a platform admin
    holding no store role has no `getCurrentUser()` for the endpoint to answer
    as — the button would be there and every tap would 401.
  */
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false

  // The prep sheet has its own. Every other page under /drive does not.
  if (pathname.startsWith('/drive/')) {
    const rest = pathname.slice('/drive/'.length)
    return rest === 'week' || rest === 'book'
  }

  return true
}
