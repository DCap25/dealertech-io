/**
 * Turning a cell of somebody's spreadsheet into a value we can stand behind.
 *
 * ---------------------------------------------------------------------------
 * REFUSING IS A FEATURE
 * ---------------------------------------------------------------------------
 * Every function here returns a value or a reason, never a guess. That is the
 * same rule the coverage engine follows and it matters more here, not less: an
 * import runs once, unattended, against a file nobody will read line by line,
 * and a wrong value entered now becomes a wrong number an advisor quotes to a
 * customer eighteen months later with no way to trace where it came from.
 *
 * A rejected row costs one line of history. A silently mis-parsed one costs
 * the trust the whole product is selling.
 *
 * Pure and I/O-free.
 */

import { validateVin } from '@/lib/vin'

export type Coerced<T> = { ok: true; value: T } | { ok: false; reason: string }

const ok = <T>(value: T): Coerced<T> => ({ ok: true, value })
const bad = (reason: string): Coerced<never> => ({ ok: false, reason })

/** Empty, whitespace, and the placeholders exports use for "nothing". */
const BLANKS = new Set(['', 'null', 'n/a', 'na', 'none', '-', '--', 'unknown'])

export function isBlank(raw: string): boolean {
  return BLANKS.has(raw.trim().toLowerCase())
}

export function coerceText(raw: string, max = 500): Coerced<string> {
  const value = raw.trim()
  if (value === '') return bad('is empty')
  // Truncated rather than rejected: an over-long description is still a
  // usable decline, and losing the row over its tail would be the wrong trade.
  return ok(value.slice(0, max))
}

/**
 * A vehicle identification number.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DELEGATES RATHER THAN CHECKING A PATTERN
 * ---------------------------------------------------------------------------
 * The VIN is how every imported row finds its vehicle, and how the warranty
 * engine knows what the car is. A malformed one does not degrade the import —
 * it silently creates a second, phantom vehicle that shares nothing with the
 * real one, so the declines land on a car that never visits and the prep sheet
 * for the real car stays empty. That failure is invisible until an advisor
 * wonders where a customer's history went.
 *
 * `src/lib/vin/validate.ts` already does this properly, including the ISO 3779
 * check digit. That matters here more than a regex would: a length-and-alphabet
 * test passes a transposed VIN happily, and a transposition is precisely how a
 * typed or OCR'd VIN goes wrong. The check digit catches it.
 *
 * The one deliberate difference is severity. That module treats a bad check
 * digit as a warning, because a human looking up a car in the drive should get
 * an answer plus a caution rather than a refusal. An import has nobody to
 * caution — it runs unattended against twenty thousand rows — so here it is a
 * rejection, and the row comes back with the reason attached.
 */
export function coerceVin(raw: string): Coerced<string> {
  if (raw.trim() === '') return bad('is empty')

  const result = validateVin(raw)
  if (!result.wellFormed) {
    // Already phrased for a human by the validator; strip the redundant lead.
    const reason = result.errors[0] ?? 'is not a valid VIN'
    return bad(reason.replace(/^VIN /, '').replace(/\.$/, ''))
  }
  if (!result.checkDigitValid) {
    return bad(
      'fails its check digit, which almost always means a transposed character — ' +
      'importing it would create a second vehicle that never matches the real one',
    )
  }
  return ok(result.normalized)
}

/**
 * A date, from the handful of shapes exports actually use.
 *
 * ---------------------------------------------------------------------------
 * THE AMBIGUITY THIS REFUSES TO GUESS AT
 * ---------------------------------------------------------------------------
 * `03/04/2024` is the 3rd of April in most of the world and the 4th of March
 * in the United States. Both parse. Only one is right, and nothing in the cell
 * says which.
 *
 * This assumes US order, because the product serves US franchise dealerships
 * and their DMS exports in that order — but it only does so when the value is
 * genuinely unambiguous about nothing else, and it never accepts a day-first
 * reading silently. Where a month exceeds 12 the intent is obvious and it is
 * read day-first with no complaint; that is the one case where guessing is
 * safe because only one reading exists.
 *
 * ISO (`2024-03-04`) is preferred and always unambiguous. Where a store can
 * choose their export format, that is the one to ask for.
 */
export function coerceDate(raw: string, opts: { notFuture?: boolean; asOf?: Date } = {}): Coerced<Date> {
  const value = raw.trim()
  if (value === '') return bad('is empty')

  let year: number | undefined
  let month: number | undefined
  let day: number | undefined

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  const slash = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[T ].*)?$/)

  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3])
  } else if (slash) {
    const first = Number(slash[1])
    const second = Number(slash[2])
    let y = Number(slash[3])
    // Two-digit years: a service history is recent, so 90-99 is the 1990s and
    // everything else is 2000s. Getting this wrong by a century would make
    // every warranty term expired.
    if (y < 100) y += y >= 90 ? 1900 : 2000

    if (first > 12 && second <= 12) {
      // Only one reading exists — day first. Safe to accept.
      day = first; month = second
    } else {
      // US order, per the note above.
      month = first; day = second
    }
    year = y
  } else {
    return bad(`is not a date this recognises — use YYYY-MM-DD, or MM/DD/YYYY`)
  }

  if (month < 1 || month > 12) return bad(`has month ${month}`)
  if (day < 1 || day > 31) return bad(`has day ${day}`)
  if (year < 1900 || year > 2200) return bad(`has year ${year}`)

  // Constructed in UTC so an import does not shift by a day depending on
  // where the server happens to be.
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return bad(`is not a real date (${year}-${month}-${day})`)
  }

  if (opts.notFuture) {
    const asOf = opts.asOf ?? new Date()
    if (date.getTime() > asOf.getTime()) {
      // A decline dated next year is a mis-parse or a bad export, and it would
      // sort to the top of every follow-up list forever.
      return bad('is in the future')
    }
  }

  return ok(date)
}

/**
 * Money, as exports write it: `$1,234.56`, `1234.56`, `(45.00)`.
 *
 * Negatives are refused rather than absolved. A declined service worth minus
 * six hundred dollars is a credit or a sign convention we do not understand,
 * and either way putting it on a prep sheet would show a customer a number
 * that makes no sense.
 */
export function coerceMoney(raw: string, opts: { max?: number } = {}): Coerced<number> {
  const value = raw.trim()
  if (value === '') return bad('is empty')

  // Accounting parentheses mean negative.
  const parenthesised = /^\((.*)\)$/.exec(value)
  const body = (parenthesised ? parenthesised[1]! : value).replace(/[$,\s]/g, '')

  if (!/^-?\d*\.?\d+$/.test(body)) return bad(`is not an amount ("${value}")`)

  let amount = Number(body)
  if (!Number.isFinite(amount)) return bad(`is not an amount ("${value}")`)
  if (parenthesised) amount = -amount

  if (amount < 0) return bad('is negative')

  const max = opts.max ?? 1_000_000
  if (amount > max) {
    // Almost always a units error — cents imported as dollars.
    return bad(`is ${amount.toFixed(2)}, above the ${max.toLocaleString()} ceiling — check whether this column is in cents`)
  }

  // Two decimal places, so a float artefact never reaches an invoice.
  return ok(Math.round(amount * 100) / 100)
}

/** Odometer, or any other whole number that cannot sensibly be negative. */
export function coerceMileage(raw: string): Coerced<number> {
  const value = raw.trim().replace(/[,\s]/g, '')
  if (value === '') return bad('is empty')
  if (!/^\d+$/.test(value)) return bad(`is not a whole number ("${raw.trim()}")`)

  const miles = Number(value)
  if (!Number.isFinite(miles)) return bad('is not a number')
  /*
    A million miles is a class-8 truck at the end of its life, not a car in a
    franchise service drive. Past that it is a VIN in the mileage column or a
    figure in tenths, and either would wreck every interval calculation the
    vehicle is involved in.
  */
  if (miles > 1_000_000) return bad(`is ${miles.toLocaleString()} — check this is miles and not tenths`)
  return ok(miles)
}

/** Lowercased, because it is the natural key for matching a customer. */
export function coerceEmail(raw: string): Coerced<string> {
  const value = raw.trim().toLowerCase()
  if (value === '') return bad('is empty')
  // Deliberately loose. Rejecting an unusual but real address costs a
  // customer record; the address is not being sent anything at import time.
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value)) return bad(`is not an email address ("${raw.trim()}")`)
  return ok(value)
}

/**
 * A phone number, reduced to its digits.
 *
 * Stored normalised so the same customer written three ways in three exports
 * is one customer. Formatting is a rendering concern.
 */
export function coercePhone(raw: string): Coerced<string> {
  const digits = raw.replace(/\D/g, '')
  if (digits === '') return bad('has no digits')
  // Strip the US country code so +1 512… and 512… match.
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length !== 10) {
    return bad(`has ${national.length} digits; a US number has 10`)
  }
  return ok(national)
}
