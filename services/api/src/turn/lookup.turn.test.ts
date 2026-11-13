import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@shared/contracts/stream.ts'
import { writeEvent } from '@shared/db/case-repository.ts'
import { buildCaseDigest } from '@shared/db/digest.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { LOOKUP_ANSWER_RULE, marketSummary } from '@shared/domain/market/lookup.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import { marketCatalogueSection } from '@shared/llm/market-prompt.ts'
import type { ModelProvider, ModelRequest } from '@shared/llm/model.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import type { ToolExecutor } from '@shared/llm/saoirse.ts'
import { loadedCase } from '../testing.actions.ts'
import { productsLookedUpLines, type Generation } from './context.ts'
import { createMeter, generate, type ModelHandle } from './generate.ts'
import { DEMO_CATALOGUE_TOOLS, toolsForTurn } from './stage.ts'
import { createToolExecutor } from './tools.ts'
import { CASE, toolContext } from './tools/_testing.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
}))

/**
 * What Chris asked on the phone on 2026-11-13, in the app on a claimed plan: "But BOI has 18m
 * fix at 2.48% and AIB has 24m fix for 2.26%, aren't they both better than MoCo's 2.1%?" and was
 * told "an 18-month fixed rate of around that level is in Demo Bank's own deposit range … I don't
 * hold the AIB 24-month figure". Both products are in the market. Driven through `generate`
 * with the fixture model, so the prompt and the tools are the ones a live turn would send.
 */
const QUESTION =
  'But BOI has 18m fix at 2.48% and AIB has 24m fix for 2.26%, aren’t they both better than MoCo’s 2.1%?'

const MARKET = normaliseMarket(MARKET_FIXTURE)

beforeEach(() => {
  vi.mocked(writeEvent).mockClear()
})

/** A market conversation as `buildGeneration` makes it: a claimed plan, in the planning stage. */
function marketGeneration(): Generation {
  const loaded = loadedCase(CASE)
  return {
    stage: 'planning',
    hasFigures: true,
    afterPlanEdit: false,
    digest: buildCaseDigest(loaded, { holdings: { lines: [], progress: null } }),
    history: [{ role: 'user', content: QUESTION }],
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

async function run(provider: ModelProvider, executeTool: ToolExecutor) {
  const handle: ModelHandle = {
    provider,
    model: 'test-model',
    classify: () => Promise.reject(new Error('not gated here')),
  }
  const events: StreamEvent[] = []
  for await (const event of generate({
    handle,
    generation: marketGeneration(),
    gate: { allowed: true, suppressHumour: false, clarifyInScope: false } as never,
    loaded: { persona: slidersFor('default') } as never,
    kb: { products: undefined } as never,
    rateTable: undefined as never,
    executeTool,
    maxTokens: 1_000,
    meter: createMeter(Date.now()),
    rejections: [],
    called: [],
    marketCatalogue: marketCatalogueSection(marketSummary(MARKET)),
  })) {
    events.push(event)
  }
  return events
}

const ANSWER =
  'Both are in the market. Bank of Ireland’s Advantage pays 2.48% AER fixed for 18 months and ' +
  'AIB’s fixed term deposit 2.26% AER fixed for two years, both from CCPC and the bank’s own ' +
  'page, checked 9 November 2026; MoCo’s EasySaver is 2.10% variable with instant access.'

describe('a market conversation asked about named products', () => {
  it('offers lookup_products in every stage, and Demo Bank’s catalogue tools in none', () => {
    for (const stage of [
      'opening',
      'direction',
      'discovering',
      'planning',
      'arranging',
      'choosing',
      'applying',
    ] as const) {
      const offered = toolsForTurn(stage, false, true)
      expect(offered, stage).toContain('lookup_products')
      expect(offered, stage).toContain('show_products')
      for (const tool of DEMO_CATALOGUE_TOOLS)
        expect(offered, `${stage} ${tool}`).not.toContain(tool)
    }
    // A Demo Bank conversation keeps its catalogue tools and is not offered the market.
    expect(toolsForTurn('choosing', false, false)).toContain('show_product_options')
    expect(toolsForTurn('choosing', false, false)).not.toContain('lookup_products')
  })

  it('looks both products up and answers from the facts, with the source and the day', async () => {
    const { provider, requests } = recorded([
      {
        deltas: [],
        toolUses: [
          { name: 'lookup_products', input: { query: 'Bank of Ireland 18 month fixed' } },
          { name: 'lookup_products', input: { query: 'AIB 24 month fixed' } },
        ],
      },
      { deltas: [ANSWER] },
    ])
    const inner = createToolExecutor(toolContext({ market: () => Promise.resolve(MARKET) }))
    const results: string[] = []
    const executeTool: ToolExecutor = async (name, input) => {
      const outcome = await inner(name, input)
      results.push(outcome.result)
      return outcome
    }

    const events = await run(provider, executeTool)

    // The model was offered the lookup, and told the market rather than Demo Bank.
    const first = requests[0]
    expect(first?.tools.map((tool) => tool.name)).toContain('lookup_products')
    expect(first?.tools.map((tool) => tool.name)).not.toContain('show_mortgage_rates')
    const system = (first?.system ?? []).map((block) => block.text).join('\n')
    expect(system).not.toContain('Demo Bank')
    expect(system).toContain('# The market')
    expect(system.replaceAll(/\s+/g, ' ')).toContain(
      'Never say a figure is not held until `lookup_products` has found nothing for it',
    )
    const descriptions = (first?.tools ?? []).map((tool) => tool.description ?? '').join('\n')
    expect(descriptions).not.toContain('Demo Bank')

    // Both lookups found their product, with the figure, the period and the answer rule.
    expect(results).toHaveLength(2)
    expect(results[0]).toContain('Bank of Ireland, Advantage Fixed Term Deposit Account')
    expect(results[0]).toContain('Rate: 2.48% AER for 18 months')
    expect(results[1]).toContain('AIB, Personal Fixed Term Deposit')
    expect(results[1]).toContain('Rate: 2.26% AER for 2 years')
    for (const result of results) {
      expect(result).toContain(LOOKUP_ANSWER_RULE)
      expect(result).toMatch(/checked 9 Nov(ember)? 2026/)
      expect(adviceWordsIn(result)).toEqual([])
    }
    // The second round was handed both results.
    const handedBack = JSON.stringify(requests[1]?.messages.at(-1))
    expect(handedBack).toContain('2.48% AER for 18 months')
    expect(handedBack).toContain('2.26% AER for 2 years')

    const text = events
      .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
      .join('')
    expect(text).toBe(ANSWER)
    expect(events.some((event) => event.type === 'retract')).toBe(false)

    // What was looked up is recorded for the next turn: the queries and ids, no figures.
    const recordedLookups = vi
      .mocked(writeEvent)
      .mock.calls.flatMap((call) => (call[1].type === 'products_looked_up' ? [call[1]] : []))
    expect(recordedLookups.map((event) => event.payload?.['ids'])).toEqual([
      ['boi:savings.advantage_fixed'],
      ['aib:deposit.ladder_personal_fixed_term_deposit'],
    ])
    const lines = productsLookedUpLines(
      recordedLookups.map((event) => ({ payload: event.payload })).reverse(),
    )
    expect(lines).toEqual([
      '“AIB 24 month fixed”: AIB Personal Fixed Term Deposit [aib:deposit.ladder_personal_fixed_term_deposit]',
      '“Bank of Ireland 18 month fixed”: Bank of Ireland Advantage Fixed Term Deposit Account [boi:savings.advantage_fixed]',
    ])
  })

  it('lists earlier lookups in the next turn’s digest, without their figures', () => {
    const loaded = loadedCase(CASE)
    const digest = buildCaseDigest(loaded, {
      holdings: { lines: [], progress: null },
      productsLookedUp: productsLookedUpLines([
        { payload: { query: 'AIB 24 month fixed', ids: ['aib:x'], names: ['AIB Fixed'] } },
        { payload: { query: 'Revolut', ids: [], names: [] } },
        { payload: null },
      ]),
    })
    expect(digest.productsLookedUp).toEqual([
      '“AIB 24 month fixed”: AIB Fixed [aib:x]',
      '“Revolut”: nothing found',
    ])
  })
})
