import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Gated demo tours.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TOUR CODE IS, AND WHY IT IS GATED AT ALL
 * ---------------------------------------------------------------------------
 * `/demo` — the coverage engine — is open to anyone with a VIN, deliberately,
 * and stays that way. It shows one answer from one engine and gives nothing
 * away about how the workspace is built.
 *
 * A tour is different. It signs the visitor into the seeded demo dealership as
 * real staff, so they see the drive, the prep sheet, the menu, the follow-up
 * list — the whole product, laid out. That is the right thing to show a
 * dealership that booked a walkthrough and the wrong thing to leave on the open
 * internet for a competitor to screenshot at leisure. So Dan issues a code from
 * the admin console when a walkthrough is booked, and the code is what opens
 * the door.
 *
 * ---------------------------------------------------------------------------
 * THE SAME DISCIPLINE AS AN INVITATION
 * ---------------------------------------------------------------------------
 * A code is a bearer credential: whoever holds it gets in. So it is generated
 * once, read out or pasted into an email, and never stored — the database keeps
 * only its SHA-256, exactly as `src/lib/invites/invite.ts` keeps invitations and
 * `src/lib/pairing/codes.ts` keeps device tokens. A dump of `demo_tour_codes`
 * therefore lets nobody take a tour.
 *
 * It is a weaker credential than an invitation and that is on purpose. Ten
 * characters is about fifty bits, which is far short of an invitation's 32
 * random bytes — but an invitation grants a role at a real dealership holding
 * real customers, and this grants a look at a fictional store full of made-up
 * Ford owners. The trade buys something an invitation cannot have: a code that
 * survives being read down a phone line.
 *
 * ---------------------------------------------------------------------------
 * KNOWN LIMITATION: EVERY TOUR SHARES ONE STORE — NOT SOLVED IN v1
 * ---------------------------------------------------------------------------
 * There is exactly one seeded demo dealership, and every code opens it. Three
 * consequences, all real and none of them handled here:
 *
 *   1. Two prospects touring in the same week see each other's edits. A fixed
 *      ops director who marks an appointment complete on Tuesday changes what
 *      the Wednesday walkthrough opens on.
 *   2. `npm run db:seed` wipes and rebuilds that store, so a re-seed resets
 *      mid-tour state without warning. Do not re-seed on a day with
 *      walkthroughs booked.
 *   3. A tour visitor is a real signed-in user at a real store row, so they can
 *      do everything that role can do — including inviting staff and, as a
 *      service manager, seeing the roster. It is a fictional dealership, so
 *      nothing there belongs to anybody, but it is not a read-only sandbox and
 *      should not be described as one.
 *
 * The page says the first two out loud (`src/app/tour/page.tsx`) rather than
 * letting a prospect discover them, which is the v1 answer: honesty is cheap
 * and a per-prospect store is not.
 *
 * WHERE THE REAL FIX SLOTS IN. A code would carry its own `store_id`, and
 * `issueTourCode` would call `createStore` + the seed the way
 * `provisionFromLead` calls `createStore` today — the provisioning machinery
 * already exists and already produces an isolated tenant. `TOUR_ROLES` would
 * stop naming `.test` addresses and would instead name roles, with the accounts
 * created per store. What makes that a project rather than an afternoon is the
 * seed: `src/db/seed/index.ts` builds one deterministic dealership with fixed
 * uuids, so running it per tenant means parameterising every id it generates,
 * and tearing a tour store back down afterwards means a reaper nothing else in
 * this repository needs.
 *
 * Pure and I/O-free. The reading and writing live in ./store.
 */

/**
 * No I, O, 1 or 0 — the same alphabet as a pairing code, for the same reason.
 *
 * A pairing code is read off a tablet across a desk. A tour code is read down a
 * phone to a fixed ops director who is writing it on the back of something, or
 * copied out of an email by somebody who will retype rather than paste. Every
 * ambiguous glyph is a support call, and the support call is with the prospect
 * you are trying to sell to.
 */
export const TOUR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Ten characters — roughly fifty bits of entropy.
 *
 * Six, as pairing uses, is thirty bits, which is fine for a credential that
 * lives ten minutes and is guarded by a claim step. This one lives a week and
 * is the only thing between an anonymous request and the whole workspace, so it
 * gets four more characters. Guessing it at ten attempts per ten minutes from
 * one address — the rate limit on the entry form — takes longer than the
 * universe has been running.
 */
export const TOUR_CODE_LENGTH = 10

/**
 * How long a code lives.
 *
 * Seven days, the same as an invitation and for the same reason: long enough to
 * survive being issued on a Friday for a walkthrough that slips to Tuesday,
 * short enough that a code forwarded round a dealer group two months ago is no
 * longer a way in. Dan can revoke sooner; nothing keeps working longer.
 */
export const TOUR_CODE_TTL_DAYS = 7

/**
 * The three roles a prospect can walk the product as.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE THREE AND NOT THE WHOLE ROSTER
 * ---------------------------------------------------------------------------
 * The seeded store has technicians, a cashier and a salesperson too. None of
 * them is who buys this. The people on a walkthrough call are the service
 * manager who signs, the advisor who has to want it, and — increasingly — the
 * BDC lead who owns the follow-up numbers. Three roles is also the most a
 * person will actually click through before they want to talk instead.
 *
 * ---------------------------------------------------------------------------
 * THE ACCOUNTS ARE THE SEEDED DEMO STAFF, BY NAME
 * ---------------------------------------------------------------------------
 * `.test` addresses at the fictional Lone Star Ford — the same accounts the
 * sign-in page offers as one-tap cards in development, created by
 * `npm run auth:provision` and rotated by `npm run demo:rotate`. Naming them
 * here rather than looking them up by role keeps the tour from silently landing
 * on whichever advisor the database returned first, which is the shape of bug
 * `getDefaultStore()` used to be.
 *
 * `home` is where the tour drops them. Deliberately not `landingPath()`, which
 * sends everybody with a store to `/drive`: a BDC lead who lands on the drive
 * has to be told where their own screen is, and a demo where the first
 * instruction is "now click over here" has already lost a beat.
 */
export const TOUR_ROLES = [
  {
    code: 'ADVISOR',
    label: 'Service advisor',
    email: 'marcus@lonestarford.test',
    home: '/drive',
    /** One line. It is read while deciding which button to press. */
    sees: 'Today’s drive, ranked, and the prep sheet behind every appointment — coverage, history and what to present, before the customer walks up.',
  },
  {
    code: 'SERVICE_MANAGER',
    label: 'Service manager',
    email: 'ray@lonestarford.test',
    home: '/manager',
    sees: 'The whole department: every advisor’s book, the day’s numbers, and the roster.',
  },
  {
    code: 'BDC',
    label: 'BDC / call centre',
    email: 'priya@lonestarford.test',
    home: '/bdc',
    sees: 'The outbound desk — declined work, follow-up cadence, and who is due a call today.',
  },
] as const

export type TourRole = (typeof TOUR_ROLES)[number]['code']

const TOUR_ROLE_CODES = new Set<string>(TOUR_ROLES.map((r) => r.code))

export function isTourRole(value: string): value is TourRole {
  return TOUR_ROLE_CODES.has(value)
}

export function tourRole(code: TourRole): (typeof TOUR_ROLES)[number] {
  // Non-null is safe: `code` is narrowed to a member of the literal union, and
  // the union is derived from this array.
  return TOUR_ROLES.find((r) => r.code === code)!
}

/**
 * A fresh code and the hash to store beside it.
 *
 * Rejection-free modulo bias is not worth the code here — 256 is exactly eight
 * times 32, so `% 32` over a uniform byte is itself uniform. That is a property
 * of this alphabet's length being a power of two, not a general licence; a
 * 33-character alphabet would need rejection sampling and this comment would be
 * wrong.
 */
export function createTourCode(): { code: string; codeHash: string } {
  const bytes = randomBytes(TOUR_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < TOUR_CODE_LENGTH; i++) {
    code += TOUR_CODE_ALPHABET[bytes[i]! % TOUR_CODE_ALPHABET.length]
  }
  return { code, codeHash: hashTourCode(code) }
}

export function hashTourCode(code: string): string {
  return createHash('sha256').update(normalizeTourCode(code)).digest('hex')
}

/**
 * Typed by a human off a phone call, so accept whatever shape they type it in.
 *
 * Note that `hashTourCode` normalises before hashing rather than trusting the
 * caller to have done it. The alternative — hash the raw string and expect
 * every call site to remember — is the kind of arrangement that works until one
 * path forgets and a perfectly correct code stops matching for reasons nobody
 * can see in a diff.
 */
export function normalizeTourCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isWellFormedTourCode(input: string): boolean {
  const code = normalizeTourCode(input)
  return (
    code.length === TOUR_CODE_LENGTH &&
    [...code].every((c) => TOUR_CODE_ALPHABET.includes(c))
  )
}

/**
 * Grouped for reading aloud: FKMT9 - PQR34.
 *
 * Only ever for display. Everything that compares goes through
 * `normalizeTourCode`, which strips the hyphen straight back out, so a prospect
 * who types what they see is not punished for it.
 */
export function formatTourCode(code: string): string {
  const clean = normalizeTourCode(code)
  const half = Math.ceil(clean.length / 2)
  return `${clean.slice(0, half)}-${clean.slice(half)}`
}

/**
 * Compare two hashes without leaking where they differ.
 *
 * The lookup is by hash so the database does the matching and this is a
 * re-check — the same belt-and-braces as `hashesMatch` in the invites module.
 * It is here rather than borrowed from there because a shared helper across two
 * unrelated credential types is the kind of coupling that makes somebody
 * "simplify" one of them into the other's rules.
 */
export function tourHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export type TourCodeStatus = 'VALID' | 'EXPIRED' | 'REVOKED'

/** The stored side of a code, as far as validity is concerned. */
export interface TourCodeRecord {
  expiresAt: Date
  revokedAt: Date | null
}

/**
 * Can this code still be used?
 *
 * Revoked beats expired, the same ordering as `inviteStatus` and for the same
 * reason: "this was withdrawn" and "this ran out" are different conversations,
 * and the first one is the one you want to have if both are true.
 *
 * There is no ACCEPTED state. A tour code is reusable on purpose — the same
 * code opens the advisor view on Monday and the manager view on Wednesday, and
 * a group that puts three people on the call should not need three codes. What
 * stops it becoming a permanent back door is the expiry, not a single use.
 */
export function tourCodeStatus(record: TourCodeRecord, now: Date): TourCodeStatus {
  if (record.revokedAt) return 'REVOKED'
  if (record.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'VALID'
}

/**
 * What to tell somebody whose code will not work.
 *
 * Named states rather than one generic sentence, which is the opposite of the
 * sign-in form's choice and deliberately so. A wrong password must not confirm
 * that an address exists; a tour code that says "this expired on Friday" tells
 * a prospect nothing they could not learn by asking Dan, and telling them
 * plainly is the difference between them ringing back and them assuming the
 * product is broken.
 *
 * A code that does not exist at all is the one case that stays vague — see
 * `TOUR_CODE_UNKNOWN` — because there the message is the only signal a guesser
 * would get.
 */
export function tourCodeStatusMessage(status: Exclude<TourCodeStatus, 'VALID'>): string {
  switch (status) {
    case 'REVOKED':
      return 'That code has been withdrawn. Email dan@dealertech.io and we will issue a new one.'
    case 'EXPIRED':
      return `Tour codes last ${TOUR_CODE_TTL_DAYS} days and this one has run out. Email dan@dealertech.io for a fresh one.`
  }
}

/** The one deliberately uninformative message. See above. */
export const TOUR_CODE_UNKNOWN = 'That code is not one of ours. Check it and try again.'

export function tourExpiryFrom(now: Date): Date {
  const out = new Date(now)
  out.setDate(out.getDate() + TOUR_CODE_TTL_DAYS)
  return out
}
