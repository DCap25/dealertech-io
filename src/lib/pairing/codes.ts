import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Pairing codes and device tokens.
 *
 * The threat model is a tablet on a bench in a service drive: it is unattended
 * for most of its life, it is handed to strangers, and it will eventually be
 * dropped, stolen or taken home by accident. Everything here assumes the
 * device is lost.
 */

/**
 * No I, O, 1 or 0.
 *
 * The code gets read off a tablet across a desk and typed into a phone by
 * someone who is mid-conversation. Ambiguous glyphs turn a five-second setup
 * into a support call.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

/** Long enough that the code is useless before it can be guessed. */
export const PAIRING_WINDOW_MINUTES = 10

export function generatePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return out
}

/** Typed by a human, so accept whatever shape they type it in. */
export function normalizePairingCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isWellFormedCode(input: string): boolean {
  const code = normalizePairingCode(input)
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c))
}

/**
 * The device's long-lived credential.
 *
 * 32 random bytes. Stored only as a hash, so a dump of the devices table does
 * not let anyone impersonate a tablet — the same reason passwords are not
 * stored in the clear, for the same kind of secret.
 */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compare in constant time.
 *
 * The lookup is by hash so this is belt-and-braces, but a comparison that
 * returns early on the first differing byte leaks how much of a guess was
 * right, and that is a free win to not give away.
 */
export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function pairingExpiry(from: Date): Date {
  return new Date(from.getTime() + PAIRING_WINDOW_MINUTES * 60_000)
}

export function isPairingExpired(expiresAt: Date, asOf: Date): boolean {
  return asOf >= expiresAt
}
