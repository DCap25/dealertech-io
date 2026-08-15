'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { accountShape } from '@/lib/auth/session'
import { signInDestination } from '@/lib/auth/routes'

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
