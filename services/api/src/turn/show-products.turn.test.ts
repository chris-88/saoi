import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@shared/contracts/stream.ts'
import { marketProductsCardSchema } from '@shared/contracts/cards.ts'
import { saveMessage, writeEvent } from '@shared/db/case-repository.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { messageRow } from '@shared/db/rows.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { productsHoldings, productsPlan } from '@shared/domain/market/products-card.fixture.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import { runSaoirseTurn } from '@shared/llm/saoirse.ts'
import { demoDomainConfig } from '@shared/tenants/demo/domain-config.ts'
import { knowledgeBaseSection } from '@shared/tenants/demo/kb-prompt.ts'
import { loadedCase } from '../testing.actions.ts'
import { productsShownLines } from './context.ts'
import { persistReply } from './persist.ts'
import { toolsForTurn } from './stage.ts'
import { createToolExecutor } from './tools.ts'
import { CASE, toolContext } from './tools/_testing.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
  saveMessage: vi.fn(() => Promise.resolve('message-1')),
  touchLastSeen: vi.fn(() => Promise.resolve()),
}))
vi.mock('@shared/db/form-applications.ts', () => ({
  syncFormApplications: vi.fn(() => Promise.resolve({ forms: [], answered: 0, reused: 0 })),
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

beforeEach(() => {
  vi.mocked(saveMessage).mockClear()
  vi.mocked(writeEvent).mockClear()
  vi.mocked(loadHoldings).mockResolvedValue(productsHoldings())
  vi.mocked(loadClaimedPlans).mockResolvedValue([{ id: 'plan-1', plan: productsPlan() }])
})

describe('a turn that shows products', () => {
  it('is offered show_products only when the case holds figures, in any stage', () => {
    expect(toolsForTurn('opening', false, true)).toContain('show_products')
    expect(toolsForTurn('choosing', false, true)).toContain('show_products')
    expect(toolsForTurn('opening', false)).not.toContain('show_products')
    expect(toolsForTurn('applying', true, false)).not.toContain('show_products')
  })

  it('streams the card the server built and persists it with the reply', async () => {
    const enabledTools = toolsForTurn('opening', false, true)
    const provider = fixtureProvider(
      fixtureTurnSchema.parse({
        rounds: [
          {
            deltas: [],
            toolUses: [{ name: 'show_products', input: { arrangement: 'held_vs_market' } }],
          },
          { deltas: ['Here is your account beside what the market pays for the same money.'] },
        ],
      }),
    )
    const executeTool = createToolExecutor(toolContext({ market: () => Promise.resolve(MARKET) }))

    const events: StreamEvent[] = []
    for await (const event of runSaoirseTurn({
      provider,
      model: 'test-model',
      prompt: {
        domainConfig: demoDomainConfig,
        productCatalogue: knowledgeBaseSection(),
        sliders: slidersFor('default'),
        digest: {
          customerName: null,
          authLevel: 'anonymous',
          facts: [],
          applications: [],
          declinedProducts: [],
          advisories: [],
          partner: null,
          eventsSinceLastSeen: [],
        } as never,
      },
      history: [{ role: 'user', content: 'What does my savings account earn against the market?' }],
      executeTool,
      enabledTools,
    })) {
      events.push(event)
    }

    const cards = events.flatMap((event) => (event.type === 'card' ? [event.card] : []))
    expect(cards).toHaveLength(1)
    const card = marketProductsCardSchema.parse(cards[0])
    expect(card.arrangement.kind).toBe('held_vs_market')
    expect(card.rows[0]?.lead).toBe('Your BoI savings')

    const text = events
      .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
      .join('')
    await persistReply({} as never, {
      turn: { caseId: CASE, trigger: 'message' },
      text,
      shown: cards,
      digest: { awaiting: undefined } as never,
      called: ['show_products'],
      rejections: [],
      usage: {} as never,
    })
    expect(saveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ caseId: CASE, role: 'assistant', cards: [card] }),
    )
  })

  it('reads a stored products card back as its arrangement and title only', () => {
    const row = messageRow.parse({
      role: 'assistant',
      content: 'Here it is.',
      created_at: '2026-11-12T10:00:00Z',
      cards: [
        { type: 'status', applications: [] },
        {
          type: 'market_products',
          arrangement: { kind: 'by_access', title: 'Instant access against fixed term', line: 'x' },
          rows: [{ id: 'a', lead: 'bunq Savings Account' }],
        },
      ],
    })
    expect(row.cards).toEqual(['status', 'market_products'])
    expect(row.productsShown).toEqual([
      { kind: 'by_access', title: 'Instant access against fixed term' },
    ])
  })

  it('tells the next turn the card was shown and how, never its rows', () => {
    const loaded = loadedCase(CASE, {
      messages: [
        {
          role: 'customer',
          content: 'Against the market?',
          cards: [],
          createdAt: '',
          timing: null,
        },
        {
          role: 'assistant',
          content: 'Here it is.',
          cards: ['market_products'],
          productsShown: [{ kind: 'held_vs_market', title: 'Your account against the market' }],
          createdAt: '',
          timing: null,
        },
        { role: 'customer', content: 'By access instead?', cards: [], createdAt: '', timing: null },
      ],
    })
    expect(productsShownLines(loaded.messages)).toEqual([
      'Your account against the market (held_vs_market), your last reply',
    ])
  })
})
