import type Anthropic from '@anthropic-ai/sdk'
import type { ModelUsage } from '../domain/cost.ts'

/**
 * The model, as a Saoirse turn needs it and no wider.
 *
 * `runSaoirseTurn` used to take an `Anthropic` client and call `messages.stream` on it, which
 * meant the only way to run a turn was to pay for one. CLAUDE.md said for weeks that a fixture
 * provider was "the single change that would most improve what the suite can catch", and it
 * was right: the output-ceiling bug, the data-notice bug and the product-collapse bug all
 * reached a person before a test, because no test could drive a conversation.
 *
 * So this is the seam. It is exactly the shape the loop reads and nothing more: one request
 * shape, one streamed event, one final message. The Anthropic adapter is a few lines that pass
 * things through; the fixture replays a script. Neither knows about the other.
 *
 * Deliberately not a general LLM abstraction. There is one provider and one fixture, and a
 * second provider would be a decision, not a drop-in.
 */

/** The five fields the loop sends. Passed to the SDK unchanged, so the types are the SDK's. */
export type ModelRequest = {
  readonly model: string
  readonly max_tokens: number
  readonly system: Anthropic.TextBlockParam[]
  readonly messages: Anthropic.MessageParam[]
  readonly tools: Anthropic.Tool[]
}

/** The only streamed event the loop reads. Everything else the SDK emits is dropped upstream. */
export type ModelDelta = { readonly type: 'text_delta'; readonly text: string }

/**
 * What a round came to, once the stream has finished.
 *
 * `content` goes straight back into the conversation as the assistant turn, so it has to be
 * the whole reply the model gave and not a summary of it. `stop_reason` decides whether the
 * loop runs the tools or stops. `usage` is already in the shape the cost model wants.
 */
export type ModelRound = {
  readonly content: Anthropic.ContentBlockParam[]
  readonly stop_reason: Anthropic.Message['stop_reason']
  readonly usage: ModelUsage
}

export type ModelStream = AsyncIterable<ModelDelta> & {
  finalMessage(): Promise<ModelRound>
}

export type ModelProvider = {
  stream(request: ModelRequest): ModelStream
}
