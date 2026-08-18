'use server'

import { revalidatePath } from 'next/cache'
import { authoriseLinkSession, recordLinkDecisions } from '@/lib/presentation/link-store'
import {
  isUsableAuthorisationName, linkStatusMessage, refusalFromStatus,
  type LinkRefusal, type LinkStatus,
} from '@/lib/presentation/link'
import type { Decision } from '@/lib/presentation/decisions'

/**
 * The customer's side of a menu link.
 *
 * No session guard, because there is no session to guard: the person here is a
 * customer, not a user, and the token in the URL is the entire authority. Every
 * function re-reads it rather than trusting anything the page passed down —
 * these are POST endpoints and the link may have expired, been closed by the
 * advisor, or already been authorised since the page rendered.
 *
 * Both of them now answer with what the server did, rather than accepting the
 * tap and saying nothing. The guard was always correct; the failure was that a
 * customer working through an expired menu watched every answer register and
 * found out at the button that none of it had been kept (F9).
 */

/**
 * Record one tap.
 *
 * Returns the status the link was in when the write was judged — `OPEN` means
 * the answer landed. Null is the token not resolving at all, which the caller
 * turns into the same kind of sentence; see `refusalFromStatus`.
 *
 * Deliberately does not revalidate. The page renders from the token on every
 * load and the running menu lives in the customer's own screen, so re-rendering
 * it on every tap bought nothing and cost a round trip on the phone least able
 * to afford one. A refusal is now told to the screen where the tap happened,
 * which keeps the customer's answers in front of them instead of replacing the
 * menu with a notice — the best possible proof of "nothing you chose has been
 * lost" is the list still showing what they chose.
 */
export async function saveAnswer(
  token: string,
  id: string,
  decision: Decision,
): Promise<LinkStatus | null> {
  const session = await recordLinkDecisions(token, { [id]: decision }, new Date())
  return session?.status ?? null
}

export interface AuthoriseState {
  error?: string
  done?: boolean
  /** Set when the link itself is the problem, so the menu can say so and stop. */
  refused?: LinkRefusal
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
  if (session?.status !== 'AUTHORIZED') {
    /*
      Expired, closed, or gone between the page rendering and this submit.

      Told in the same words and by the same mechanism as a refused tap: one
      sentence from `linkStatusMessage`, and the menu goes read-only where the
      customer is standing. It used to revalidate and let the page replace
      itself with a notice, which said the right thing but took their answers
      off the screen while doing it — and disagreed with the wording the save
      path is now using two feet away.

      `?? 'UNKNOWN'` is not reachable: `authoriseLinkSession` either authorises
      an open row or returns the reason it would not. It keeps the type total
      rather than asserting a case away.
    */
    const refused = refusalFromStatus(session?.status ?? null) ?? 'UNKNOWN'
    return { error: linkStatusMessage(refused), refused }
  }

  // This one does revalidate, unlike a tap: the authorisation is a fact about
  // the row now, and the page has to render it as one — a reload must show what
  // they confirmed and who confirmed it, not an open menu.
  revalidatePath(`/m/${token}`)
  return { done: true }
}
