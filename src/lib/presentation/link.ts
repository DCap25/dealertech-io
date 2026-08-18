import { createHash, randomBytes } from 'node:crypto'

/**
 * Menu links sent to a customer's phone.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LINK IS WORTH
 * ---------------------------------------------------------------------------
 * Whoever opens it sees a named person, their vehicle, its mileage, what a
 * technician found and what it costs. That is not catastrophic in the way a
 * password is, but it is somebody's private business and the token is the only
 * thing standing in front of it. So it is treated like the invitation tokens:
 * 32 bytes from the CSPRNG, and only the SHA-256 is stored. A dump of
 * presentation_sessions shows nobody anything.
 *
 * ---------------------------------------------------------------------------
 * WHY NO SECOND FACTOR
 * ---------------------------------------------------------------------------
 * A deliberate choice, not an omission. Asking for the last four of a phone
 * number puts a checkpoint at the exact moment the product is trying to be
 * effortless — a customer at work, on a phone, deciding whether to spend six
 * hundred pounds. Every comparable tool in the industry sends a bare token for
 * the same reason.
 *
 * What is done instead: the link is short-lived, it carries one visit and
 * nothing else, and authorising asks the customer to type their name. That
 * gives accountability at the moment it matters without a barrier at the moment
 * it does not. Adding verification later is a field on this record and a step
 * in the page — the shape here does not have to change.
 *
 * Pure and I/O-free.
 */

/**
 * How long a menu link lives.
 *
 * Twelve hours. It has to survive a customer who reads the text at eleven and
 * answers on their lunch break, and it must not still work next Tuesday when
 * the car has been collected and the prices have moved on.
 */
export const LINK_TTL_HOURS = 12

export function createLinkToken(): { token: string; tokenHash: string } {
  // Base64url so it survives a text message, an email client that linkifies
  // things, and being pasted into a phone browser.
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashLinkToken(token) }
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function linkExpiryFrom(now: Date): Date {
  const out = new Date(now)
  out.setHours(out.getHours() + LINK_TTL_HOURS)
  return out
}

export type LinkStatus = 'OPEN' | 'EXPIRED' | 'ENDED' | 'AUTHORIZED'

export interface LinkRecord {
  expiresAt: Date | null
  endedAt: Date | null
  authorizedAt: Date | null
}

/**
 * Can this link still be answered?
 *
 * Authorised outranks ended and expired, because a customer returning to a link
 * they already used should see what they agreed to rather than an error. It is
 * their record as much as ours.
 */
export function linkStatus(record: LinkRecord, now: Date): LinkStatus {
  if (record.authorizedAt) return 'AUTHORIZED'
  if (record.endedAt) return 'ENDED'
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'OPEN'
}

/**
 * Why the server would not take an answer.
 *
 * `UNKNOWN` is not a `LinkStatus` — it is the token not resolving to a row at
 * all. A page that is already open has resolved its token once, so this is very
 * nearly unreachable; it is enumerated anyway because a write refused for a
 * reason nobody named is exactly how an answer comes to be dropped in silence.
 */
export type LinkRefusal = Exclude<LinkStatus, 'OPEN'> | 'UNKNOWN'

/**
 * What a write's outcome means for the screen the customer is looking at.
 *
 * Null is the good case: the link was open and the answer landed. Everything
 * else is a sentence that has to be shown to them at the moment it happens,
 * rather than saved up for the button at the bottom.
 */
export function refusalFromStatus(status: LinkStatus | null): LinkRefusal | null {
  if (status === null) return 'UNKNOWN'
  return status === 'OPEN' ? null : status
}

/**
 * The heading over that sentence.
 *
 * Here rather than written out at each surface because there are two of them —
 * the page a closed link loads into, and the notice that appears over a menu
 * somebody is halfway through — and a customer who reads one and then reloads
 * into the other must not be told two different things.
 */
export function linkStatusTitle(status: LinkRefusal): string {
  switch (status) {
    case 'EXPIRED': return 'This link has expired'
    case 'ENDED': return 'This list is closed'
    case 'AUTHORIZED': return 'Already sent to your advisor'
    case 'UNKNOWN': return 'This link is no longer valid'
  }
}

/** What to tell somebody whose link will not take an answer. */
export function linkStatusMessage(status: LinkRefusal): string {
  switch (status) {
    case 'EXPIRED':
      return 'This link has expired. Your advisor can send a new one — nothing you chose has been lost.'
    case 'ENDED':
      return 'Your advisor has closed this list. Give them a call if you would still like something done.'
    case 'AUTHORIZED':
      return 'You have already sent these answers to your advisor. Here is what you chose.'
    case 'UNKNOWN':
      return 'This link is no longer valid. Call your service advisor and they will send a new one.'
  }
}

/**
 * A name typed to authorise.
 *
 * Deliberately forgiving. This is somebody on a phone confirming they are the
 * person the car belongs to, not a signature being matched against a specimen —
 * rejecting "Bec" because the record says "Rebecca" would be theatre that
 * blocks a real customer and stops nobody.
 */
export function isUsableAuthorisationName(name: string): boolean {
  return name.trim().length >= 2
}
