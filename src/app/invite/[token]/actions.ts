'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { acceptInvite, loadInvite } from '@/lib/invites/accept'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { inviteStatusMessage } from '@/lib/invites/invite'

export interface AcceptState {
  error?: string
}

/**
 * The minimum a password has to clear.
 *
 * Length only. Composition rules — a digit, a symbol, a capital — push people
 * towards `Password1!` and are no longer recommended by NIST; length is what
 * actually costs an attacker anything.
 */
const MIN_PASSWORD = 10

export async function acceptInvitation(
  _previous: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get('token') ?? '')
  const fullName = String(formData.get('fullName') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!fullName) return { error: 'Enter your name as you want it to appear on repair orders.' }
  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters. Length beats complexity.` }
  }

  const now = new Date()

  /*
    Re-read and re-check rather than trusting the page that rendered the form.

    The invitation could have been revoked, used, or expired between the page
    load and this submit, and this is a POST endpoint that anybody can call
    with any token.
  */
  const invite = await loadInvite(token, now)
  if (!invite) return { error: 'This invitation link is not valid.' }
  if (invite.status !== 'VALID') return { error: inviteStatusMessage(invite.status) }

  const result = await acceptInvite(invite, fullName, password, now)
  if (!result.ok) return { error: result.error }

  // Sign them straight in. Being told "account created, now go and log in"
  // after typing a password you just chose is a pointless extra step.
  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email: result.email, password })
  if (error) redirect('/login')

  revalidatePath('/', 'layout')
  redirect('/drive')
}
