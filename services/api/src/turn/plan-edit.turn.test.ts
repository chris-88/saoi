import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withdraw, type StreamEvent } from '@shared/contracts/stream.ts'
import { saveMessage, writeEvent } from '@shared/db/case-repository.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import type { ModelProvider, ModelRequest } from '@shared/llm/model.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import type { ToolExecutor } from '@shared/llm/saoirse.ts'
import { returnInstruction, returnsAfterPlanEdit, type Generation } from './context.ts'
import { createMeter, generate, type ModelHandle } from './generate.ts'
import { persistReply } from './persist.ts'
import { toolsForTurn } from './stage.ts'
import { CASE } from './tools/_testing.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
  saveMessage: vi.fn(() => Promise.resolve('message-1')),
  touchLastSeen: vi.fn(() => Promise.resolve()),
}))
vi.mock('@shared/db/form-applications.ts', () => ({
  syncFormApplications: vi.fn(() => Promise.resolve({ forms: [], answered: 0, reused: 0 })),
}))

/**
 * The return turn after a plan edit in the profile (2026-11-12, "6. The saving months"). In the
 * live run after PR #74 it called `show_products` unasked and put a card under its reply. The
 * customer typed nothing, so the reply is text only: the model is asked with `tool_choice: none`
 * (the tools stay in the request, so the cached prefix holds), any call that arrives anyway is
 * refused and never run, and the reply is saved with no card.
 */

const reading =
  'Moving the keys to March 2028 means €8,530 less saved by then at this pace, four months short of the money for the keys, which is there in July 2028; the 18-month and two-year deposits no longer fit, and deposits of up to one year still do.'
const edited = {
  type: 'plan_edited',
  payload: { reading, effects: { nowFit: [], noLongerFit: ['18-month deposits'] } },
}

beforeEach(() => {
  vi.mocked(saveMessage).mockClear()
  vi.mocked(writeEvent).mockClear()
})

/** The generation `buildGeneration` makes for this return, without the database. */
const generation = {
  stage: 'planning',
  hasFigures: true,
  afterPlanEdit: returnsAfterPlanEdit('return', [edited]),
  digest: {
    customerName: null,
    authLevel: 'anonymous',
    facts: [],
    applications: [],
    declinedProducts: [],
    advisories: [],
    partner: null,
    eventsSinceLastSeen: [`You changed the plan in the app. ${reading}`],
  },
  history: [{ role: 'user', content: returnInstruction([edited]) }],
} as unknown as Generation

/** The fixture behind a recorder, so the request the model was sent can be read back. */
function recorded(rounds: unknown[]): { provider: ModelProvider; requests: ModelRequest[] } {
  const requests: ModelRequest[] = []
  const inner = fixtureProvider(fixtureTurnSchema.parse({ rounds }))
  return {
    requests,
    provider: {
      stream(request) {
        requests.push(request)
        return inner.stream(request)
      },
    },
  }
}

async function run(provider: ModelProvider, turnGeneration: Generation = generation) {
  const executeTool = vi.fn<ToolExecutor>(() =>
    Promise.reject(new Error('no tool runs on the return turn after a plan edit')),
  )
  const handle: ModelHandle = {
    provider,
    model: 'test-model',
    classify: () => Promise.reject(new Error('a return turn is not gated')),
  }
  const called: string[] = []
  const rejections: { name: string; error: string }[] = []
  const events: StreamEvent[] = []
  for await (const event of generate({
    handle,
    generation: turnGeneration,
    gate: { allowed: true, suppressHumour: false, clarifyInScope: false } as never,
    loaded: { persona: slidersFor('default') } as never,
    kb: { products: undefined } as never,
    rateTable: undefined as never,
    executeTool,
    maxTokens: 1_000,
    meter: createMeter(Date.now()),
    rejections,
    called,
  })) {
    events.push(event)
  }

  const cards = events.flatMap((event) => (event.type === 'card' ? [event.card] : []))
  // What the customer is left reading, retractions applied, as the turn saves it.
  const text = events.reduce(
    (said, event) =>
      event.type === 'text_delta'
        ? said + event.text
        : event.type === 'retract'
          ? withdraw(said, event.length)
          : said,
    '',
  )
  await persistReply({} as never, {
    turn: { caseId: CASE, trigger: 'return' },
    text,
    shown: cards,
    digest: { awaiting: undefined } as never,
    called,
    rejections,
    usage: {} as never,
  })
  return { executeTool, cards, text, called, rejections }
}

describe('the return turn after a plan edit', () => {
  it('is told apart from any other return', () => {
    expect(generation.afterPlanEdit).toBe(true)
    expect(returnsAfterPlanEdit('return', [{ type: 'application_approved' }])).toBe(false)
  })

  it('asks the model for words only, with the turn’s tools still in the request', async () => {
    const { provider, requests } = recorded([
      {
        deltas: [
          'With the date in March 2028, the one-year deposits are the longest that end by then.',
        ],
      },
    ])
    const result = await run(provider)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.tool_choice).toEqual({ type: 'none' })
    // The same tools as any turn in this stage, so the cached prefix is the same.
    expect(new Set(requests[0]?.tools.map((tool) => tool.name))).toEqual(
      new Set(toolsForTurn('planning', false, true)),
    )
    expect(result.executeTool).not.toHaveBeenCalled()
    expect(result.cards).toEqual([])
    expect(saveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ caseId: CASE, role: 'assistant', cards: [] }),
    )
  })

  it('runs no tool and saves no card even when the model reaches for show_products', async () => {
    const { provider } = recorded([
      {
        deltas: ['Here are the deposits that end by March 2028.'],
        toolUses: [{ name: 'show_products', input: { arrangement: 'fits_date' } }],
      },
      { deltas: ['With the date in March 2028, the one-year deposits still end by then.'] },
    ])
    const result = await run(provider)

    expect(result.executeTool).not.toHaveBeenCalled()
    expect(result.cards).toEqual([])
    expect(result.rejections.map((rejection) => rejection.name)).toEqual(['show_products'])
    expect(result.rejections[0]?.error).toMatch(/text only/)
    // The words that introduced the card are taken back; what stands is the answer in words.
    expect(result.text).toBe(
      'With the date in March 2028, the one-year deposits still end by then.',
    )
    expect(saveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caseId: CASE,
        role: 'assistant',
        cards: [],
        content: 'With the date in March 2028, the one-year deposits still end by then.',
      }),
    )
  })

  it('leaves a customer’s own message free to ask for products', async () => {
    const { provider, requests } = recorded([{ deltas: ['Fine.'] }])
    await run(provider, { ...generation, afterPlanEdit: false })
    expect(requests[0]?.tool_choice).toBeUndefined()
    expect(requests[0]?.tools.map((tool) => tool.name)).toContain('show_products')
  })
})
