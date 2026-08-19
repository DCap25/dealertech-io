import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { extractionSchema, extractionSystemPrompt } from './schema'
import { normaliseExtraction } from './normalise'
import { isPdf } from './upload'
import type { ExtractionProvider } from './provider'
import type { AcceptedMediaType } from './upload'
import type { ExtractionContext } from './types'

/**
 * Reads an uploaded service agreement.
 *
 * Server-only — the key never reaches the browser, and neither does the
 * document, which is a customer's paperwork with their name, VIN and often
 * their signature on it.
 *
 * Deliberately thin. Everything with a decision in it — the schema, the
 * prompt, the coercion of whatever comes back — lives in ./schema.ts and
 * ./normalise.ts, which are pure and tested. What is left here is the call
 * itself, which cannot be tested without spending money, so there is as little
 * of it as possible.
 */

const MODEL = 'claude-opus-5'

/**
 * Sixteen thousand, not four.
 *
 * On this model adaptive thinking spends from the same budget as the answer,
 * and reading a creased twelve-page contract is exactly the work it thinks
 * hardest about. At 4096 a dense scan could reason its way to the right fifteen
 * fields and then be cut off mid-JSON — which arrives here as a parse failure
 * and reaches the advisor as "nothing was read". 16000 is the documented
 * ceiling for a non-streaming request; the cost is only paid when the tokens
 * are actually used.
 */
const MAX_TOKENS = 16000

let client: Anthropic | null = null
function getClient(): Anthropic {
  client ??= new Anthropic()
  return client
}

/**
 * The document, as a content block.
 *
 * A PDF is a `document` block and the model reads its pages natively — it is
 * not rasterised into one image, which is what makes a twelve-page contract
 * work at all. An image is an `image` block. Everything else was rejected by
 * `checkUpload` long before it got here.
 */
function documentBlock(fileBase64: string, mediaType: AcceptedMediaType) {
  if (isPdf(mediaType)) {
    return {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: fileBase64,
      },
    }
  }
  /*
    No cast here, deliberately. `isPdf` narrows the union, so `mediaType` is
    already one of the formats the API accepts and the compiler is what says
    so. The cast this replaced asserted the same thing and was wrong: HEIC was
    an accepted upload type, so it silently satisfied the assertion, went out
    over the wire, and came back a 400.
  */
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: mediaType,
      data: fileBase64,
    },
  }
}

function instruction(context: ExtractionContext): string {
  return (
    `This document was uploaded at a service drive and is being attached to a ` +
    `${context.vehicleLabel}, VIN ${context.vehicleVin}.\n\n` +
    `Do not let that VIN influence what you read. If the document shows a different ` +
    `VIN, report the one on the document — a mismatch is exactly what the check ` +
    `downstream is looking for.`
  )
}

export const anthropicExtractionProvider: ExtractionProvider = {
  name: 'anthropic',
  model: MODEL,

  async extract({ fileBase64, mediaType, context }) {
    const message = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Reading a scanned or creased contract and mapping fifteen fields to a
      // closed vocabulary is exactly the kind of careful work adaptive
      // thinking is for.
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: extractionSchema() } },
      system: [
        {
          type: 'text',
          text: extractionSystemPrompt(),
          // Byte-identical on every call, so it caches across every upload.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          // Document first, then the instruction — the order the API expects.
          content: [documentBlock(fileBase64, mediaType), { type: 'text', text: instruction(context) }],
        },
      ],
    })

    /*
      A refusal or a truncation is a failed read, and it has to be said so.

      Both arrive as HTTP 200 with a plausible-looking message — a safety
      classifier declining returns `stop_reason: 'refusal'`, and running out of
      budget returns 'max_tokens' with whatever was written so far. Neither
      threw, so `store.ts` recorded outcome EXTRACTED, and the advisor was shown
      an empty form under a heading saying the document had been read and
      nothing found. That is the worst of the three possible answers: it invites
      them to conclude the contract is blank rather than to type it in.

      Throwing puts it back in the one branch that tells the truth — store.ts
      catches anything from here and records FAILED, which is what happened.
    */
    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
      throw new Error(`Extraction stopped early: ${message.stop_reason}`)
    }

    const text = message.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') {
      // A response with no text block at all, having not refused and not run
      // out of room. Nothing was read; `normaliseExtraction` turns that into a
      // blank form rather than a partially-populated one.
      return normaliseExtraction(null)
    }

    let parsed: unknown = null
    try {
      parsed = JSON.parse(text.text)
    } catch {
      // A malformed response is a failed read, not a crash. The advisor gets
      // the hand-entry form with the document still attached.
      parsed = null
    }

    return normaliseExtraction(parsed)
  },
}
