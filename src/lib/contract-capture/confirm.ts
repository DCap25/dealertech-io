import { PRODUCT_TYPES, TIER_TYPES, DEDUCTIBLE_TYPES } from './vocabulary'
import {
  normaliseBoolean, normaliseEnum, normaliseInteger, normaliseIsoDate,
  normaliseMoney, normaliseText,
} from './normalise'
import type { ExtractedContract } from './types'
import type { ProductType, TierType, DeductibleType } from '@/lib/coverage'

/**
 * What the advisor actually agreed to, turned into a contract row.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SUBMITTED FORM IS RE-READ RATHER THAN TRUSTED
 * ---------------------------------------------------------------------------
 * The values that reach the database come from here, not from the extraction.
 * The advisor may have corrected every field, and a server action is a public
 * endpoint — anyone who can sign in can post to it with whatever body they
 * like. So the submitted form goes through the *same* normalisers the model's
 * output does, and then back through `reviewExtraction`, which is what makes
 * the VIN rule un-skippable: posting straight to the action does not get you
 * past a check that runs on the submitted data rather than the extracted data.
 *
 * ---------------------------------------------------------------------------
 * THE DEFAULTS ARE NOT COSMETIC
 * ---------------------------------------------------------------------------
 * Three fields have a default applied when nobody supplied one, and each is
 * chosen to fail in the direction that costs a phone call rather than a claim:
 *
 *   * `requiresPriorAuthorization` defaults to TRUE. Ringing an administrator
 *     who did not need to be rung wastes five minutes; tearing down an engine
 *     without the call is the single most common reason a valid claim is
 *     denied outright.
 *   * `deductibleType` is derived from the amount rather than assumed, because
 *     the schema's own default is PER_VISIT and quietly attaching a per-visit
 *     deductible to a zero-deductible contract invents a charge.
 *   * `tierType` defaults to EXCLUSIONARY to match the column, and
 *     `reviewExtraction` raises a warning when it had to, so the advisor sees
 *     that the generous reading was assumed rather than read.
 *
 * Pure and I/O-free.
 */

export interface ConfirmedContractValues {
  productType: ProductType
  adminCompany: string
  contractNumber: string | null
  coverageTier: string | null
  tierType: TierType
  purchaseDate: string
  purchaseMileage: number | null
  expirationDate: string | null
  expirationMiles: number | null
  termMonths: number | null
  termMiles: number | null
  deductibleAmount: number
  deductibleType: DeductibleType
  requiresPriorAuthorization: boolean
}

/** How the action hands one submitted field over. Keeps this module I/O-free. */
export type FieldReader = (name: string) => string | null

/**
 * The submitted form, as an `ExtractedContract`.
 *
 * Confidence is HIGH throughout and `sourceText` is null, and both are honest:
 * a person looked at each of these and pressed a button, and none of them came
 * off the page verbatim any more. The shape is reused so the submitted values
 * can be run back through `reviewExtraction` unchanged.
 */
export function readSubmittedContract(read: FieldReader): ExtractedContract {
  const field = <T>(name: string, coerce: (raw: unknown) => T | null) => ({
    value: coerce(read(name)),
    confidence: 'HIGH' as const,
    sourceText: null,
  })

  return {
    productType: field('productType', (v) => normaliseEnum(v, PRODUCT_TYPES)),
    adminCompany: field('adminCompany', normaliseText),
    contractNumber: field('contractNumber', normaliseText),
    coverageTier: field('coverageTier', normaliseText),
    tierType: field('tierType', (v) => normaliseEnum(v, TIER_TYPES)),

    purchaseDate: field('purchaseDate', normaliseIsoDate),
    purchaseMileage: field('purchaseMileage', normaliseInteger),
    expirationDate: field('expirationDate', normaliseIsoDate),
    expirationMiles: field('expirationMiles', normaliseInteger),
    termMonths: field('termMonths', normaliseInteger),
    termMiles: field('termMiles', normaliseInteger),

    deductibleAmount: field('deductibleAmount', normaliseMoney),
    deductibleType: field('deductibleType', (v) => normaliseEnum(v, DEDUCTIBLE_TYPES)),

    requiresPriorAuthorization: field('requiresPriorAuthorization', normaliseBoolean),

    vin: field('vin', normaliseText),
  }
}

export type ConfirmedPayload =
  | { ok: true; values: ConfirmedContractValues }
  | { ok: false; missing: (keyof ExtractedContract)[]; message: string }

const REQUIRED_LABELS: Partial<Record<keyof ExtractedContract, string>> = {
  productType: 'product',
  adminCompany: 'administrator',
  purchaseDate: 'purchase date',
}

/**
 * The three fields a contract cannot be saved without, and why they are these.
 *
 * Product type is what the engine arbitrates on. The administrator is who
 * authorises a claim — a contract nobody can ring is not usable at a service
 * counter. The purchase date is where every term calculation starts, and a
 * contract with no start has no computable end.
 *
 * Everything else is genuinely optional on real paperwork, so demanding it
 * would push advisors into inventing values, which is the failure this whole
 * flow exists to prevent.
 */
export function buildConfirmedValues(contract: ExtractedContract): ConfirmedPayload {
  const missing = (Object.keys(REQUIRED_LABELS) as (keyof ExtractedContract)[]).filter(
    (key) => contract[key].value === null,
  )

  if (missing.length > 0) {
    const labels = missing.map((key) => REQUIRED_LABELS[key])
    const list =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    return {
      ok: false,
      missing,
      message: `Add the ${list} before saving — the coverage engine cannot answer anything without ${
        missing.length === 1 ? 'it' : 'them'
      }.`,
    }
  }

  const deductibleAmount = contract.deductibleAmount.value ?? 0

  return {
    ok: true,
    values: {
      productType: contract.productType.value as ProductType,
      adminCompany: contract.adminCompany.value as string,
      contractNumber: contract.contractNumber.value,
      coverageTier: contract.coverageTier.value,
      tierType: contract.tierType.value ?? 'EXCLUSIONARY',

      purchaseDate: contract.purchaseDate.value as string,
      purchaseMileage: contract.purchaseMileage.value,
      expirationDate: contract.expirationDate.value,
      expirationMiles: contract.expirationMiles.value,
      termMonths: contract.termMonths.value,
      termMiles: contract.termMiles.value,

      deductibleAmount,
      // Derived, not defaulted — see the note at the top of this file.
      deductibleType:
        contract.deductibleType.value ?? (deductibleAmount > 0 ? 'PER_VISIT' : 'NONE'),

      // Unknown means required. A wasted phone call is cheaper than a denial.
      requiresPriorAuthorization: contract.requiresPriorAuthorization.value ?? true,
    },
  }
}
