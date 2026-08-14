'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { safeRedirect } from '@/lib/auth/routes'

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
  const next = safeRedirect(String(formData.get('next') ?? ''))

  if (!email || !password) return { error: 'Enter your email and password.' }

  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'That email and password did not match. Please try again.' }
  }

  revalidatePath('/', 'layout')
  redirect(next)
}

export async function signOut(): Promise<never> {
  const supabase = await getSupabaseServerClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
