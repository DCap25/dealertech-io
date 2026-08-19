import type { AcceptedMediaType } from './upload'
import type { ExtractedContract, ExtractionContext } from './types'

/**
 * Extraction, behind an interface for the same reason the Co-Pilot is: so the
 * whole flow — upload, review, confirm, save — can be developed and
 * demonstrated without a key, and so swapping the model is one file.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO MOCK HERE, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * Every other provider seam in this codebase has a mock that returns something
 * plausible, and `src/lib/copilot/provider.ts` says why: the product should
 * work on a fresh clone with no keys. This one breaks that pattern on purpose,
 * and the difference is worth stating rather than leaving as an inconsistency
 * somebody later "fixes".
 *
 * A mocked Co-Pilot answer is a sentence on a screen. A mocked *extraction* is
 * a Tire & Wheel policy, an administrator, an expiry date and a deductible,
 * attached to a real customer's real vehicle, sitting on the prep sheet of
 * every future visit — and the coverage engine cannot tell it from a contract
 * somebody read off paper. The previous version of this file did exactly that:
 * it returned a fully-populated Safeguard contract for whatever vehicle it was
 * handed. In a demo that is a nice screenshot. In a store running keyless, it
 * is the product inventing coverage, which is the one thing it must never do.
 *
 * So without a key there is no provider. The upload still works, the document
 * is still stored, and the advisor gets the review form empty with an honest
 * note saying nothing read it. Slower than a mock; the only version that
 * cannot put a fabricated policy in front of a customer.
 */

export interface ExtractionProvider {
  name: string
  /** The model behind it, recorded on the row so a bad batch can be found. */
  model: string
  extract(input: {
    /** Raw file bytes, base64 encoded. PDF or image. */
    fileBase64: string
    mediaType: AcceptedMediaType
    context: ExtractionContext
  }): Promise<ExtractedContract>
}

/** Only the variables this decision reads — keeps it testable. */
export interface ExtractionEnv {
  ANTHROPIC_API_KEY?: string | undefined
  CONTRACT_EXTRACTION?: string | undefined
  [key: string]: string | undefined
}

export type ExtractionProviderName = 'anthropic' | 'none'

/**
 * Which provider to use, if any.
 *
 * Key presence is the switch, unlike the Co-Pilot, which demands an explicit
 * `COPILOT_PROVIDER` opt-in so a key sitting in the environment for some other
 * purpose cannot start billing per tap on the drive. The spend shape here is
 * different: extraction runs once per document an advisor deliberately
 * uploaded, not once per interaction, so a key that exists is a key somebody
 * meant to use.
 *
 * `CONTRACT_EXTRACTION=off` turns it off anyway, for a store that wants hand
 * entry with the document still filed.
 */
export function resolveProviderName(env: ExtractionEnv = process.env): ExtractionProviderName {
  if (env.CONTRACT_EXTRACTION?.trim().toLowerCase() === 'off') return 'none'
  return env.ANTHROPIC_API_KEY ? 'anthropic' : 'none'
}

/** Null when nothing can read a document. Callers must handle it. */
export async function getExtractionProvider(): Promise<ExtractionProvider | null> {
  if (resolveProviderName() !== 'anthropic') return null
  // Imported lazily so the SDK never lands in a build that does not use it.
  const { anthropicExtractionProvider } = await import('./anthropic-extraction')
  return anthropicExtractionProvider
}
