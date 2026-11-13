import { describe, expect, it, vi } from 'vitest'
import { withdraw, type StreamEvent } from '@shared/contracts/stream.ts'
import { exampleMarketPlan } from '@shared/contracts/market-plan.example.ts'
import { marketPlanSchema, type MarketPlan } from '@shared/contracts/market-plan.ts'
import { buildCaseDigest } from '@shared/db/digest.ts'
import { savedPlanDigestLines } from '@shared/db/saved-plans.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import { marketCatalogueSection } from '@shared/llm/market-prompt.ts'
import type { ModelProvider, ModelRequest } from '@shared/llm/model.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import type { ToolExecutor } from '@shared/llm/saoirse.ts'
import { loadedCase } from '../testing.actions.ts'
import type { Generation } from './context.ts'
import { createMeter, generate, type ModelHandle } from './generate.ts'
import { DEMO_PLAN_TOOLS } from './stage.ts'
import { CASE } from './tools/_testing.ts'

/**
 * Chris's conversation on the live app, 2026-11-13: a claimed home plan (€32,000 held, €1,000 a
 * month, a €450,000 price, €150,000 income given to the host card, first-time buyer, buying
 * alone). After "yes a plan" Saoirse ran the Demo Bank POC's `propose_plan` and
 * `show_arrangement`, offered to "start all of it with one tap", and asked for the price and the
 * income the plan held. Driven through `generate` with the fixture model, so the prompt and the
 * tools are the ones a live turn would send; the script is what the live model did.
 */
function claimedPlan(): MarketPlan {
  const base = marketPlanSchema.parse(exampleMarketPlan())
  return marketPlanSchema.parse({
    ...base,
    situation: {
      summary: 'From the Saoi home calculator card.',
      income: { annualGross: 150_000 },
      monthlySaving: 1_000,
      savings: [{ label: 'Deposit saved', balance: 32_000 }],
      debts: [],
    },
    debts: [],
    inputs: { homePrice: 450_000, propertyKind: 'second_hand', firstTimeBuyer: true },
  })
}

/** A market conversation as `buildGeneration` makes it, in the stage the live case was in. */
function marketGeneration(message: string): Generation {
  const loaded = loadedCase(CASE)
  const plan = claimedPlan()
  return {
    // A kept POC plan put the live case in `choosing`; the stage no longer decides anything here.
    stage: 'choosing',
    hasFigures: true,
    afterPlanEdit: false,
    digest: buildCaseDigest(loaded, {
      stage: 'choosing',
      holdings: { lines: [], progress: null },
      broughtPlans: [{ title: plan.title, lines: savedPlanDigestLines({ id: 'plan-1', plan }) }],
      goals: ['Still unknown for it: Annual basic salary, Property price.'],
    }),
    history: [{ role: 'user', content: message }],
  } as unknown as Generation
}

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

async function run(message: string, provider: ModelProvider, executeTool: ToolExecutor) {
  const handle: ModelHandle = {
    provider,
    model: 'test-model',
    classify: () => Promise.reject(new Error('not gated here')),
  }
  const events: StreamEvent[] = []
  for await (const event of generate({
    handle,
    generation: marketGeneration(message),
    gate: { allowed: true, suppressHumour: false, clarifyInScope: false } as never,
    loaded: { persona: slidersFor('default') } as never,
    kb: { products: undefined } as never,
    rateTable: undefined as never,
    executeTool,
    maxTokens: 1_000,
    meter: createMeter(Date.now()),
    rejections: [],
    called: [],
    marketCatalogue: marketCatalogueSection(null),
  })) {
    events.push(event)
  }
  // What the customer is left reading: the deltas, with each retraction applied where it came.
  const text = events.reduce(
    (said, event) =>
      event.type === 'text_delta'
        ? said + event.text
        : event.type === 'retract'
          ? withdraw(said, event.length)
          : said,
    '',
  )
  return { events, text }
}

const systemOf = (request: ModelRequest | undefined): string =>
  (request?.system ?? [])
    .map((block) => block.text)
    .join('\n')
    .replaceAll(/\s+/g, ' ')

describe('a market conversation asked for "a plan"', () => {
  it('runs none of the POC’s plan flow: no plan card, no arrangement, no "start"', async () => {
    const LIVE =
      'Buying alone, on €150,000, the plan runs deposit first, then the mortgage. You can start all of it with one tap.'
    const ANSWER =
      'This is the plan you saved, and it is kept with this conversation; a figure in it changes under Your plan.'
    const { provider, requests } = recorded([
      {
        deltas: [LIVE],
        toolUses: [
          { name: 'propose_plan', input: {} },
          { name: 'show_arrangement', input: {} },
        ],
      },
      { deltas: [ANSWER] },
    ])
    const executeTool = vi.fn<ToolExecutor>(() => Promise.resolve({ result: 'ran' }))

    const { events, text } = await run('yes a plan', provider, executeTool)

    const offered = requests[0]?.tools.map((tool) => tool.name) ?? []
    for (const tool of DEMO_PLAN_TOOLS) expect(offered, tool).not.toContain(tool)
    expect(executeTool).not.toHaveBeenCalled()
    const cards = events.flatMap((event) => (event.type === 'card' ? [event.card.type] : []))
    expect(cards).not.toContain('plan_proposal')
    expect(cards).not.toContain('arrangement')
    expect(cards).toEqual([])
    // What the live model said first is taken back; what is left starts nothing.
    expect(text).toBe(ANSWER)
    expect(text).not.toMatch(/\bstart/i)

    const system = systemOf(requests[0])
    expect(system).toContain('## How this conversation runs')
    expect(system).toContain('Never offer to build, propose or start another.')
    expect(system).not.toContain('## Where this conversation has got to')
    expect(system).not.toContain('Still unknown for it')
  })

  it('answers the income from the digest, not with a question', async () => {
    const ANSWER = 'Your plan has €150,000 a year before tax.'
    const { provider, requests } = recorded([{ deltas: [ANSWER] }])

    const { text } = await run(
      'what income did I give?',
      provider,
      vi.fn<ToolExecutor>(() => Promise.resolve({ result: 'ran' })),
    )

    // Everything the live reply asked again is in what the model is told, with the rule.
    const system = systemOf(requests[0])
    expect(system).toContain('never ask for any of these again')
    for (const figure of [
      'home price €450,000',
      'income €150,000 a year before tax',
      'first-time buyer',
      'buying alone',
      'saving €1,000 a month',
    ]) {
      expect(system, figure).toContain(figure)
    }
    expect(text).toBe(ANSWER)
    expect(text).not.toContain('?')
  })
})
