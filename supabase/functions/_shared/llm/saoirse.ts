import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Card } from '../contracts/cards.ts'
import type { StreamEvent } from '../contracts/stream.ts'
import type { ModelUsage } from '../domain/cost.ts'
import type { ModelProvider } from './model.ts'
import { composeSystemPrompt, type PromptInput } from './prompt.ts'
import { TOOLS, validateToolCall, type ToolName, type ToolValidation } from './tools.ts'

/**
 * One Saoirse turn: stream text, run whatever tools the model asks for, stream the resulting
 * cards, and stop.
 *
 * The tool round limit is deliberate. Every tool here either records something or asks for a
 * card; none of them takes an action, so there is no legitimate reason for the model to loop,
 * and a bound means a confused turn ends rather than spending.
 */

const MAX_TOOL_ROUNDS = 3

/** Between what one round said and what the next says. Counted, so it can be taken back. */
const PARAGRAPH_BREAK = '\n\n'

/**
 * A backstop against runaway output (§47), not the enforcement — the gate is (Invariant 4).
 *
 * This was 1,024, which was wrong, and wrong in a way that only showed up on the best messages.
 * A customer who opens with everything at once — a mortgage, a savings account, a switch, two
 * children, income, rent, savings and a timeframe — is asking for prose, a record_facts call
 * carrying a dozen facts and a product card, all in one turn. That came to exactly 1,024 output
 * tokens, the ceiling cut it off mid-tool-call, and the turn ended with no text and no card.
 *
 * Three customers in a row got "Sorry — I lost my thread there" for giving Saoirse more to work
 * with than a short question would have. "Count to 10,000" is still impossible at this ceiling,
 * and it is refused before the model sees it regardless.
 */
export const SAOI_MAX_TOKENS = 3_072

/** What a tool call came to: what the model is told, and any card to render. */
export type ToolOutcome = {
  readonly result: string
  readonly card?: Card
  /**
   * The tool was asked to show or do something and did nothing the customer can see.
   *
   * Set by the handler, because only it knows. Not for "that is already on screen, point at
   * it", where the words the model wrote beside the call are right; and not for a fact round
   * that took some facts and not others, where they usually are. Set where they are not: the
   * words introduced something that is not there, and the round is withdrawn.
   */
  readonly refused?: true
}

/** Executes a validated tool call. */
export type ToolExecutor = (name: ToolName, input: unknown) => Promise<ToolOutcome>

/**
 * Appended to every refused result of a round whose words were withdrawn, so the model writes
 * the reply again rather than the second half of one the customer can no longer see.
 */
export const WITHDRAWAL_NOTE =
  'Nothing you wrote before this call reached the customer; it has been withdrawn. ' +
  'Write your reply again from what the results say, in words. Do not call the same tool ' +
  'again this turn: it will be refused again, and a turn that only calls refused tools says ' +
  'nothing at all.'

/**
 * Whether a call that never ran leaves the words written beside it wrong.
 *
 * A call that fails validation or throws showed nothing, so for a show or propose tool it is
 * withdrawn exactly as a refusal the handler chose would be: the sentence introducing it is
 * about something that is not there. The two recording tools are the exception. The text
 * written alongside a fact round is usually right whether or not every fact was taken, and
 * saying it again would cost output for nothing, so a `record_facts` or `record_form_answers`
 * failure of any kind keeps the round's words. The handlers hold the same line and never set
 * `refused` on a partial rejection.
 */
function withdrawsOnFailure(name: string): boolean {
  return name !== 'record_facts' && name !== 'record_form_answers'
}

/** One tool call, run or refused, before its result goes back to the model. */
type SettledCall = {
  readonly id: string
  readonly content: string
  readonly isError: boolean
  /** Showed or did nothing the customer can see; see `ToolOutcome.refused`. */
  readonly refused: boolean
}

export type SaoirseTurnOptions = {
  /**
   * The model behind the seam. The real one is `anthropicProvider(client)`; a test hands in
   * `fixtureProvider(turn)` and the loop cannot tell which it has.
   */
  readonly provider: ModelProvider
  readonly model: string
  readonly prompt: PromptInput
  /** Oldest first. The customer's new message is already the last entry. */
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
  readonly executeTool: ToolExecutor
  /**
   * Which tools to expose this turn. Tools whose cards are not built yet are left out
   * entirely rather than offered and failed — the model cannot misuse what it cannot see.
   */
  readonly enabledTools?: readonly ToolName[]
  /**
   * A reply in words only: the model is asked with `tool_choice: none`, and any tool call that
   * arrives anyway is refused, never run. The tools stay in the request, so the cached prefix
   * (tools, then the system prompt) is the same as every other turn's. The return turn after a
   * plan edit (2026-11-12, after the live run of PR #74 called `show_products` unasked).
   */
  readonly textOnly?: boolean
  /** Called when a tool call fails validation, so the turn can record what was refused. */
  readonly onToolRejected?: (rejection: { name: string; error: string }) => void
  /** Every tool the model reached for, before it is validated. */
  readonly onToolCalled?: (name: string) => void
  readonly maxTokens?: number
  /**
   * Called once per model round with what that round consumed.
   *
   * A callback rather than a stream event: the customer's browser has no use for this, and the
   * only thing that reads it is the console, which reads it back out of the database.
   */
  readonly onUsage?: (usage: ModelUsage) => void
}

/**
 * The tool schemas, as the API receives them.
 *
 * Exported so their size can be measured. They are 18% of everything sent and were invisible
 * in every audit of the prompt, because nobody writes them as prose — they are generated from
 * validators and live in another file.
 */
export function toolDefinitions(enabled?: readonly ToolName[]): Anthropic.Tool[] {
  const selected =
    enabled === undefined ? TOOLS : TOOLS.filter((tool) => enabled.includes(tool.name))
  return selected.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.schema, { io: 'input' }) as Anthropic.Tool.InputSchema,
  }))
}

/**
 * The system prompt is split at the cache breakpoint: everything through the product catalogue
 * is identical turn to turn, so it is cached; persona and the case digest follow it uncached.
 *
 * An hour rather than the default five minutes. The write costs 2x input instead of 1.25x, so
 * it is only worth it if it saves a second write — and it saves far more than one. The prefix
 * does not depend on the case, which means every customer, every audience session and every
 * run-through share one entry, and a presenter who talks for six minutes between questions no
 * longer pays 17,000 tokens to resume. One write an hour, for everybody.
 */
function systemBlocks(prompt: PromptInput): Anthropic.TextBlockParam[] {
  const { stablePrefix, caseSuffix } = composeSystemPrompt.withBreakpoint(prompt)

  return [
    { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: caseSuffix },
  ]
}

/**
 * A second breakpoint, at the end of the conversation so far.
 *
 * The system prompt was the only thing cached, so the message history — the largest block
 * after the catalogue, and the one thing that genuinely grows — was re-read at full price on
 * every round of every turn. A card turn is two rounds, so it was paid for twice.
 *
 * Marking the last message extends the cache by exactly what is new: the turns before it are
 * read at a tenth of the price, and only the newest message is written. Five minutes, not an
 * hour: this entry is specific to one case and is superseded by the next turn anyway, so
 * paying 2x to keep it for an hour would be buying something nobody collects. The longer TTL
 * has to come first in the prompt, and it does — the system block is above.
 */
function withHistoryBreakpoint(
  messages: readonly Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const copy = messages.map((message) => ({ ...message }))
  const last = copy[copy.length - 1]
  if (!last || typeof last.content !== 'string') return copy

  copy[copy.length - 1] = {
    ...last,
    content: [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }],
  }
  return copy
}

/**
 * Runs the turn, yielding stream events as they happen.
 *
 * Cards are held back until the text is finished. The model typically calls its tool in the
 * first round and explains itself in the second, so emitting cards as they happen would put
 * the options on screen before the sentence introducing them. Saoirse explains, then offers.
 *
 * `done` and `error` are not emitted here — the caller owns those, because only it knows the
 * persisted message id and the gate category.
 */
export async function* runSaoirseTurn(options: SaoirseTurnOptions): AsyncGenerator<StreamEvent> {
  const messages: Anthropic.MessageParam[] = withHistoryBreakpoint(
    options.history.map((turn) => ({ role: turn.role, content: turn.content })),
  )

  const system = systemBlocks(options.prompt)
  const tools = toolDefinitions(options.enabledTools)
  const cards: Card[] = []

  /**
   * Room to answer in, and one chance at more of it.
   *
   * Raising the ceiling makes truncation rare rather than impossible, and the failure is total:
   * a turn cut off before it says anything has nothing to show and nothing to retry from. So a
   * round that produces nothing at all is run again with double the room, once. It costs one
   * extra round on a turn that would otherwise have been lost outright.
   */
  const baseCeiling = options.maxTokens ?? SAOI_MAX_TOKENS
  let ceiling = baseCeiling
  let retriedTruncation = false

  /**
   * The model usually speaks, calls a tool, then speaks again about what came back. Each round
   * is its own stream, so without a separator the last sentence of one round and the first of
   * the next arrive joined: "They're here now.Mortgage first is usually the sensible order."
   * They are separate thoughts either side of a tool call, so they get a paragraph break.
   */
  let spoken = false

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let spokenThisRound = false
    /** Characters put on screen by this round, paragraph break included, so a withdrawal is exact. */
    let yieldedThisRound = 0
    const spokenBefore: boolean = spoken

    const stream = options.provider.stream({
      model: options.model,
      max_tokens: ceiling,
      system,
      messages,
      tools,
      ...(options.textOnly === true ? { tool_choice: { type: 'none' as const } } : {}),
    })

    // Read deltas straight off the stream, so the customer sees the answer forming rather
    // than waiting for the whole turn to finish.
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') {
        if (spokenThisRound) {
          yieldedThisRound += chunk.text.length
          yield { type: 'text_delta', text: chunk.text }
          continue
        }

        // Nothing said yet this round. Whitespace before the first word is dropped rather
        // than opening the message with a blank line, and a round that only ever emits
        // whitespace does not count as the model having spoken.
        const opening = chunk.text.replace(/^\s+/, '')
        if (opening === '') continue

        if (spoken) {
          yieldedThisRound += PARAGRAPH_BREAK.length
          yield { type: 'text_delta', text: PARAGRAPH_BREAK }
        }
        spokenThisRound = true
        spoken = true
        yieldedThisRound += opening.length
        yield { type: 'text_delta', text: opening }
      }
    }

    const message = await stream.finalMessage()

    /*
     * Charged per round, not per turn. The cached prefix is re-read every time the model is
     * called back with a tool result, which is what makes the number of rounds the thing that
     * actually drives cost rather than the size of the prompt.
     */
    options.onUsage?.(message.usage)

    const toolUses = message.content.filter(
      (block): block is Anthropic.ToolUseBlockParam => block.type === 'tool_use',
    )

    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
      /*
       * Hitting the token ceiling is a failure, and a silent one.
       *
       * A round that runs out of room mid-tool-call leaves an assistant message with no
       * finished text and no usable tool block, so the loop ends with nothing to show and
       * nothing refused — indistinguishable from a model that simply chose to say nothing.
       */
      if (message.stop_reason === 'max_tokens' && !spoken) {
        options.onToolRejected?.({
          name: 'model',
          error: `Ran out of output tokens before finishing. Round ${String(round + 1)}.`,
        })

        // Nothing reached the customer, so nothing is duplicated by going again. Only once:
        // a model that cannot answer inside twice the ceiling is not going to on a third try.
        if (!retriedTruncation) {
          retriedTruncation = true
          ceiling = baseCeiling * 2
          continue
        }
      }

      yield* cards.map((card): StreamEvent => ({ type: 'card', card }))
      yield* nothingSaid(spoken, cards)
      return
    }

    messages.push({ role: 'assistant', content: message.content })

    const settled: SettledCall[] = []

    for (const toolUse of toolUses) {
      options.onToolCalled?.(toolUse.name)
      /*
       * A tool this turn does not offer is refused, never run. The API only lets the model call
       * the tools it was sent, but a provider is a seam (the fixture replays whatever a script
       * says), and withholding is the enforcement the stages and the market conversation rest
       * on, so it is checked here too rather than trusted.
       */
      const offered =
        options.enabledTools === undefined ||
        (options.enabledTools as readonly string[]).includes(toolUse.name)
      const validation: ToolValidation =
        options.textOnly === true
          ? {
              ok: false,
              name: toolUse.name,
              error: 'This reply is text only: no tool is offered on this turn. Answer in words.',
            }
          : !offered
            ? {
                ok: false,
                name: toolUse.name,
                error: `${toolUse.name} is not offered in this conversation. Answer without it.`,
              }
            : validateToolCall(toolUse.name, toolUse.input)

      if (!validation.ok) {
        /*
         * An invalid call is a tool error the model can correct, never an error the customer
         * sees (CLAUDE.md > Saoirse model tools). It is also reported, which it was not.
         *
         * A tool the server keeps refusing is invisible from outside: the model burns its
         * rounds retrying, the turn ends with nothing said, and the customer gets "I lost my
         * thread" with no way for anybody to find out why. The same mistake as a gate that
         * failed closed without saying what failed.
         */
        options.onToolRejected?.({ name: toolUse.name, error: validation.error })
        settled.push({
          id: toolUse.id,
          content: validation.error,
          isError: true,
          refused: withdrawsOnFailure(toolUse.name),
        })
        continue
      }

      try {
        const outcome = await options.executeTool(validation.name, validation.input)
        // A refusal the handler chose is as much a call that came to nothing as a schema
        // failure, and was the one kind that left no row: six refused offers in one live
        // conversation read as `refused: 0`.
        if (outcome.refused === true) {
          options.onToolRejected?.({ name: toolUse.name, error: outcome.result.slice(0, 200) })
        }
        settled.push({
          id: toolUse.id,
          content: outcome.result,
          isError: false,
          refused: outcome.refused === true,
        })
        if (outcome.card) cards.push(outcome.card)
      } catch (error) {
        // The third way a tool call can come to nothing, and the last one that was invisible.
        options.onToolRejected?.({
          name: toolUse.name,
          error: `threw: ${error instanceof Error ? error.message : String(error)}`,
        })
        settled.push({
          id: toolUse.id,
          content: error instanceof Error ? error.message : 'That did not work.',
          isError: true,
          refused: withdrawsOnFailure(toolUse.name),
        })
      }
    }

    /*
     * Words about something that is not there.
     *
     * The model speaks, calls a tool, and speaks again about what came back. When the tool
     * refuses, the first sentence has already reached the customer and the reply contradicts
     * itself: "Payslip first, then. Send it in as a photo", then "there's no document I can
     * ask you for". Four times in one conversation. The text streams live because holding it
     * back would kill streaming on the round that matters, so the fix is to take it back: the
     * round's words come off the screen and out of the record, and every refused result says
     * so, because a model that is not told writes the second half of a reply the customer can
     * no longer see the first half of.
     *
     * Only a round that spoke. A round that only called the tool has nothing to take back.
     */
    const withdrawn = spokenThisRound && settled.some((call) => call.refused)

    if (withdrawn) {
      yield { type: 'retract', length: yieldedThisRound }
      // The screen is back to what the earlier rounds said, so the next round opens from
      // there: a paragraph break only if something still stands before it.
      spoken = spokenBefore
    }

    messages.push({
      role: 'user',
      content: settled.map((call): Anthropic.ToolResultBlockParam => ({
        type: 'tool_result',
        tool_use_id: call.id,
        content: withdrawn && call.refused ? `${call.content} ${WITHDRAWAL_NOTE}` : call.content,
        ...(call.isError ? { is_error: true } : {}),
      })),
    })
  }

  // The round limit was reached with tools still pending; show what was produced anyway.
  yield* cards.map((card): StreamEvent => ({ type: 'card', card }))
  yield* nothingSaid(spoken, cards)
}

/**
 * A turn that produced no words and no card has failed, whatever the model thought it was doing.
 *
 * Seen once in testing: every round spent calling a tool that the server refused, and the
 * customer got an empty bubble. Silence is the one reply that cannot be recovered from — there
 * is nothing to read and nothing to tap — so it is replaced with something that at least invites
 * them to try again.
 */
function* nothingSaid(spoken: boolean, cards: readonly unknown[]): Generator<StreamEvent> {
  if (spoken || cards.length > 0) return

  yield {
    type: 'text_delta',
    text: 'Sorry — I lost my thread there. Could you say that again?',
  }
}
