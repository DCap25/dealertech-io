/**
 * VIN validation (ISO 3779).
 *
 * NHTSA's decoder is permissive — it happily decodes a VIN with a bad check
 * digit and merely notes the problem in an error field. For a service drive
 * that is dangerous: a transposed character can silently return a different
 * car, and the advisor then quotes coverage for a vehicle that isn't in the
 * bay. We validate before we trust.
 */

/** I, O and Q are excluded from VINs to avoid confusion with 1 and 0. */
const INVALID_LETTERS = /[IOQ]/
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/

/** ISO 3779 transliteration — letters map to digits for the checksum. */
const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}

/** Positional weights. Position 9 (the check digit itself) carries weight 0. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export interface VinValidation {
  valid: boolean
  normalized: string
  /** False when the format is wrong — length, or a forbidden letter. */
  wellFormed: boolean
  /** False when the ISO 3779 check digit does not match. */
  checkDigitValid: boolean
  errors: string[]
  warnings: string[]
}

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase().replace(/\s|-/g, '')
}

function transliterate(char: string): number | undefined {
  if (char >= '0' && char <= '9') return Number(char)
  return TRANSLITERATION[char]
}

/**
 * Computes the ISO 3779 check digit for a 17-character VIN.
 * Returns '0'-'9' or 'X', or undefined when the VIN contains an untranslatable character.
 */
export function computeCheckDigit(vin: string): string | undefined {
  const normalized = normalizeVin(vin)
  if (normalized.length !== 17) return undefined

  let sum = 0
  for (let i = 0; i < 17; i++) {
    const char = normalized[i]
    const weight = WEIGHTS[i]
    if (char === undefined || weight === undefined) return undefined
    const value = transliterate(char)
    if (value === undefined) return undefined
    sum += value * weight
  }

  const remainder = sum % 11
  return remainder === 10 ? 'X' : String(remainder)
}

export function validateVin(vin: string): VinValidation {
  const normalized = normalizeVin(vin)
  const errors: string[] = []
  const warnings: string[] = []

  if (normalized.length !== 17) {
    errors.push(`VIN must be 17 characters — got ${normalized.length}.`)
  }
  if (INVALID_LETTERS.test(normalized)) {
    errors.push(
      'VIN contains I, O or Q. These letters are never used in a VIN — check for a mistyped 1 or 0.',
    )
  }
  const wellFormed = VIN_PATTERN.test(normalized)
  if (!wellFormed && errors.length === 0) {
    errors.push('VIN contains characters that are not valid in a VIN.')
  }

  let checkDigitValid = false
  if (wellFormed) {
    const expected = computeCheckDigit(normalized)
    const actual = normalized[8]
    checkDigitValid = expected !== undefined && expected === actual
    if (!checkDigitValid) {
      // A warning rather than an error: some imports and pre-1981 vehicles
      // legitimately fail, so we flag it without blocking the lookup.
      warnings.push(
        `Check digit mismatch — position 9 is "${actual}" but should be "${expected}". Most likely a typo. Re-read the VIN from the door jamb before relying on this.`,
      )
    }
  }

  return {
    valid: wellFormed && checkDigitValid,
    normalized,
    wellFormed,
    checkDigitValid,
    errors,
    warnings,
  }
}

/** Model year from VIN position 10. Needs the current year to disambiguate the 30-year cycle. */
export function modelYearFromVin(vin: string, currentYear: number): number | undefined {
  const normalized = normalizeVin(vin)
  const code = normalized[9]
  if (!code) return undefined

  // The code cycles every 30 years: 1980-2009 then 2010-2039.
  const CYCLE = 'ABCDEFGHJKLMNPRSTVWXY123456789'
  const index = CYCLE.indexOf(code)
  if (index === -1) return undefined

  const firstCycle = 1980 + index
  const secondCycle = firstCycle + 30
  // Allow one model year ahead of the calendar year — dealers sell them early.
  return secondCycle <= currentYear + 1 ? secondCycle : firstCycle
}
