'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { accountShape } from '@/lib/auth/session'
import { signInDestination } from '@/lib/auth/routes'
import { FixedWindowLimiter } from '@/lib/rate-limit/window'

export interface SignInState {
  error?: string
}

/**
 * Email and password sign-in.
 *
 * Errors come back as a single generic sentence on purpose: distinguishing
 * "no such account" from "wrong password" tells an attacker which addresses
 * are real, which is how credential stuffing gets targeted.
 */
/**
 * Ten failed attempts per address per fifteen minutes.
 *
 * Keyed on the email rather than the caller's IP. A dealership sits behind one
 * NAT — the whole service drive shares an address — so limiting by IP would
 * let one advisor mistyping their password lock out the shop. Keying on the
 * address being attacked also matches the thing worth stopping: somebody
 * working a list of stolen credentials against one account.
 *
 * Ten because a real person mistypes, and being locked out of your own drive
 * with a customer standing there is its own kind of failure. Cleared on a
 * successful sign-in.
 *
 * Read the note in ./window: these counters are per instance, so this is a
 * speed bump against the cheap version and not a defence against a distributed
 * one. Supabase applies its own limits underneath.
 */
const signInLimiter = new FixedWindowLimiter({ limit: 10, windowMs: 15 * 60_000 })

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const requested = String(formData.get('next') ?? '')

  if (!email || !password) return { error: 'Enter your email and password.' }

  const gate = signInLimiter.check(email, Date.now())
  if (!gate.ok) {
    /*
      Deliberately the same shape of message as a wrong password, minus the
      timing. Saying "too many attempts for this account" would confirm the
      address exists, which is the one thing the generic error above exists to
      avoid — and it would confirm it to somebody who has just proved they are
      guessing.
    */
    const minutes = Math.ceil(gate.retryAfterSeconds / 60)
    return {
      error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    }
  }

  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return { error: 'That email and password did not match. Please try again.' }
  }

  // One good sign-in clears the count, so somebody who mistyped twice this
  // morning is not one slip from being shut out this afternoon.
  signInLimiter.reset(email)
  revalidatePath('/', 'layout')

  /*
    Somewhere they were already headed wins outright; otherwise the account
    decides. `requested` must arrive raw — the login page used to resolve it
    first, which made every sign-in look like it had asked for /drive and sent
    DealerTech staff to a page that turned them straight back here.
  */
  redirect(signInDestination(requested, await accountShape(data.user.id)))
}

export async function signOut(): Promise<never> {
  const supabase = await getSupabaseServerClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
