import { normalizeVin } from '@/lib/vin/validate'
import { EXTRACTED_FIELDS } from './types'
import type {
  ExtractedContract, ExtractedField, ExtractionContext, ExtractionDraft, ExtractionIssue,
} from './types'

/**
 * Turns a raw extraction into something an advisor reviews.
 *
 * Pure — no model, no database. Everything here is a check that can be run
 * against a fixture, which matters because these are the rules that decide
 * whether a wrong reading reaches a customer.
 */

/** Anything at or below this is called out for a careful look. */
const REVIEW_AT: Record<string, boolean> = { LOW: true, MEDIUM: true, HIGH: false }

/** A service contract that ran for longer than this was misread. */
const MAX_TERM_MONTHS = 120
const MAX_TERM_MILES = 250_000
const MAX_DEDUCTIBLE = 1000
/** An odometer above this on a contract document is a misread, not a car. */
const MAX_ODOMETER = 500_000

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null
  // Deliberately strict. "04/11/2028" is two different dates depending on
  // which side of the Atlantic printed it, so the extractor is asked for ISO
  // and anything else is treated as unread rather than guessed at.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function issue(
  field: ExtractionIssue['field'],
  severity: ExtractionIssue['severity'],
  message: string,
): ExtractionIssue {
  return { field, severity, message }
}

/**
 * The VIN check.
 *
 * The one blocking rule. A policy attached to the wrong vehicle is silent —
 * nothing looks wrong on any screen — and it stays wrong until the day
 * somebody is told a repair is covered and it is not.
 */
function checkVin(
  vin: ExtractedField<string>,
  context: ExtractionContext,
): ExtractionIssue[] {
  if (!vin.value) {
    return [
      issue(
        'vin',
        'WARNING',
        'No VIN found on the document. Confirm by hand that this contract belongs to this vehicle.',
      ),
    ]
  }

  const onPaper = normalizeVin(vin.value)
  const onCar = normalizeVin(context.vehicleVin)

  if (onPaper === onCar) return []

  // A single mis-read character is a transcription problem, not a wrong
  // document — worth saying so, because the advisor's next move differs.
  const sameLength = onPaper.length === onCar.length
  const differing = sameLength
    ? [...onPaper].filter((c, i) => c !== onCar[i]).length
    : Infinity

  return [
    issue(
      'vin',
      'BLOCKING',
      differing === 1
        ? `VIN reads ${onPaper} but this vehicle is ${onCar} — one character apart. Check the document before saving.`
        : `VIN on this document (${onPaper}) is not this vehicle (${onCar}). This contract belongs to a different car.`,
    ),
  ]
}

function checkDates(contract: ExtractedContract): ExtractionIssue[] {
  const out: ExtractionIssue[] = []
  const purchase = parseIsoDate(contract.purchaseDate.value)
  const expiry = parseIsoDate(contract.expirationDate.value)

  if (contract.purchaseDate.value && !purchase) {
    out.push(issue('purchaseDate', 'WARNING', 'Purchase date could not be read as a date. Enter it by hand.'))
  }
  if (contract.expirationDate.value && !expiry) {
    out.push(issue('expirationDate', 'WARNING', 'Expiry date could not be read as a date. Enter it by hand.'))
  }
  if (purchase && expiry && expiry <= purchase) {
    out.push(
      issue('expirationDate', 'WARNING', 'Expiry is on or before the purchase date. One of the two was misread.'),
    )
  }
  return out
}

function checkTerms(contract: ExtractedContract): ExtractionIssue[] {
  const out: ExtractionIssue[] = []
  const months = contract.termMonths.value
  const miles = contract.termMiles.value
  const deductible = contract.deductibleAmount.value

  if (months !== null && (months <= 0 || months > MAX_TERM_MONTHS)) {
    out.push(issue('termMonths', 'WARNING', `${months} months is outside anything a contract is written for.`))
  }
  if (miles !== null && (miles <= 0 || miles > MAX_TERM_MILES)) {
    out.push(issue('termMiles', 'WARNING', `${miles.toLocaleString()} miles is outside anything a contract is written for.`))
  }
  if (deductible !== null && (deductible < 0 || deductible > MAX_DEDUCTIBLE)) {
    out.push(issue('deductibleAmount', 'WARNING', `A ${deductible} deductible is unusual enough to be worth checking.`))
  }
  return out
}

/**
 * Odometer figures, which are easy to misread by a factor of ten.
 *
 * An expiry mileage below the mileage at sale is the one worth catching: it
 * means the contract expired before it started, which is never what the
 * document says and always a transposed digit.
 */
function checkMileages(contract: ExtractedContract): ExtractionIssue[] {
  const out: ExtractionIssue[] = []
  const at = contract.purchaseMileage.value
  const until = contract.expirationMiles.value

  for (const [field, value] of [
    ['purchaseMileage', at],
    ['expirationMiles', until],
  ] as const) {
    if (value !== null && value > MAX_ODOMETER) {
      out.push(issue(field, 'WARNING', `${value.toLocaleString()} miles is higher than any odometer on a contract. Check for an extra digit.`))
    }
  }

  if (at !== null && until !== null && until <= at) {
    out.push(
      issue(
        'expirationMiles',
        'WARNING',
        `Coverage would end at ${until.toLocaleString()} miles, at or below the ${at.toLocaleString()} on the car when it was sold. One of the two was misread.`,
      ),
    )
  }
  return out
}

/**
 * The tier check.
 *
 * Exclusionary contracts list what is *not* covered; inclusionary ones list
 * what *is*. The engine defaults to exclusionary, which is the generous read —
 * so an inclusionary contract mistaken for one means promising coverage on a
 * component that was never named. That is the "eat a transmission" failure,
 * and an unread tier type is worth a warning rather than a silent default.
 */
function checkTier(contract: ExtractedContract): ExtractionIssue[] {
  if (contract.tierType.value !== null) return []
  if (contract.productType.value !== 'VSC') return []
  return [
    issue(
      'tierType',
      'WARNING',
      'Could not tell whether this contract lists what is covered or what is excluded. Exclusionary is assumed, which is the more generous reading — check the document.',
    ),
  ]
}

function checkEssentials(contract: ExtractedContract): ExtractionIssue[] {
  const out: ExtractionIssue[] = []

  // Product type is what the coverage engine arbitrates on. Without it there
  // is nothing to save that the engine could use.
  if (!contract.productType.value) {
    out.push(
      issue('productType', 'BLOCKING', 'Could not tell what kind of product this is. Choose it below.'),
    )
  }
  if (!contract.adminCompany.value) {
    out.push(
      issue('adminCompany', 'WARNING', 'No administrator found. Claims are authorised through them, so this matters.'),
    )
  }
  // A contract with no end at all is more likely a misread than a lifetime
  // product, but it is not impossible — so it warns rather than blocks.
  if (
    !contract.expirationDate.value &&
    !contract.termMonths.value &&
    !contract.termMiles.value &&
    !contract.expirationMiles.value
  ) {
    out.push(
      issue('document', 'WARNING', 'Nothing on this document says when the coverage ends. Check you uploaded every page.'),
    )
  }
  return out
}

export function reviewExtraction(
  contract: ExtractedContract,
  context: ExtractionContext,
): ExtractionDraft {
  const issues = [
    ...checkVin(contract.vin, context),
    ...checkEssentials(contract),
    ...checkTier(contract),
    ...checkDates(contract),
    ...checkTerms(contract),
    ...checkMileages(contract),
  ]

  const fieldsNeedingReview = EXTRACTED_FIELDS.filter(
    (key) => REVIEW_AT[contract[key].confidence] ?? true,
  )

  return {
    contract,
    issues,
    saveable: !issues.some((i) => i.severity === 'BLOCKING'),
    fieldsNeedingReview,
  }
}

/**
 * An empty draft — the hand-entry path.
 *
 * Reached three ways, and they are not failures to hide: extraction was never
 * available (no API key), the model was called and errored, or the model read
 * the document and found nothing it recognised. In all three the advisor gets
 * the same form and types what is in front of them.
 */
export function emptyExtraction(): ExtractedContract {
  const blank = <T>(): ExtractedField<T> => ({ value: null, confidence: 'LOW', sourceText: null })
  return {
    productType: blank(),
    adminCompany: blank(),
    contractNumber: blank(),
    coverageTier: blank(),
    tierType: blank(),
    purchaseDate: blank(),
    purchaseMileage: blank(),
    expirationDate: blank(),
    expirationMiles: blank(),
    termMonths: blank(),
    termMiles: blank(),
    deductibleAmount: blank(),
    deductibleType: blank(),
    requiresPriorAuthorization: blank(),
    vin: blank(),
  }
}
