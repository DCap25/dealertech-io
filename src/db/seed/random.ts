import { createHash } from 'node:crypto'
import { computeCheckDigit } from '@/lib/vin'

/**
 * Deterministic pseudo-randomness.
 *
 * Seeded on purpose: the demo data must be identical on every machine and
 * every reset, so a screenshot, a bug report and a test all describe the same
 * dealership.
 */
let state = 20260812

export function reseed(value = 20260812) {
  state = value
}

export function rnd(): number {
  // Numerical Recipes LCG. Not cryptographic — it only has to be repeatable.
  state = (state * 1664525 + 1013904223) % 0x100000000
  return state / 0x100000000
}

export function int(min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min
}

export function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(rnd() * items.length)]
  if (item === undefined) throw new Error('pick() called with an empty array')
  return item
}

export function chance(probability: number): boolean {
  return rnd() < probability
}

/** Picks `count` distinct items, or all of them when the list is shorter. */
export function sample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items]
  const out: T[] = []
  while (out.length < count && pool.length > 0) {
    const idx = Math.floor(rnd() * pool.length)
    const [taken] = pool.splice(idx, 1)
    if (taken !== undefined) out.push(taken)
  }
  return out
}

const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
/** VIN position 10 encodes model year on a 30-year cycle. */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'

/**
 * Builds a VIN that passes our own ISO 3779 validator, including a correct
 * check digit and the right model-year character. Random 17-character strings
 * would fail validation and make the seed data useless for testing the
 * VIN-handling paths.
 */
export function makeVin(wmi: string, modelYear: number): string {
  const cycleIndex = modelYear >= 2010 ? modelYear - 2010 : modelYear - 1980
  const yearChar = YEAR_CODES[cycleIndex % 30] ?? 'A'

  const chars: string[] = []
  for (let i = 0; i < 17; i++) {
    if (i < 3) {
      chars.push(wmi[i] ?? 'A')
    } else if (i === 8) {
      chars.push('0') // placeholder, replaced below
    } else if (i === 9) {
      chars.push(yearChar)
    } else {
      chars.push(pick(VIN_CHARS.split('')))
    }
  }

  const withPlaceholder = chars.join('')
  // Position 9 carries weight 0, so the placeholder does not affect the sum.
  const digit = computeCheckDigit(withPlaceholder) ?? '0'
  chars[8] = digit
  return chars.join('')
}

export function daysAgo(days: number, from: Date): Date {
  const d = new Date(from)
  d.setDate(d.getDate() - days)
  return d
}

export function daysFrom(days: number, from: Date): Date {
  return daysAgo(-days, from)
}

/** Postgres `date` columns want YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * A deterministic UUID for a stable key.
 *
 * Staff rows need ids that survive a re-seed: Supabase auth users are created
 * with the same uuid as the application row, and every RLS policy resolves a
 * tenant through `user_store_roles.user_id = auth.uid()`. A random id would
 * sign every advisor in to an empty dealership after each seed.
 *
 * Shaped as a v5-style UUID — derived from a hash, not from randomness.
 */
export function stableId(key: string): string {
  const h = createHash('sha1').update(`dealertech:${key}`).digest('hex')
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `${variant}${h.slice(18, 20)}`,
    h.slice(20, 32),
  ].join('-')
}
