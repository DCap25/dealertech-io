import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { emptyExtraction } from './review'
import type { VisionProvider } from './provider'
import type { ExtractedContract } from './types'

/**
 * Reads a photographed service contract.
 *
 * Server-only — the key never reaches the browser, and neither does the image,
 * which is a customer's document.
 */

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 2048

/**
 * A structured output schema, so the model cannot return prose where a date
 * belongs. Every field is an object rather than a bare value because the
 * confidence and the source text are what make the review screen fast — the
 * advisor's eye jumps to the quoted characters instead of re-reading the page.
 */
const FIELD = (description: string, valueSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    value: { ...valueSchema, description },
    confidence: {
      type: 'string',
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      description:
        'HIGH only when the characters are plainly legible and unambiguous. Anything inferred, ' +
        'reconstructed from context, or read off a crease, glare or fold is MEDIUM at best.',
    },
    sourceText: {
      type: ['string', 'null'],
      description: 'The exact characters you read this from, verbatim. Null if you inferred it.',
    },
  },
  required: ['value', 'confidence', 'sourceText'],
  additionalProperties: false,
})

const SCHEMA = {
  type: 'object',
  properties: {
    productType: FIELD(
      'The kind of product. TIRE_WHEEL for tire & wheel or road hazard. DENT for dent & ding or ' +
        'paintless dent repair. APPEARANCE for cosmetic, alloy wheel or interior/exterior protection. ' +
        'VSC for a vehicle service contract or extended warranty. PPM for prepaid maintenance. ' +
        'KEY for key replacement. WINDSHIELD for glass. THEFT for theft/etch protection.',
      { type: ['string', 'null'], enum: ['VSC', 'PPM', 'TIRE_WHEEL', 'KEY', 'DENT', 'WINDSHIELD', 'APPEARANCE', 'THEFT', null] },
    ),
    adminCompany: FIELD(
      'The administrator or obligor who authorises claims. Not the selling dealership.',
      { type: ['string', 'null'] },
    ),
    contractNumber: FIELD('The contract or agreement number.', { type: ['string', 'null'] }),
    purchaseDate: FIELD(
      'Purchase or effective date as YYYY-MM-DD. If the printed format is ambiguous between ' +
        'day-first and month-first and nothing on the document resolves it, return null with LOW ' +
        'confidence rather than choosing.',
      { type: ['string', 'null'] },
    ),
    expirationDate: FIELD(
      'Expiry date as YYYY-MM-DD, under the same rule about ambiguous formats.',
      { type: ['string', 'null'] },
    ),
    termMonths: FIELD('Term length in months.', { type: ['integer', 'null'] }),
    termMiles: FIELD('Term length in miles.', { type: ['integer', 'null'] }),
    deductibleAmount: FIELD(
      'Deductible per visit or per repair, in dollars. Zero is common and is not the same as absent.',
      { type: ['number', 'null'] },
    ),
    vin: FIELD('The full 17-character VIN printed on the contract.', { type: ['string', 'null'] }),
  },
  required: [
    'productType', 'adminCompany', 'contractNumber', 'purchaseDate',
    'expirationDate', 'termMonths', 'termMiles', 'deductibleAmount', 'vin',
  ],
  additionalProperties: false,
} as const

const SYSTEM = `You transcribe automotive service contracts from photographs.

You are transcribing, not interpreting. Report what is printed on the document.

Rules:
- Never infer a value from what is typical. A contract that does not print a
  mileage limit has no mileage limit to report; return null.
- Confidence is about legibility, not plausibility. A clearly printed unusual
  number is HIGH. A blurred ordinary one is LOW.
- sourceText must be the characters as they appear, including the label next to
  them where that helps a human find the spot on the page.
- If the image is not a service contract at all, return null for every value.

Someone will check every field you return against the document before it is
used. Making a field look more certain than it is costs them that check.`

let client: Anthropic | null = null
function getClient(): Anthropic {
  client ??= new Anthropic()
  return client
}

export const anthropicVisionProvider: VisionProvider = {
  name: 'anthropic',
  async extract({ imageBase64, mediaType, context }) {
    const message = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Reading a creased document off a phone camera is exactly the kind of
      // careful work adaptive thinking is for.
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: imageBase64 },
            },
            {
              type: 'text',
              text:
                `This document was photographed at a service drive and is being attached to a ` +
                `${context.vehicleLabel}, VIN ${context.vehicleVin}.\n\n` +
                `Do not let that VIN influence what you read. If the document shows a different ` +
                `VIN, report the one on the document — a mismatch is exactly what the check ` +
                `downstream is looking for.`,
            },
          ],
        },
      ],
    })

    const text = message.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return emptyExtraction()

    try {
      return JSON.parse(text.text) as ExtractedContract
    } catch {
      // A malformed response is a failed read, not a crash. The advisor gets
      // the hand-entry form with the photo still attached.
      return emptyExtraction()
    }
  },
}
