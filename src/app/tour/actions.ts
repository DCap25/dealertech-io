'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { FixedWindowLimiter, callerKey } from '@/lib/rate-limit/window'
import {
  TOUR_CODE_UNKNOWN,
  isTourRole,
  isWellFormedTourCode,
  normalizeTourCode,
  tourCodeStatusMessage,
  tourRole,
  type TourRole,
} from '@/lib/demo-tour/codes'
import { findTourCode, recordTourRedemption } from '@/lib/demo-tour/store'

/**
 * The gated demo tour: enter a code, pick a role, land in the workspace.
 *
 * ===========================================================================
 * HOW THE VISITOR IS SIGNED IN, AND WHY THIS WAY
 * ===========================================================================
 * Two options were real. The choice is `signInWithPassword` on the server with
 * a server-only `DEMO_TOUR_PASSWORD`, and the reasoning is worth keeping
 * because the rejected option is the one that looks more sophisticated.
 *
 * CHOSEN — server-side signInWithPassword.
 *   It is the same call `/login`'s `signIn` action already makes, through the
 *   same `getSupabaseServerClient()`, so the session cookie is written by the
 *   same code with the same httpOnly/sameSite/secure options — see the long
 *   note in src/lib/supabase/server.ts, which the public security page depends
 *   on. Nothing new about how a session comes into being, which matters for a
 *   surface reachable by anyone on the internet.
 *
 *   The password is read from `process.env` inside a server action and used in
 *   a server-to-Supabase call. It is never serialised into the RSC payload,
 *   never a prop, never a form value. It is deliberately NOT
 *   `NEXT_PUBLIC_DEMO_PASSWORD`: that one exists to prefill the one-tap cards
 *   on the sign-in page in development and is compiled into the browser bundle
 *   by definition, so reusing it here would publish the demo credential to
 *   every visitor of a deployed site.
 *
 * REJECTED — admin.generateLink with the service-role key.
 *   `src/lib/supabase/admin.ts` exists and holds `SUPABASE_SECRET_KEY`, which
 *   bypasses row-level security across the entire project. Today it is reached
 *   only from document storage, behind a signed-in staff session. Putting it on
 *   a public, unauthenticated code-entry route changes what a flaw in that
 *   route is worth: from "one demo account's password" to "every dealership's
 *   customers". It also needs a second hop — generateLink returns a one-time
 *   token that has to be verified, which either redirects through
 *   `/auth/confirm` or calls `verifyOtp`, adding a credential in transit and a
 *   failure mode for no gain. The tour signs into an account that already
 *   exists and whose password we control; a magic link solves a problem we do
 *   not have.
 *
 * Consequence worth stating: if `DEMO_TOUR_PASSWORD` is unset, the tour refuses
 * rather than guessing. A demo surface that quietly falls back to a committed
 * default is how a public password ships.
 *
 * ===========================================================================
 * WHY THERE IS NO COOKIE UNTIL THE ROLE IS PICKED
 * ===========================================================================
 * The obvious design puts the validated code in a short-lived cookie so the
 * role picker can find it again. This carries it in a hidden field instead, and
 * the reason is `/legal/cookies`: that page tells the world an anonymous
 * visitor to this site receives zero cookies and that signing in is the first
 * one. A cookie set by a code-entry form would make that false, and the fix
 * would be a paragraph explaining an exception rather than a promise anybody
 * can check. The visitor typed the code; holding it in their own form until
 * they press the button costs nothing.
 *
 * So the cookie policy needs no change: the only cookie this flow sets is the
 * Supabase session, and it is set at a sign-in, which is what that page already
 * says. Confirmed rather than assumed.
 */

/**
 * Ten attempts per address per ten minutes.
 *
 * Keyed on the caller, which is the opposite of the sign-in form's choice and
 * right for the opposite reason. There, keying on the IP would let one advisor
 * mistyping a password lock out a whole dealership behind one NAT. Here there
 * is no account to lock out — the thing being guessed is a ten-character code
 * with about fifty bits behind it, and the only sensible bucket is whoever is
 * doing the guessing.
 *
 * Both actions share one limiter on purpose. Two limiters would let a script
 * spend its allowance on the entry form and then spend it again on the role
 * picker, which re-validates the same code and would therefore be the cheaper
 * oracle of the two.
 *
 * Read the note in src/lib/rate-limit/window.ts: these counters live in one
 * instance's memory, so this is a speed bump against the cheap version and not
 * a defence against a distributed one. At fifty bits, the speed bump is enough.
 */
const tourLimiter = new FixedWindowLimiter({ limit: 10, windowMs: 10 * 60_000 })

async function gate(): Promise<string | null> {
  const key = callerKey(await headers())
  const result = tourLimiter.check(key, Date.now())
  if (result.ok) return null
  const minutes = Math.ceil(result.retryAfterSeconds / 60)
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or email dan@dealertech.io.`
}

export interface TourGateState {
  error?: string
  /** Set once a code has checked out. Carries the raw code back to the picker. */
  unlocked?: { code: string; label: string }
}

/**
 * Step one: does this code open anything?
 *
 * Validation only. No session, no cookie, no counter — the count belongs to a
 * tour that was actually walked, and somebody who enters a code and closes the
 * tab has not walked one.
 */
export async function unlockTour(
  _previous: TourGateState,
  formData: FormData,
): Promise<TourGateState> {
  const blocked = await gate()
  if (blocked) return { error: blocked }

  const raw = String(formData.get('code') ?? '')
  if (!raw.trim()) return { error: 'Enter the code we gave you.' }
  if (!isWellFormedTourCode(raw)) {
    // Shape, not existence. Said plainly because a prospect who dropped a
    // character deserves better than "not one of ours".
    return { error: 'A tour code is ten characters. Check it and try again.' }
  }

  const found = await findTourCode(raw, new Date())
  if (!found.found) return { error: TOUR_CODE_UNKNOWN }
  if (found.status !== 'VALID') return { error: tourCodeStatusMessage(found.status) }

  return { unlocked: { code: normalizeTourCode(raw), label: found.label } }
}

export interface TourStartState {
  error?: string
}

/**
 * Step two: sign in as the seeded staff member for the chosen role.
 *
 * The code is re-validated rather than trusted from the hidden field. It has to
 * be: the field is in the visitor's own browser, so the only thing step one
 * proved is that *a* valid code existed at that moment. Re-checking also means
 * a code Dan revokes mid-demo stops working on the next click rather than
 * whenever the tab is closed.
 */
export async function startTour(
  _previous: TourStartState,
  formData: FormData,
): Promise<TourStartState> {
  const blocked = await gate()
  if (blocked) return { error: blocked }

  const raw = String(formData.get('code') ?? '')
  const roleInput = String(formData.get('role') ?? '')

  if (!isTourRole(roleInput)) return { error: 'Pick one of the three roles.' }
  const role: TourRole = roleInput

  const found = await findTourCode(raw, new Date())
  if (!found.found) return { error: TOUR_CODE_UNKNOWN }
  if (found.status !== 'VALID') return { error: tourCodeStatusMessage(found.status) }

  const password = process.env.DEMO_TOUR_PASSWORD
  if (!password) {
    /*
      Refuse rather than fall back. `DEMO_PASSWORD` sits in .env.example with a
      committed value, and reaching for it here would mean a deployment that
      forgot to set this variable quietly opens the tour to the password
      printed in a public-shaped file. The same reasoning the cron endpoint and
      the Stripe webhook both use: an unset secret refuses every request rather
      than falling open.
    */
    return {
      error: 'Tours are not configured on this deployment. Email dan@dealertech.io and we will sort it out.',
    }
  }

  const { email, home } = tourRole(role)
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    /*
      Almost always one thing: the demo accounts were rotated with
      `npm run demo:rotate` and DEMO_TOUR_PASSWORD was not updated to match.
      Said in a way a prospect can act on without describing the mechanism.
    */
    console.error('[demo-tour] could not sign in the demo account:', error?.message)
    return { error: 'The tour account would not open. Email dan@dealertech.io — that one is on us.' }
  }

  // After the sign-in, deliberately: a redemption that never got in is not one.
  await recordTourRedemption({ codeId: found.id, role, demoUserId: data.user.id })

  revalidatePath('/', 'layout')
  redirect(home)
}
