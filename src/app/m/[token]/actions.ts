'use server'

import { revalidatePath } from 'next/cache'
import { accessForStore } from '@/lib/auth/session'
import {
  authoriseLinkSession, linkSessionFromToken, recordLinkDecisions,
} from '@/lib/presentation/link-store'
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
  const now = new Date()

  const refused = await suspendedDealership(token, now)
  if (refused) return refused

  const session = await recordLinkDecisions(token, { [id]: decision }, now)
  return session?.status ?? null
}

/**
 * The dealership behind this link cannot save anything right now.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `checkWork`, WHICH IS WHAT EVERY OTHER WRITE USES
 * ---------------------------------------------------------------------------
 * Because `checkWork` starts with `requireUser()`, and there is no user here.
 * Calling it would redirect a customer's phone to /login, which is the single
 * worst thing this file could do. The token resolves to a store, and the store
 * is the only subject there is — `accessForStore` answers for it off the same
 * engine, so the two paths cannot reach different verdicts about one
 * dealership.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CUSTOMER IS TOLD, AND WHY IT IS NOT THE TRUE REASON
 * ---------------------------------------------------------------------------
 * `ENDED` — "Your advisor has closed this list. Give them a call if you would
 * still like something done."
 *
 * The sentence `checkWork` hands staff is "This account is suspended. Contact
 * DealerTech to restore access." On this screen that would tell somebody their
 * dealership is in trouble with a supplier they have never heard of, while they
 * are deciding whether to spend six hundred pounds with that dealership. This
 * product's entire argument is that the transparent dealership wins the
 * customer; their vendor's accounts receivable is not the thing to be
 * transparent about, and it is not ours to disclose on their behalf.
 *
 * So the refusal borrows a status the surface already renders properly. ENDED
 * takes the menu read-only, leaves every answer they have already given on the
 * screen — which is the only real proof that nothing they chose was lost — and
 * sends them to their advisor, who is both the right person and one who can
 * actually do something. UNKNOWN was the alternative and is worse: it promises
 * "they will send a new one", and a new link would refuse them identically.
 *
 * It is not the whole truth. It is true in the sense the customer needs — this
 * list is not taking answers — and every other wording is either a leak or a
 * promise we cannot keep.
 *
 * Returns null for a link that is missing or already closed on its own terms,
 * so the store functions below can give their more specific answer.
 */
async function suspendedDealership(token: string, now: Date): Promise<'ENDED' | null> {
  const session = await linkSessionFromToken(token, now)
  if (!session || session.status !== 'OPEN') return null

  const access = await accessForStore(session.storeId)
  return access.canWork ? null : 'ENDED'
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

  const now = new Date()

  /*
    Refused in exactly the shape a closed link is refused in — see
    `suspendedDealership`. This is the more important of the two to get right:
    an authorisation is the customer putting their name to something, and
    letting that submit appear to succeed while nothing was written would be a
    false record of consent, which is the one thing this surface must never
    produce.
  */
  const blocked = await suspendedDealership(token, now)
  if (blocked) return { error: linkStatusMessage(blocked), refused: blocked }

  const session = await authoriseLinkSession(token, name, now)
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
