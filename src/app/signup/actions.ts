'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { provisionTenant } from '@/lib/invites/provision'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { knownMakes } from '@/lib/warranty'

export interface SignUpState {
  error?: string
}

const MIN_PASSWORD = 10

export async function createDealership(
  _previous: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const dealershipName = String(formData.get('dealershipName') ?? '').trim()
  const franchiseMake = String(formData.get('franchiseMake') ?? '').trim().toUpperCase()
  const state = String(formData.get('state') ?? '').trim().toUpperCase()
  const laborRate = Number(formData.get('laborRate') ?? 0)
  const adminName = String(formData.get('adminName') ?? '').trim()
  const adminEmail = String(formData.get('adminEmail') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!dealershipName) return { error: 'Enter the dealership name.' }
  if (!adminName) return { error: 'Enter your name.' }
  if (!adminEmail.includes('@')) return { error: 'Enter your work email address.' }
  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters. Length beats complexity.` }
  }
  if (state && state.length !== 2) return { error: 'Use the two-letter state code.' }
  if (!Number.isFinite(laborRate) || laborRate <= 0) {
    return { error: 'Enter your door rate — every estimate is priced from it.' }
  }

  /*
    The brand has to be one the warranty engine actually knows.

    Accepting a free-text make would produce a dealership whose every coverage
    answer is "no reference data", which looks like a broken product rather
    than a missing program.
  */
  if (franchiseMake && !knownMakes().includes(franchiseMake)) {
    return { error: 'Pick your franchise brand from the list.' }
  }

  const result = await provisionTenant({
    dealershipName,
    franchiseMake: franchiseMake || null,
    state: state || null,
    laborRate,
    adminName,
    adminEmail,
  }, password)

  if (!result.ok) return { error: result.error }

  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email: result.email, password })
  if (error) redirect('/login')

  revalidatePath('/', 'layout')
  redirect('/team')
}
