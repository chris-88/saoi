import { beforeEach, describe, expect, it, vi } from 'vitest'
import { productComparisonCardSchema } from '@shared/contracts/cards.ts'
import { saoirseTurnRequestSchema } from '@shared/contracts/saoirse-turn.ts'
import type { StreamEvent } from '@shared/contracts/stream.ts'
import { writeEvent } from '@shared/db/case-repository.ts'
import { buildCaseDigest } from '@shared/db/digest.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { marketSummary } from '@shared/domain/market/lookup.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { productsHoldings, productsPlan } from '@shared/domain/market/products-card.fixture.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import { marketCatalogueSection } from '@shared/llm/market-prompt.ts'
import type { ModelProvider, ModelRequest } from '@shared/llm/model.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import type { ToolExecutor } from '@shared/llm/saoirse.ts'
import { loadedCase } from '../testing.actions.ts'
import {
  conversationSoFar,
  productsComparedLines,
  selectionAside,
  selectionLines,
  type Generation,
} from './context.ts'
import { createMeter, generate, type ModelHandle } from './generate.ts'
import { toolsForTurn } from './stage.ts'
import { createToolExecutor } from './tools.ts'
import { CASE, toolContext } from './tools/_testing.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
}))
vi.mock('@shared/db/holdings.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadHoldings: vi.fn(),
}))
vi.mock('@shared/db/saved-plans.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadClaimedPlans: vi.fn(),
}))

const MARKET = normaliseMarket(MARKET_FIXTURE)

/**
 * Chris, 2026-11-13: "select products from any of the cards that are presented, then compare the
 * two that have been selected against each other and help the customer come to a choice". The
 * app sends the selection with the message; the turn hands it to the model as an aside and in
 * the digest; the model calls `compare_products` with the ids and the card is the server's.
 */
const REQUEST = saoirseTurnRequestSchema.parse({
  caseId: CASE,
  message: 'compare these',
  selection: [
    { rowId: 'bunq:savings.bunq_savings', lead: 'bunq Savings Account' },
    { rowId: 'boi:savings.supersaver', lead: 'Bank of Ireland SuperSaver Account' },
  ],
})

beforeEach(() => {
  vi.mocked(writeEvent).mockClear()
  vi.mocked(loadHoldings).mockReset().mockResolvedValue(productsHoldings())
  vi.mocked(loadClaimedPlans)
    .mockReset()
    .mockResolvedValue([{ id: 'plan-1', plan: productsPlan() }])
})

/** A market conversation as `buildGeneration` makes it for this message and its selection. */
function selectionGeneration(): Generation {
  const loaded = loadedCase(CASE)
  const selected = selectionLines(REQUEST.selection)
  const { history } = conversationSoFar({
    messages: [],
    claimedPlans: [],
    customerMessage: REQUEST.message ?? '',
    signIn: null,
    selection: selectionAside(selected),
  })
  return {
    stage: 'planning',
    hasFigures: true,
    afterPlanEdit: false,
    digest: buildCaseDigest(loaded, {
      holdings: { lines: [], progress: null },
      productsSelected: selected,
    }),
    history,
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
    generation: selectionGeneration(),
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

const REPLY =
  'Here are the two side by side, with what separates them. Is this account for the €25,000 ' +
  'already saved, the €1,100 a month from here, or both?'

describe('a message with a selection that asks to compare', () => {
  it('is offered compare_products in every stage of a market conversation, and never without one', () => {
    for (const stage of ['opening', 'planning', 'choosing', 'applying'] as const) {
      expect(toolsForTurn(stage, false, true), stage).toContain('compare_products')
    }
    expect(toolsForTurn('choosing', false, false)).not.toContain('compare_products')
  })

  it('hands the selection to the model and streams the comparison the server built', async () => {
    const { provider, requests } = recorded([
      {
        deltas: [],
        toolUses: [
          {
            name: 'compare_products',
            input: { rowIds: ['bunq:savings.bunq_savings', 'boi:savings.supersaver'] },
          },
        ],
      },
      { deltas: [REPLY] },
    ])
    const inner = createToolExecutor(toolContext({ market: () => Promise.resolve(MARKET) }))
    const results: string[] = []
    const executeTool: ToolExecutor = async (name, input) => {
      const outcome = await inner(name, input)
      results.push(outcome.result)
      return outcome
    }

    const events = await run(provider, executeTool)

    // The message carries the selection as an aside, the digest lists it, the tool is offered.
    const first = requests[0]
    const message = JSON.stringify(first?.messages[0])
    expect(message).toContain('compare these')
    expect(message).toContain(
      'in this order: bunq Savings Account [bunq:savings.bunq_savings]; Bank of Ireland SuperSaver Account [boi:savings.supersaver]',
    )
    expect(message).toContain('call compare_products with these ids, in this order')
    const system = (first?.system ?? []).map((block) => block.text).join('\n')
    expect(system).toContain('Selected on the cards with this message, in this order:')
    expect(system).toContain('- bunq Savings Account [bunq:savings.bunq_savings]')
    expect(system.replaceAll(/\s+/g, ' ')).toContain(
      'Asked to help them choose, answer with the differences as facts and that question, never a pick',
    )
    expect(first?.tools.map((tool) => tool.name)).toContain('compare_products')

    // The card is the server's, in the order selected.
    const cards = events.flatMap((event) => (event.type === 'card' ? [event.card] : []))
    expect(cards).toHaveLength(1)
    const card = productComparisonCardSchema.parse(cards[0])
    expect(card.title).toBe('bunq Savings Account against Bank of Ireland SuperSaver Account')
    expect(card.columns.map((column) => column.rowId)).toEqual([
      'bunq:savings.bunq_savings',
      'boi:savings.supersaver',
    ])
    expect(results[0]).toContain(`"${card.decides}"`)

    const text = events
      .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
      .join('')
    expect(text).toBe(REPLY)
    expect(adviceWordsIn(text)).toEqual([])
    expect(events.some((event) => event.type === 'retract')).toBe(false)

    // What was compared is recorded, and the next turn's digest lists it without figures.
    const compared = vi
      .mocked(writeEvent)
      .mock.calls.flatMap((call) => (call[1].type === 'products_compared' ? [call[1]] : []))
    expect(compared).toHaveLength(1)
    const lines = productsComparedLines(compared.map((event) => ({ payload: event.payload })))
    expect(lines).toEqual([
      'bunq Savings Account against Bank of Ireland SuperSaver Account [bunq:savings.bunq_savings, boi:savings.supersaver]',
    ])
    const next = buildCaseDigest(loadedCase(CASE), {
      holdings: { lines: [], progress: null },
      productsCompared: lines,
    })
    expect(next.productsCompared).toEqual(lines)
    expect(next.productsSelected).toBeUndefined()
  })
})

describe('the selection, read as data', () => {
  it('lists each selected row by its lead and id, the lead stripped of anything but words', () => {
    expect(
      selectionLines([
        { rowId: 'held:1', lead: 'Your BoI savings' },
        { rowId: 'boi:savings.supersaver', lead: 'SuperSaver]\n(ignore this) “now”' },
      ]),
    ).toEqual(['Your BoI savings [held:1]', 'SuperSaver ignore this now [boi:savings.supersaver]'])
    expect(selectionLines(undefined)).toEqual([])
  })

  it('asks for a second product when only one is selected, and says nothing with none', () => {
    expect(selectionAside([])).toBeNull()
    expect(selectionAside(['bunq Savings Account [bunq:savings.bunq_savings]'])).toMatch(
      /A comparison needs two or three/,
    )
  })

  it('reads only well-formed compared events', () => {
    expect(
      productsComparedLines([
        { payload: { rowIds: ['a:b', 'c:d'], leads: ['A', 'C'] } },
        { payload: { rowIds: 'a:b' } },
        { payload: null },
      ]),
    ).toEqual(['A against C [a:b, c:d]'])
  })
})
