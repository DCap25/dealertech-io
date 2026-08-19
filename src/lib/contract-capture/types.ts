/**
 * Reading a service contract off an uploaded document.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST MODEL
 * ---------------------------------------------------------------------------
 * Nothing extracted here reaches the coverage engine unattended. Not on high
 * confidence, not on a clean-looking PDF, not ever — an advisor confirms each
 * field against the document first, and even then the contract lands
 * unverified, because a human agreeing with a transcription is not the same as
 * an administrator confirming the policy exists. See `confirmContract` in
 * ./store.ts for what `verifiedAt` actually means.
 *
 * The reason is the shape of the failure. If the engine is told a customer has
 * Tire & Wheel and they do not, an advisor tells them a $400 job is free. The
 * store either eats the difference or takes it back in front of the customer,
 * and both are worse than having typed four fields.
 *
 * So every field arrives with two things attached: a confidence, and the
 * verbatim text the model believes it read. The advisor is checking a
 * transcription, which is fast, rather than doing data entry, which is not.
 */

import type { ProductType, TierType, DeductibleType } from '@/lib/coverage'

export type FieldConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * One field, as read.
 *
 * `sourceText` is what makes this reviewable: it is the characters the model
 * says it saw, so the advisor's eye can jump to that spot on the document
 * rather than re-reading the whole page.
 */
export interface ExtractedField<T> {
  value: T | null
  confidence: FieldConfidence
  /** Verbatim from the document. Null when the model inferred rather than read. */
  sourceText: string | null
}

/**
 * What a service contract has on it that the coverage engine cares about.
 *
 * The field list is not a wish list — it is everything `toContract` in
 * src/lib/dms/map.ts carries into the engine and the `contracts` table has a
 * column for. Extracting a field the schema cannot store wastes an advisor's
 * review time on something that gets dropped on save.
 */
export interface ExtractedContract {
  productType: ExtractedField<ProductType>
  adminCompany: ExtractedField<string>
  contractNumber: ExtractedField<string>
  /** The plan name as printed — "Platinum", "Gold", "Powertrain Plus". */
  coverageTier: ExtractedField<string>
  /**
   * Exclusionary lists what is NOT covered; inclusionary lists what IS.
   * Reading it the wrong way round is how a store eats a transmission, which
   * is why the engine is told rather than left to assume.
   */
  tierType: ExtractedField<TierType>

  /** ISO date. Ambiguous formats are returned LOW rather than guessed. */
  purchaseDate: ExtractedField<string>
  /** Odometer at sale. Some contracts run their mileage term from this. */
  purchaseMileage: ExtractedField<number>
  expirationDate: ExtractedField<string>
  /** An absolute odometer ceiling, distinct from a term length in miles. */
  expirationMiles: ExtractedField<number>
  termMonths: ExtractedField<number>
  termMiles: ExtractedField<number>

  deductibleAmount: ExtractedField<number>
  /** Per visit or per repair changes what the customer pays on a multi-line RO. */
  deductibleType: ExtractedField<DeductibleType>

  /** Starting work before authorisation is the top reason valid claims are denied. */
  requiresPriorAuthorization: ExtractedField<boolean>

  /** Checked against the vehicle before anything can be saved. */
  vin: ExtractedField<string>
}

export const EXTRACTED_FIELDS: (keyof ExtractedContract)[] = [
  'productType', 'adminCompany', 'contractNumber', 'coverageTier', 'tierType',
  'purchaseDate', 'purchaseMileage', 'expirationDate', 'expirationMiles',
  'termMonths', 'termMiles', 'deductibleAmount', 'deductibleType',
  'requiresPriorAuthorization', 'vin',
]

export type IssueSeverity = 'BLOCKING' | 'WARNING'

/**
 * Something the advisor has to look at.
 *
 * Blocking issues stop the save. There is exactly one thing serious enough to
 * be blocking — a VIN that does not match the vehicle — because attaching a
 * policy to the wrong car is silent, and it stays wrong for years.
 */
export interface ExtractionIssue {
  field: keyof ExtractedContract | 'document'
  severity: IssueSeverity
  message: string
}

export interface ExtractionDraft {
  contract: ExtractedContract
  issues: ExtractionIssue[]
  /** True when nothing blocking remains. Warnings do not stop a save. */
  saveable: boolean
  /** How much of this the advisor has to check carefully. */
  fieldsNeedingReview: (keyof ExtractedContract)[]
}

/** What the model is asked about, beyond the document itself. */
export interface ExtractionContext {
  /** So the VIN on the paper can be checked against the car on the drive. */
  vehicleVin: string
  vehicleLabel: string
}

/**
 * Why the advisor is looking at an empty form.
 *
 * Three outcomes, and the screen has to tell them apart, because what the
 * advisor should do next differs. `NO_PROVIDER` is not an error to apologise
 * for — it is a configuration fact, and the honest response is to say so and
 * let them type. See ./provider.ts for why there is no fourth outcome where a
 * mock invents plausible terms.
 */
export type ExtractionOutcome =
  /** A model read the document. Fields may still be null; that is a real answer. */
  | 'EXTRACTED'
  /** No API key configured. The document is stored; nobody read it. */
  | 'NO_PROVIDER'
  /** A model was called and the call failed. The document is stored. */
  | 'FAILED'
