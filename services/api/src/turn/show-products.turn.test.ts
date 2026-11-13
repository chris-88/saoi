import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@shared/contracts/stream.ts'
import { marketProductsCardSchema } from '@shared/contracts/cards.ts'
import { saveMessage, writeEvent } from '@shared/db/case-repository.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { buildCaseDigest } from '@shared/db/digest.ts'
import { messageRow } from '@shared/db/rows.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import {
  PRODUCTS_AS_OF,
  productsHoldings,
  productsPlan,
} from '@shared/domain/market/products-card.fixture.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import { composeSystemPrompt } from '@shared/llm/prompt.ts'
import { runSaoirseTurn } from '@shared/llm/saoirse.ts'
import { demoDomainConfig } from '@shared/tenants/demo/domain-config.ts'
import { knowledgeBaseSection } from '@shared/tenants/demo/kb-prompt.ts'
import { loadedCase } from '../testing.actions.ts'
import { productsBasisLines, productsMustKnowLines, productsShownLines } from './context.ts'
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

  it('hands the model each row’s figureBasis beside the card, never on it', async () => {
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
    const inner = createToolExecutor(toolContext({ market: () => Promise.resolve(MARKET) }))
    const results: string[] = []
    const executeTool: typeof inner = async (name, input) => {
      const outcome = await inner(name, input)
      results.push(outcome.result)
      return outcome
    }

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

    expect(results).toHaveLength(1)
    const result = results[0] ?? ''
    expect(result).toContain('figureBasis')
    // The groups, by label, so a reply can name them.
    expect(result).toMatch(
      /It is in groups: “Yours” \(2 rows\) and “The market” \(6 rows\); refer to a group by its label\./,
    )
    expect(result).toMatch(
      /- bunq Savings Account: €[\d,]+ counts 3\.11% to 1 January, then 1\.61% to €10,000 and 1\.51% above\./,
    )
    expect(result).toMatch(/- MoCo EasySaver: €[\d,]+ counts 2\.10%, the rate for new accounts,/)
    expect(adviceWordsIn(result)).toEqual([])

    // The card carries the period on the value and the note, and no figureBasis.
    const card = marketProductsCardSchema.parse(
      events.flatMap((event) => (event.type === 'card' ? [event.card] : []))[0],
    )
    const bunq = card.rows.find((row) => row.id === 'bunq:savings.bunq_savings')
    expect(bunq?.value).toBe('3.11% to 1 Jan')
    expect(bunq?.note).toBe('then 1.61% to €10,000 and 1.51% above; the money counts both')
    expect(JSON.stringify(card)).not.toContain('figureBasis')

    // The event records what the model was handed.
    const shown = vi
      .mocked(writeEvent)
      .mock.calls.find((call) => call[1].type === 'products_shown')?.[1]
    const recorded = shown?.payload?.['figureBasis'] as readonly { id: string }[] | undefined
    expect(recorded?.map((row) => row.id)).toContain('bunq:savings.bunq_savings')
  })

  it('the turn after a card sees what each row’s money figure counts in its digest', async () => {
    // The tool works from today in Dublin; the fixture's figures are for 2026-11-12.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${PRODUCTS_AS_OF}T12:00:00Z`))
    try {
      const executeTool = createToolExecutor(toolContext({ market: () => Promise.resolve(MARKET) }))
      await executeTool('show_products', { arrangement: 'held_vs_market' })
    } finally {
      vi.useRealTimers()
    }
    const recorded = vi
      .mocked(writeEvent)
      .mock.calls.flatMap((call) => (call[1].type === 'products_shown' ? [call[1]] : []))
    expect(recorded).toHaveLength(1)

    // The next turn: the card is in the transcript, the event in the case's events.
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
      ],
    })
    const productsBasis = productsBasisLines(
      recorded.map((event) => ({ payload: event.payload })).reverse(),
    )
    const digest = buildCaseDigest(loaded, {
      holdings: { lines: [], progress: null },
      productsShown: productsShownLines(loaded.messages),
      productsBasis,
    })
    const prompt = composeSystemPrompt({
      domainConfig: demoDomainConfig,
      productCatalogue: knowledgeBaseSection(),
      sliders: slidersFor('default'),
      digest,
    })
    expect(prompt).toContain(
      '- bunq Savings Account, 3.11% to 1 Jan (held_vs_market): €456 counts 3.11% to 1 January, then 1.61% to €10,000 and 1.51% above.',
    )
    expect(prompt).toContain(
      '€456 counts 3.11% to 1 January, then 1.61% to €10,000 and 1.51% above.',
    )
    expect(prompt).toMatch(/- Your BoI savings, 0\.50% \(held_vs_market\): €\d+ counts 0\.50%/)
  })

  it('keeps the figure basis to the newest card of each arrangement, two at most', () => {
    const card = (arrangement: string, lead: string) => ({
      payload: {
        arrangement,
        figureBasis: [{ id: lead, lead, value: '1.00%', line: `${lead} line.` }],
      },
    })
    // Newest first, as the events are read.
    const lines = productsBasisLines([
      card('by_access', 'Newest'),
      card('held_vs_market', 'Second'),
      card('by_access', 'Older by access'),
      card('fits_date', 'Third arrangement'),
      { payload: { arrangement: 'mortgage_by_sort' } },
    ])
    expect(lines).toEqual([
      'Newest, 1.00% (by_access): Newest line.',
      'Second, 1.00% (held_vs_market): Second line.',
    ])
    expect(productsBasisLines([{ payload: null }, { payload: { arrangement: 'x' } }])).toEqual([])
  })

  it('reads a stored card’s groups back by label, and names them to the next turn', () => {
    const row = messageRow.parse({
      role: 'assistant',
      content: 'Here it is.',
      created_at: '2026-11-13T10:00:00Z',
      cards: [
        {
          type: 'market_products',
          arrangement: {
            kind: 'by_access',
            title: 'Instant access against fixed term',
            line: 'x',
            groups: [
              { label: 'Instant access', rowIds: ['a'] },
              { label: 'Fixed term', rowIds: ['b'] },
            ],
          },
          rows: [],
        },
      ],
    })
    expect(row.productsShown).toEqual([
      {
        kind: 'by_access',
        title: 'Instant access against fixed term',
        groups: ['Instant access', 'Fixed term'],
      },
    ])
    const loaded = loadedCase(CASE, {
      messages: [
        { role: 'customer', content: 'By access?', cards: [], createdAt: '', timing: null },
        {
          role: 'assistant',
          content: 'Here it is.',
          cards: ['market_products'],
          productsShown: row.productsShown,
          createdAt: '',
          timing: null,
        },
      ],
    })
    expect(productsShownLines(loaded.messages)).toEqual([
      'Instant access against fixed term (by_access; in groups: Instant access, Fixed term), your last reply',
    ])
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

describe('a product’s must-knows, once it is asked about by name (2026-11-13)', () => {
  const EMPTY_DIGEST = {
    customerName: null,
    authLevel: 'anonymous',
    facts: [],
    applications: [],
    declinedProducts: [],
    advisories: [],
    partner: null,
    eventsSinceLastSeen: [],
  } as never

  /** One scripted turn through the real loop, the tool results kept. */
  async function turn(toolUses: { name: string; input: unknown }[], reply: string) {
    const provider = fixtureProvider(
      fixtureTurnSchema.parse({ rounds: [{ deltas: [], toolUses }, { deltas: [reply] }] }),
    )
    const inner = createToolExecutor(toolContext({ market: () => Promise.resolve(MARKET) }))
    const results: string[] = []
    const executeTool: typeof inner = async (name, input) => {
      const outcome = await inner(name, input)
      results.push(outcome.result)
      return outcome
    }
    const events: StreamEvent[] = []
    for await (const event of runSaoirseTurn({
      provider,
      model: 'test-model',
      prompt: {
        domainConfig: demoDomainConfig,
        productCatalogue: knowledgeBaseSection(),
        sliders: slidersFor('default'),
        digest: EMPTY_DIGEST,
      },
      history: [{ role: 'user', content: 'x' }],
      executeTool,
      enabledTools: toolsForTurn('opening', false, true),
    })) {
      events.push(event)
    }
    return { results, events }
  }

  const recorded = (type: string) =>
    vi
      .mocked(writeEvent)
      .mock.calls.flatMap((call) => (call[1].type === type ? [{ payload: call[1].payload }] : []))
      .reverse()

  it('the card’s tool result carries each row’s must-knows; the digest keeps them for a product looked up by name', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${PRODUCTS_AS_OF}T12:00:00Z`))
    let shown
    try {
      shown = await turn(
        [{ name: 'show_products', input: { arrangement: 'by_access' } }],
        'Instant access on top, fixed terms under it.',
      )
    } finally {
      vi.useRealTimers()
    }
    const result = shown.results[0] ?? ''
    expect(result).toContain('mustKnow, the facts to know before choosing each')
    expect(result).toContain(
      '- bunq Savings Account: Rate ends 1 Jan, then 1.61% to €10,000 and 1.51% above; Deposit guarantee: Netherlands, not Ireland',
    )
    expect(result).toContain(
      '- Bank of Ireland Advantage Fixed Term Deposit Account: Money locked until May 2028; Monthly saving not accepted; lump sum only',
    )
    expect(adviceWordsIn(result)).toEqual([])

    // The customer asks about bunq by name: Saoirse looks it up.
    await turn(
      [{ name: 'lookup_products', input: { query: 'bunq savings account' } }],
      'bunq’s Savings Account pays 3.11% to 1 January.',
    )
    const lines = productsMustKnowLines(recorded('products_shown'), recorded('products_looked_up'))
    expect(lines).toEqual([
      'bunq Savings Account [bunq:savings.bunq_savings]: Rate ends 1 Jan, then 1.61% to €10,000 and 1.51% above; Deposit guarantee: Netherlands, not Ireland',
    ])

    // The next turn's prompt has the rule and the facts to state once, and nothing about the
    // products they have not named.
    const digest = buildCaseDigest(loadedCase(CASE, {}), {
      holdings: { lines: [], progress: null },
      productsShown: ['Instant access against fixed term (by_access), your last reply'],
      productsMustKnow: lines,
    })
    const prompt = composeSystemPrompt({
      domainConfig: demoDomainConfig,
      productCatalogue: knowledgeBaseSection(),
      sliders: slidersFor('default'),
      digest,
    })
    expect(prompt).toContain(
      'second time, or say they will go with it, state its must-knows once, unprompted, as facts',
    )
    expect(prompt).toContain(
      '- bunq Savings Account [bunq:savings.bunq_savings]: Rate ends 1 Jan, then 1.61% to €10,000 and 1.51% above; Deposit guarantee: Netherlands, not Ireland',
    )
    expect(prompt).not.toContain('Money locked until May 2028')
  })

  it('keeps the newest card’s facts, and only for ids looked up', () => {
    const card = (facts: string[]) => ({
      payload: {
        mustKnow: [
          { id: 'a', lead: 'A Saver', facts },
          { id: 'b', lead: 'B', facts },
        ],
      },
    })
    expect(
      productsMustKnowLines(
        [card(['Newest']), card(['Older']), { payload: null }],
        [{ payload: { ids: ['a', 'z'] } }, { payload: { query: 'x' } }],
      ),
    ).toEqual(['A Saver [a]: Newest'])
    expect(productsMustKnowLines([card(['Newest'])], [])).toEqual([])
  })
})
