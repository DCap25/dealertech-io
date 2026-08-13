import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { CopilotProvider } from './provider'

/**
 * Real model provider.
 *
 * Server-only — the key never reaches the browser. Streaming because an
 * advisor standing at a car wants the first words immediately, not a spinner
 * followed by a paragraph.
 */

const MODEL = 'claude-opus-5'

/**
 * Answers are two or three sentences. `effort: 'low'` keeps latency down for a
 * surface that is used mid-conversation, and thinking stays on — disabling it
 * on this model can make the reply leak internal tags.
 */
const EFFORT = 'low'
const MAX_TOKENS = 1024

let client: Anthropic | null = null
function getClient(): Anthropic {
  client ??= new Anthropic()
  return client
}

export const anthropicProvider: CopilotProvider = {
  name: 'anthropic',
  async *stream(call, signal) {
    const stream = getClient().messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: EFFORT },
        system: [
          {
            type: 'text',
            text: call.system,
            // The system prompt is byte-identical on every call, so it caches
            // across every tap on every drive.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: call.user }],
      },
      { signal },
    )

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text
      }
    }

    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') {
      yield '\n\n[The model declined to answer this one. Rephrase, or work it from the prep sheet directly.]'
    }
  },
}
