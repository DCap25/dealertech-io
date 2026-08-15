import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Staff invitations.
 *
 * ---------------------------------------------------------------------------
 * WHAT AN INVITE IS
 * ---------------------------------------------------------------------------
 * A bearer credential. Whoever holds the link can create an account with a
 * named role at a named dealership, which makes it worth more care than a
 * random string in a URL usually gets.
 *
 * So: the raw token is generated once, put in the link, and never stored. The
 * database holds only its SHA-256. A dump of `store_invitations` — a backup on
 * a laptop, a support engineer with read access, a leaked replica — therefore
 * grants nobody entry to anybody's dealership.
 *
 * Pure and I/O-free. The caller does the reading and writing.
 */

/**
 * How long a link lives.
 *
 * Seven days. Long enough to survive a service manager sending it on a Friday
 * and an advisor opening it after the weekend; short enough that a link
 * forwarded into a group chat two months ago is no longer a way in.
 */
export const INVITE_TTL_DAYS = 7

/** Roles a dealership can hand out. */
export const INVITABLE_ROLES = [
  { code: 'ADVISOR', label: 'Service advisor', hint: 'Works the drive and their own follow-ups.' },
  { code: 'BDC', label: 'BDC / call centre', hint: 'Works the follow-up list. No drive.' },
  { code: 'SERVICE_MANAGER', label: 'Service manager', hint: 'Sees the whole department, every advisor.' },
  { code: 'TECHNICIAN', label: 'Technician', hint: 'Inspection results and recommendations.' },
  { code: 'ADMIN', label: 'Administrator', hint: 'Everything a manager sees, plus staff and settings.' },
] as const

export type InvitableRole = (typeof INVITABLE_ROLES)[number]['code']

const ROLE_CODES = new Set<string>(INVITABLE_ROLES.map((r) => r.code))

export function isInvitableRole(value: string): value is InvitableRole {
  return ROLE_CODES.has(value)
}

/**
 * A fresh token and the hash to store beside it.
 *
 * 32 bytes from the CSPRNG. Base64url so it survives being pasted into a chat
 * window, an email client that helpfully linkifies things, and a URL bar.
 */
export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compare two hashes without leaking where they differ.
 *
 * The lookup is by hash so the database does the matching, and this is only
 * reached on a re-check — but a plain `===` on a secret-derived value is the
 * kind of thing that is free to do properly and awkward to explain later.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export type InviteStatus = 'VALID' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED'

/** The stored side of an invitation, as far as validity is concerned. */
export interface InviteRecord {
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}

/**
 * Can this invitation still be used?
 *
 * Order matters. Revoked beats expired beats accepted, because that is the
 * order in which the answers stop being someone's fault: "this was withdrawn"
 * is a different conversation from "this ran out", and both are different from
 * "you already have an account".
 */
export function inviteStatus(record: InviteRecord, now: Date): InviteStatus {
  if (record.revokedAt) return 'REVOKED'
  if (record.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  if (record.acceptedAt) return 'ACCEPTED'
  return 'VALID'
}

/** What to tell someone whose link will not work. */
export function inviteStatusMessage(status: Exclude<InviteStatus, 'VALID'>): string {
  switch (status) {
    case 'REVOKED':
      return 'This invitation was withdrawn. Ask your service manager to send a new one.'
    case 'EXPIRED':
      return `Invitations last ${INVITE_TTL_DAYS} days and this one has run out. Ask your service manager to send a new one.`
    case 'ACCEPTED':
      return 'This invitation has already been used. If that was you, sign in instead.'
  }
}

export function inviteExpiryFrom(now: Date): Date {
  const out = new Date(now)
  out.setDate(out.getDate() + INVITE_TTL_DAYS)
  return out
}

/**
 * The email an invitation was addressed to, normalised.
 *
 * Compared on acceptance so a forwarded link cannot be redeemed by whoever it
 * was forwarded to. It is not a strong control — the recipient chooses what to
 * type — but it turns silent misuse into a deliberate act.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}
