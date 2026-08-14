/**
 * Reading a service contract off a photograph.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST MODEL
 * ---------------------------------------------------------------------------
 * Nothing extracted here reaches the coverage engine. Not on high confidence,
 * not on a clean-looking document, not ever — an advisor confirms each field
 * against the paper in their hand first.
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

import type { ProductType } from '@/lib/coverage'

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

/** What a service contract has on it that the coverage engine cares about. */
export interface ExtractedContract {
  productType: ExtractedField<ProductType>
  adminCompany: ExtractedField<string>
  contractNumber: ExtractedField<string>
  /** ISO date. Ambiguous formats are returned LOW rather than guessed. */
  purchaseDate: ExtractedField<string>
  expirationDate: ExtractedField<string>
  termMonths: ExtractedField<number>
  termMiles: ExtractedField<number>
  deductibleAmount: ExtractedField<number>
  /** Checked against the vehicle before anything can be saved. */
  vin: ExtractedField<string>
}

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

/** What the model is asked about, beyond the image itself. */
export interface ExtractionContext {
  /** So the VIN on the paper can be checked against the car on the drive. */
  vehicleVin: string
  vehicleLabel: string
}
