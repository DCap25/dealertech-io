'use server'

import { revalidatePath } from 'next/cache'
import { authoriseLinkSession, recordLinkDecisions } from '@/lib/presentation/link-store'
import { isUsableAuthorisationName } from '@/lib/presentation/link'
import type { Decision } from '@/lib/presentation/decisions'

/**
 * The customer's side of a menu link.
 *
 * No session guard, because there is no session to guard: the person here is a
 * customer, not a user, and the token in the URL is the entire authority. Every
 * function re-reads it rather than trusting anything the page passed down —
 * these are POST endpoints and the link may have expired, been closed by the
 * advisor, or already been authorised since the page rendered.
 */

export async function saveAnswer(token: string, id: string, decision: Decision): Promise<void> {
  await recordLinkDecisions(token, { [id]: decision }, new Date())
  revalidatePath(`/m/${token}`)
}

export interface AuthoriseState {
  error?: string
  done?: boolean
}

export async function authorise(
  _previous: AuthoriseState,
  formData: FormData,
): Promise<AuthoriseState> {
  const token = String(formData.get('token') ?? '')
  const name = String(formData.get('name') ?? '')

  if (!isUsableAuthorisationName(name)) {
    return { error: 'Please type your name to confirm.' }
  }

  const session = await authoriseLinkSession(token, name, new Date())
  if (!session) return { error: 'This link is no longer valid.' }
  if (session.status !== 'AUTHORIZED') {
    // Expired or closed between the page rendering and this submit. The page
    // will re-render and explain which.
    revalidatePath(`/m/${token}`)
    return { error: 'This link is no longer accepting answers.' }
  }

  revalidatePath(`/m/${token}`)
  return { done: true }
}
