import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { classificationSchema } from './gate.ts'
import type { ModelDelta, ModelProvider, ModelRound } from './model.ts'

/**
 * A model that replays a script.
 *
 * One round per `stream()` call, in order. Each round streams its deltas one at a time, then
 * resolves a final message built from the joined text and whatever tool calls the script
 * names. The loop that consumes it cannot tell the difference, which is the whole point: a
 * test can now drive an entire conversation, assert on the cards and the events, and never
 * open a socket.
 *
 * Zod at the boundary, because scripts are JSON files written by hand and a mistyped field
 * should fail the test that loads it, not produce a confusing turn.
 */

export const fixtureRoundSchema = z.object({
  /** Streamed one at a time, in order. Joined to form the round's text. */
  deltas: z.array(z.string()).default([]),
  toolUses: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        input: z.unknown(),
      }),
    )
    .default([]),
  /**
   * Defaults to `tool_use` when there are tool uses and `end_turn` otherwise, which is what the
   * real model does. `max_tokens` scripts a truncation: the loop sees no content and no tools.
   */
  stopReason: z.enum(['end_turn', 'tool_use', 'max_tokens']).optional(),
  usage: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
    })
    .partial()
    .optional(),
})

export const fixtureTurnSchema = z.object({
  /** What the gate should decide for this turn. Defaults to plain banking. */
  gate: classificationSchema.optional(),
  rounds: z.array(fixtureRoundSchema).min(1),
})

export const fixtureScriptSchema = z.object({
  turns: z.array(fixtureTurnSchema).min(1),
})

export type FixtureRound = z.infer<typeof fixtureRoundSchema>
export type FixtureTurn = z.infer<typeof fixtureTurnSchema>
export type FixtureScript = z.infer<typeof fixtureScriptSchema>

/** What the gate decides when a turn does not say. */
export const FIXTURE_BANKING = classificationSchema.parse({
  category: 'banking',
  profanity: false,
  sensitive: false,
})

const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const

/**
 * The provider for one turn. Each `stream()` call takes the next round.
 *
 * Running past the end throws rather than returning an empty round. A script that runs out is
 * a test that is wrong, and a silent empty round would make the loop look like it had chosen
 * to say nothing.
 */
export function fixtureProvider(turn: FixtureTurn): ModelProvider {
  let next = 0

  return {
    stream() {
      const round = turn.rounds[next]
      if (round === undefined) {
        throw new Error(
          `Fixture script has ${String(turn.rounds.length)} round(s) and the turn asked for round ${String(next + 1)}.`,
        )
      }
      next += 1

      return replay(round, next)
    },
  }
}

function replay(round: FixtureRound, ordinal: number) {
  const deltas: ModelDelta[] = round.deltas.map((text) => ({ type: 'text_delta', text }))

  return {
    // An explicit iterator rather than an async generator: nothing here is awaited, and a
    // generator with no `await` in it is a lint error in this folder.
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next: () =>
          Promise.resolve(
            index < deltas.length
              ? { value: deltas[index++] as ModelDelta, done: false as const }
              : { value: undefined, done: true as const },
          ),
      }
    },

    finalMessage: () => Promise.resolve(finalMessageOf(round, ordinal)),
  }
}

function finalMessageOf(round: FixtureRound, ordinal: number): ModelRound {
  const stopReason = round.stopReason ?? (round.toolUses.length > 0 ? 'tool_use' : 'end_turn')

  /*
   * A truncated round finishes neither its text nor its tool call, so it has no content. This
   * is what the real model returns when it hits `max_tokens` mid-way, and it is the case the
   * loop's retry exists for.
   */
  const content: Anthropic.ContentBlockParam[] =
    stopReason === 'max_tokens'
      ? []
      : [
          { type: 'text', text: round.deltas.join('') },
          ...round.toolUses.map((use, index): Anthropic.ToolUseBlockParam => ({
            type: 'tool_use',
            id: use.id ?? `fixture-${String(ordinal)}-${String(index)}`,
            name: use.name,
            input: use.input ?? {},
          })),
        ]

  return {
    content,
    stop_reason: stopReason,
    // Spelled out rather than spread: a partial's absent fields spread as `undefined`, which
    // `exactOptionalPropertyTypes` rightly refuses to call a number.
    usage: {
      input: round.usage?.input ?? NO_USAGE.input,
      output: round.usage?.output ?? NO_USAGE.output,
      cacheRead: round.usage?.cacheRead ?? NO_USAGE.cacheRead,
      cacheWrite: round.usage?.cacheWrite ?? NO_USAGE.cacheWrite,
    },
  }
}
