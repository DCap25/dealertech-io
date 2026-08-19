import { PRODUCT_TYPES, TIER_TYPES, DEDUCTIBLE_TYPES } from './vocabulary'
import { emptyExtraction } from './review'
import type {
  ExtractedContract, ExtractedField, FieldConfidence,
} from './types'

/**
 * Turning whatever the model sent back into the shape the review form expects.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS WHEN THE REQUEST USES A JSON SCHEMA
 * ---------------------------------------------------------------------------
 * The extraction call constrains the response with `output_config.format`, so
 * in the ordinary case the JSON already matches. This module is what stands
 * between "ordinarily" and a coverage answer.
 *
 * Three things it catches that the schema does not:
 *
 *   1. A response that is not the schema at all — a refusal, a truncation at
 *      `max_tokens`, a malformed body. `JSON.parse` hands back `any` and every
 *      field access after that is a lie the compiler agreed to.
 *   2. Values that satisfy the schema's *type* but not its *meaning*: "$1,200"
 *      where a number belongs, "04/11/2028" where an ISO date belongs,
 *      "platinum" where an enum member belongs.
 *   3. A model that invents an enum member. `TIRE_AND_WHEEL` is a plausible
 *      thing to write and is not a `ProductType`; letting it through would put
 *      a value in the database that the coverage engine cannot arbitrate on.
 *
 * The rule throughout: **an unreadable value becomes null, never a guess.** A
 * null shows up on the review form as "not found" and the advisor types it.
 * A guess shows up as a filled field with a confidence badge next to it, and
 * gets confirmed by someone skim-reading. The first is a slower afternoon; the
 * second is telling a customer their transmission is covered.
 *
 * Pure and I/O-free, which is the point — this is the part of the extraction
 * path that can actually be tested.
 */

/** A value the model could not read. Deliberately not an empty string. */
function blank<T>(): ExtractedField<T> {
  return { value: null, confidence: 'LOW', sourceText: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Confidence, or the most cautious reading of a confidence.
 *
 * Anything unrecognised becomes LOW rather than HIGH. If the model's own
 * account of how sure it was is unparseable, treating that as certainty is
 * exactly the wrong direction to round.
 */
export function normaliseConfidence(value: unknown): FieldConfidence {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return text === 'HIGH' || text === 'MEDIUM' ? text : 'LOW'
}

/** Verbatim source text, trimmed. Empty is the same as absent. */
export function normaliseSourceText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * A plain string field — an administrator name, a contract number, a tier.
 *
 * Collapses internal whitespace because these are read off a document and a
 * line break in the middle of "Safeguard Products  International" should not
 * make it a different administrator from the one in the templates table.
 */
export function normaliseText(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return null
  // Models occasionally fill a "not found" with prose rather than null.
  if (/^(n\/?a|none|unknown|not (found|listed|specified|stated)|--?)$/i.test(trimmed)) return null
  return trimmed
}

/**
 * An ISO date, or nothing.
 *
 * Deliberately strict, and it matches the rule in ./review.ts. "04/11/2028" is
 * two different dates depending on which side of the Atlantic printed the
 * contract, and a service contract's expiry being seven months out is the
 * difference between covered and not. The extraction prompt asks for ISO and
 * asks for null when the printed form is ambiguous; anything else that arrives
 * here is treated as unread rather than reinterpreted.
 *
 * The calendar check matters too: 2023-02-30 satisfies the regex and is not a
 * date. `new Date` would roll it forward to March 2nd without complaining.
 */
export function normaliseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  const date = new Date(Date.UTC(year, month - 1, day))
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  if (!roundTrips) return null

  // A contract dated in the 1800s or the 2200s is a misread year, not history.
  if (year < 1980 || year > 2100) return null
  return trimmed
}

/**
 * Money, from whatever a model decided money looks like.
 *
 * Accepts a number, or a string carrying the decorations a document puts on
 * one: a currency symbol, thousands separators, a trailing "per visit".
 * Rejects negatives — a negative deductible is a misread minus sign or a
 * credit, and neither is a number to bill a customer against.
 */
export function normaliseMoney(value: unknown): number | null {
  const parsed = parseNumeric(value)
  if (parsed === null) return null
  if (parsed < 0) return null
  // Two decimal places is what the column stores; more is spurious precision.
  return Math.round(parsed * 100) / 100
}

/**
 * A whole-number count — months, miles, an odometer reading.
 *
 * Fractional input is a misread rather than a real value ("60.5 months" is not
 * a term), so it rounds rather than rejecting, but a negative or absurd value
 * is dropped. The plausibility ceilings live in ./review.ts, which raises them
 * as warnings the advisor sees rather than silently discarding them here.
 */
export function normaliseInteger(value: unknown): number | null {
  const parsed = parseNumeric(value)
  if (parsed === null) return null
  if (parsed < 0) return null
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed)
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed === '') return null

  // Pull the first number out of "$1,200.00 per visit" / "75,000 miles".
  const match = /-?\d[\d,]*(\.\d+)?/.exec(trimmed)
  if (!match) return null

  const numeric = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * A member of a closed vocabulary, or nothing.
 *
 * The engine arbitrates on these, so an invented member is worse than a null:
 * null asks the advisor to choose from the list, while `TIRE_AND_WHEEL` would
 * be written to a column that cannot hold it and fail at the database, or —
 * worse, on a text column — be held and never match anything again.
 */
export function normaliseEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  return allowed.find((member) => member === key) ?? null
}

/**
 * A yes/no printed on a contract.
 *
 * Strings are accepted because a model asked for a boolean sometimes answers
 * in the document's own words. Anything unrecognised is null — and for prior
 * authorisation specifically, null is not "no": ./review.ts defaults an
 * unknown prior-auth to required, because calling the administrator when you
 * did not need to costs a phone call, and not calling when you did costs the
 * claim.
 */
export function normaliseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (/^(true|yes|y|required|1)$/.test(text)) return true
  if (/^(false|no|n|not required|none|0)$/.test(text)) return false
  return null
}

/** Read one `{value, confidence, sourceText}` object out of the raw response. */
function readField<T>(raw: unknown, key: string, coerce: (value: unknown) => T | null): ExtractedField<T> {
  if (!isRecord(raw)) return blank<T>()
  const entry = raw[key]
  if (!isRecord(entry)) return blank<T>()

  const value = coerce(entry.value)
  if (value === null) {
    /*
      A value that failed to coerce is not the same as one the model reported
      as absent, but the advisor's next move is identical: read the document
      and type it. Keeping the model's own sourceText is what makes that quick
      — it still points at the spot on the page where the unreadable thing is.
    */
    return { value: null, confidence: 'LOW', sourceText: normaliseSourceText(entry.sourceText) }
  }

  return {
    value,
    confidence: normaliseConfidence(entry.confidence),
    sourceText: normaliseSourceText(entry.sourceText),
  }
}

/**
 * The whole response, coerced.
 *
 * Returns a complete `ExtractedContract` no matter what it is handed — a
 * partial object, a string, null. Every field the response did not supply
 * arrives blank, which is exactly what the review form renders as "not found".
 */
export function normaliseExtraction(raw: unknown): ExtractedContract {
  if (!isRecord(raw)) return emptyExtraction()

  return {
    productType: readField(raw, 'productType', (v) => normaliseEnum(v, PRODUCT_TYPES)),
    adminCompany: readField(raw, 'adminCompany', normaliseText),
    contractNumber: readField(raw, 'contractNumber', normaliseText),
    coverageTier: readField(raw, 'coverageTier', normaliseText),
    tierType: readField(raw, 'tierType', (v) => normaliseEnum(v, TIER_TYPES)),

    purchaseDate: readField(raw, 'purchaseDate', normaliseIsoDate),
    purchaseMileage: readField(raw, 'purchaseMileage', normaliseInteger),
    expirationDate: readField(raw, 'expirationDate', normaliseIsoDate),
    expirationMiles: readField(raw, 'expirationMiles', normaliseInteger),
    termMonths: readField(raw, 'termMonths', normaliseInteger),
    termMiles: readField(raw, 'termMiles', normaliseInteger),

    deductibleAmount: readField(raw, 'deductibleAmount', normaliseMoney),
    deductibleType: readField(raw, 'deductibleType', (v) => normaliseEnum(v, DEDUCTIBLE_TYPES)),

    requiresPriorAuthorization: readField(raw, 'requiresPriorAuthorization', normaliseBoolean),

    vin: readField(raw, 'vin', normaliseText),
  }
}
