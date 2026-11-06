import { describe, expect, it } from 'vitest'
import {
  FIXTURE_BANKING,
  fixtureProvider,
  fixtureScriptSchema,
  fixtureTurnSchema,
} from './fixture-provider.ts'

const request = { model: 'fixture', max_tokens: 10, system: [], messages: [], tools: [] }

async function drain(provider: ReturnType<typeof fixtureProvider>) {
  const stream = provider.stream(request)
  const text: string[] = []
  for await (const delta of stream) text.push(delta.text)
  return { text, final: await stream.finalMessage() }
}

describe('replaying a scripted round', () => {
  it('streams the deltas in order and joins them into the final text', async () => {
    const turn = fixtureTurnSchema.parse({
      rounds: [{ deltas: ['First home, ', 'that is a good one.'] }],
    })

    const { text, final } = await drain(fixtureProvider(turn))

    expect(text).toEqual(['First home, ', 'that is a good one.'])
    expect(final.content).toEqual([{ type: 'text', text: 'First home, that is a good one.' }])
    expect(final.stop_reason).toBe('end_turn')
  })

  /** What the real model does: a round with a tool call stops on `tool_use`. */
  it('stops on tool_use when the round asks for a tool, with an id the loop can echo back', async () => {
    const turn = fixtureTurnSchema.parse({
      rounds: [
        {
          deltas: ['Let me note that.'],
          toolUses: [{ name: 'record_facts', input: { facts: [] } }],
        },
      ],
    })

    const { final } = await drain(fixtureProvider(turn))

    expect(final.stop_reason).toBe('tool_use')
    expect(final.content[1]).toMatchObject({
      type: 'tool_use',
      id: 'fixture-1-0',
      name: 'record_facts',
      input: { facts: [] },
    })
  })

  /** A truncated round has nothing in it, which is the case the loop's retry exists for. */
  it('scripts a truncation as an empty round', async () => {
    const turn = fixtureTurnSchema.parse({
      rounds: [{ deltas: ['cut off mid'], stopReason: 'max_tokens' }],
    })

    const { final } = await drain(fixtureProvider(turn))

    expect(final.stop_reason).toBe('max_tokens')
    expect(final.content).toEqual([])
  })

  it('takes one round per stream call, in order', async () => {
    const provider = fixtureProvider(
      fixtureTurnSchema.parse({ rounds: [{ deltas: ['one'] }, { deltas: ['two'] }] }),
    )

    expect((await drain(provider)).text).toEqual(['one'])
    expect((await drain(provider)).text).toEqual(['two'])
  })

  /** A script that runs out is a test that is wrong, and it should say so rather than go quiet. */
  it('throws when the turn asks for more rounds than the script has', async () => {
    const provider = fixtureProvider(fixtureTurnSchema.parse({ rounds: [{ deltas: ['only'] }] }))
    await drain(provider)

    expect(() => provider.stream(request)).toThrow(/1 round\(s\).*round 2/)
  })

  it('reports zero usage unless the script says otherwise', async () => {
    const quiet = await drain(fixtureProvider(fixtureTurnSchema.parse({ rounds: [{}] })))
    expect(quiet.final.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

    const priced = await drain(
      fixtureProvider(
        fixtureTurnSchema.parse({ rounds: [{ usage: { input: 28_633, cacheRead: 28_000 } }] }),
      ),
    )
    expect(priced.final.usage).toEqual({
      input: 28_633,
      output: 0,
      cacheRead: 28_000,
      cacheWrite: 0,
    })
  })
})

describe('the script at the boundary', () => {
  it('defaults the gate to banking', () => {
    const turn = fixtureTurnSchema.parse({ rounds: [{}] })
    expect(turn.gate).toBeUndefined()
    expect(FIXTURE_BANKING).toEqual({ category: 'banking', profanity: false, sensitive: false })
  })

  it('refuses a script with no turns, and a turn with no rounds', () => {
    expect(() => fixtureScriptSchema.parse({ turns: [] })).toThrow()
    expect(() => fixtureScriptSchema.parse({ turns: [{ rounds: [] }] })).toThrow()
  })

  it('refuses a stop reason the real model never gives', () => {
    expect(() => fixtureTurnSchema.parse({ rounds: [{ stopReason: 'because' }] })).toThrow()
  })
})
