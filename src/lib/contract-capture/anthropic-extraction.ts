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
const MAX_TOKENS = 4096

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
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
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

    const text = message.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') {
      // A response with no text block is a refusal or a truncation. Either way
      // nothing was read, and `normaliseExtraction` turns that into a blank
      // form rather than a partially-populated one.
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
