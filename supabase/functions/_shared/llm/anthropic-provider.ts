import type Anthropic from '@anthropic-ai/sdk'
import type { ModelProvider } from './model.ts'

/**
 * The real model, behind the seam.
 *
 * A pass-through with two narrowings: only text deltas are yielded, because that is all the
 * loop reads, and the final message's usage is mapped into the cost model's shape. The request
 * object goes to the SDK exactly as built, so caching breakpoints and tool schemas are
 * untouched by this layer.
 *
 * Errors are not caught here. An SDK error thrown during iteration propagates through the
 * generator unchanged, and that matters: the turn's own error handling reads the message to
 * tell a spend limit apart from a timeout, and it needs the SDK's words to do it.
 */
export function anthropicProvider(
  client: Anthropic,
  options: { readonly signal?: AbortSignal } = {},
): ModelProvider {
  return {
    stream(request) {
      // A signal lets the caller end a call that has run out of time; omitted, nothing changes.
      const stream = client.messages.stream(
        request,
        options.signal === undefined ? undefined : { signal: options.signal },
      )

      return {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              yield { type: 'text_delta', text: chunk.delta.text }
            }
          }
        },

        async finalMessage() {
          const message = await stream.finalMessage()
          return {
            content: message.content,
            stop_reason: message.stop_reason,
            usage: {
              input: message.usage.input_tokens,
              output: message.usage.output_tokens,
              cacheRead: message.usage.cache_read_input_tokens ?? 0,
              cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
            },
          }
        },
      }
    },
  }
}
