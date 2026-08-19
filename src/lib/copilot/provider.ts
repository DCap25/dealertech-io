import { mockAnswer } from './mock-answer'
import { mockAppHelpAnswer } from './app-help'
import type { AppGuide } from './app-guide'
import type { CopilotContext, CopilotRequest } from './types'

/**
 * Provider seam.
 *
 * One interface, two implementations. The mock is the default so the whole
 * Co-Pilot works on a fresh clone with no keys; swapping in a real model is a
 * single env var, not a refactor.
 */

/**
 * What the answer is allowed to be built from.
 *
 * A union rather than two optional fields, because the two competences must not
 * be able to overlap: an app-help answer that could reach a `CopilotContext` is
 * one refactor away from putting a customer's coverage into an answer about how
 * the software works.
 */
export type CopilotGrounding =
  | { kind: 'VISIT'; context: CopilotContext }
  | { kind: 'APP'; guide: AppGuide }

export interface CopilotCall {
  system: string
  user: string
  /** The mock composes from these directly; a real model sees only the prompts. */
  request: CopilotRequest
  grounding: CopilotGrounding
}

export interface CopilotProvider {
  name: string
  stream(call: CopilotCall, signal?: AbortSignal): AsyncIterable<string>
}

/** Roughly a word at a time, so the mock feels like a model rather than a paste. */
const MOCK_CHUNK_MS = 18

export const mockProvider: CopilotProvider = {
  name: 'mock',
  async *stream(call, signal) {
    const text =
      call.grounding.kind === 'APP'
        ? mockAppHelpAnswer(call.request, call.grounding.guide)
        : mockAnswer(call.request, call.grounding.context)
    // Split on whitespace but keep it, so line breaks in the answer survive.
    const chunks = text.match(/\S+\s*/g) ?? [text]
    for (const chunk of chunks) {
      if (signal?.aborted) return
      await new Promise((r) => setTimeout(r, MOCK_CHUNK_MS))
      yield chunk
    }
  },
}

/**
 * Which provider to use.
 *
 * Explicit opt-in via COPILOT_PROVIDER. An API key sitting in the environment
 * for some other purpose should not silently start billing the dealership for
 * every tap on the drive.
 */
/** Only the two variables this decision reads — keeps it testable. */
export interface CopilotEnv {
  COPILOT_PROVIDER?: string | undefined
  ANTHROPIC_API_KEY?: string | undefined
  [key: string]: string | undefined
}

export function resolveProviderName(env: CopilotEnv = process.env): string {
  const requested = env.COPILOT_PROVIDER?.trim().toLowerCase()
  if (!requested || requested === 'mock') return 'mock'
  if (requested === 'anthropic') {
    return env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock'
  }
  return 'mock'
}

export async function getProvider(): Promise<CopilotProvider> {
  if (resolveProviderName() === 'anthropic') {
    // Imported lazily so the SDK never lands in a build that doesn't use it.
    const { anthropicProvider } = await import('./anthropic-provider')
    return anthropicProvider
  }
  return mockProvider
}
