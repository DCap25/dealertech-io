'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { accountShape } from '@/lib/auth/session'
import { landingPath, safeRedirect } from '@/lib/auth/routes'

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
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const requested = String(formData.get('next') ?? '')

  if (!email || !password) return { error: 'Enter your email and password.' }

  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return { error: 'That email and password did not match. Please try again.' }
  }

  revalidatePath('/', 'layout')

  // Somewhere they were headed before being asked to sign in wins outright.
  if (requested) redirect(safeRedirect(requested))

  /*
    Otherwise the destination depends on what this account actually is.

    Defaulting to /drive sent DealerTech staff — who hold no dealership role —
    to a page that immediately turned them back to the sign-in form, which is
    indistinguishable from the sign-in having failed.
  */
  redirect(landingPath(await accountShape(data.user.id)))
}

export async function signOut(): Promise<never> {
  const supabase = await getSupabaseServerClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
