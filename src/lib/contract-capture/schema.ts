import { PRODUCT_TYPES, TIER_TYPES, DEDUCTIBLE_TYPES, productVocabularyPrompt } from './vocabulary'
import { EXTRACTED_FIELDS } from './types'

/**
 * The structured-output schema the model answers in, and the instructions
 * around it.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY FIELD IS AN OBJECT
 * ---------------------------------------------------------------------------
 * A bare `{"termMonths": 60}` would be half the tokens and useless. The review
 * screen is the safety mechanism in this whole flow, and what makes it fast
 * enough to actually be used is that each field carries the characters the
 * model says it read: the advisor's eye jumps to that spot on the page instead
 * of re-reading it. The confidence is the other half — it tells them which
 * four fields to check carefully rather than all fifteen.
 *
 * Pure and I/O-free — this file builds a description, it does not call
 * anything. Which means the thing most likely to rot silently (a product type
 * added to the engine and never mentioned to the model) is testable.
 */

/** One `{value, confidence, sourceText}` triple. */
function field(description: string, valueSchema: Record<string, unknown>) {
  return {
    type: 'object',
    properties: {
      value: { ...valueSchema, description },
      confidence: {
        type: 'string',
        enum: ['HIGH', 'MEDIUM', 'LOW'],
        description:
          'HIGH only when the characters are plainly legible and unambiguous. Anything inferred, ' +
          'reconstructed from context, or read off a crease, glare, fold or scan artefact is ' +
          'MEDIUM at best.',
      },
      sourceText: {
        type: ['string', 'null'],
        description: 'The exact characters you read this from, verbatim. Null if you inferred it.',
      },
    },
    required: ['value', 'confidence', 'sourceText'],
    additionalProperties: false,
  }
}

/** `["X", "Y", null]` — the enum plus the honest "I could not tell". */
function nullableEnum(members: readonly string[]) {
  return { type: ['string', 'null'], enum: [...members, null] }
}

/**
 * The schema, built from the engine's own vocabulary.
 *
 * `PRODUCT_TYPES` is spread rather than listed so a product added to
 * `productTypeEnum` and to the coverage engine cannot quietly remain
 * un-extractable — the schema and the prompt both widen with it.
 */
export function extractionSchema() {
  return {
    type: 'object',
    properties: {
      productType: field(
        'The kind of product this contract is. Map the marketing name printed on the document to ' +
          'one of these values; if none of them fits, return null rather than the closest.',
        nullableEnum(PRODUCT_TYPES),
      ),
      adminCompany: field(
        'The administrator or obligor who authorises claims — the company a service advisor would ' +
          'telephone. NOT the selling dealership and NOT the lender.',
        { type: ['string', 'null'] },
      ),
      contractNumber: field('The contract or agreement number.', { type: ['string', 'null'] }),
      coverageTier: field(
        'The plan or tier name as printed — for example "Platinum", "Gold", "Powertrain Plus". ' +
          'The marketing name of the level of cover, not the product category.',
        { type: ['string', 'null'] },
      ),
      tierType: field(
        'EXCLUSIONARY when the contract lists what is NOT covered (everything else is covered). ' +
          'INCLUSIONARY when it lists the specific components that ARE covered (everything else is ' +
          'not). Look for the heading over the component list: "what is not covered" and ' +
          '"exclusions" mean EXCLUSIONARY; "covered components" and "schedule of coverage" mean ' +
          'INCLUSIONARY. If there is no component list at all, return null.',
        nullableEnum(TIER_TYPES),
      ),

      purchaseDate: field(
        'Purchase or effective date as YYYY-MM-DD. If the printed format is ambiguous between ' +
          'day-first and month-first and nothing on the document resolves it, return null with LOW ' +
          'confidence rather than choosing.',
        { type: ['string', 'null'] },
      ),
      purchaseMileage: field(
        'The odometer reading at the time of sale, when the contract prints one.',
        { type: ['integer', 'null'] },
      ),
      expirationDate: field(
        'Expiry date as YYYY-MM-DD, under the same rule about ambiguous formats.',
        { type: ['string', 'null'] },
      ),
      expirationMiles: field(
        'An ABSOLUTE odometer reading at which cover ends ("expires at 100,000 miles"). This is ' +
          'not the same as a term length in miles — if the document says "36 months / 36,000 ' +
          'miles" that is a term, and belongs in termMiles, not here.',
        { type: ['integer', 'null'] },
      ),
      termMonths: field('Term length in months.', { type: ['integer', 'null'] }),
      termMiles: field(
        'Term length in miles, counted from the mileage at sale.',
        { type: ['integer', 'null'] },
      ),

      deductibleAmount: field(
        'Deductible in dollars, as a number. Zero is common and is NOT the same as absent — ' +
          'return 0 when the document says "no deductible" or "$0", and null when it says nothing.',
        { type: ['number', 'null'] },
      ),
      deductibleType: field(
        'PER_VISIT when one deductible covers the whole visit however many repairs it contains. ' +
          'PER_REPAIR when it applies to each covered repair separately. NONE when the deductible ' +
          'is zero. Null if the document does not say which.',
        nullableEnum(DEDUCTIBLE_TYPES),
      ),

      requiresPriorAuthorization: field(
        'True when the contract requires the administrator to authorise a repair BEFORE work or ' +
          'teardown begins. Look for "prior authorization", "must be authorized in advance", or a ' +
          'claims procedure whose first step is a telephone call. Null if the document is silent.',
        { type: ['boolean', 'null'] },
      ),

      vin: field(
        'The full 17-character VIN printed on the contract, exactly as printed.',
        { type: ['string', 'null'] },
      ),
    },
    required: [...EXTRACTED_FIELDS],
    additionalProperties: false,
  }
}

/**
 * The system prompt.
 *
 * Built with the product vocabulary inlined, because the single most valuable
 * thing to tell a model reading dealership paperwork is that "extended
 * warranty", "vehicle service agreement" and "mechanical breakdown protection"
 * are the same product under three administrators' marketing departments. Left
 * to invent a label, a model invents a good one, and a good invented label is
 * a contract the coverage engine cannot arbitrate on.
 */
export function extractionSystemPrompt(): string {
  return `You transcribe automotive service contracts from uploaded documents.

You are transcribing, not interpreting. Report what is printed on the document.

Map the product to one of these values. The names on the left are what this
system uses; the text after "Printed as" is what the paperwork tends to say:

${productVocabularyPrompt()}

Rules:
- Never infer a value from what is typical. A contract that does not print a
  mileage limit has no mileage limit to report; return null.
- Confidence is about legibility, not plausibility. A clearly printed unusual
  number is HIGH. A blurred ordinary one is LOW.
- sourceText must be the characters as they appear, including the label next to
  them where that helps a human find the spot on the page.
- A document may run to many pages. The fields you need are usually on the
  declarations or registration page; read the whole document before answering.
- If the document is not a service contract at all, return null for every value.

Someone will check every field you return against the document before it is
used, and a customer will be told what is covered on the strength of it. Making
a field look more certain than it is costs them that check.`
}
