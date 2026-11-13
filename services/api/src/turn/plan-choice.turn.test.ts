import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withdraw, type StreamEvent } from '@shared/contracts/stream.ts'
import { buildPlanRequestSchema } from '@shared/contracts/market-tools.ts'
import type { MarketPlan } from '@shared/contracts/market-plan.ts'
import { saveMessage } from '@shared/db/case-repository.ts'
import { savedPlanDigestLines } from '@shared/db/saved-plans.ts'
import { nextOpenSlot, slotQuestion } from '@shared/domain/market/choices.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { buildPlan } from '@shared/domain/market/plan.ts'
import { describeEvent } from '@shared/domain/narration.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import type { ModelProvider, ModelRequest } from '@shared/llm/model.ts'
import { marketCatalogueSection } from '@shared/llm/market-prompt.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import type { ToolExecutor } from '@shared/llm/saoirse.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import { returnInstruction, returnsAfterPlanEdit, type Generation } from './context.ts'
import { createMeter, generate, type ModelHandle } from './generate.ts'
import { persistReply } from './persist.ts'
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
 * The turn after a product is chosen on a card (Chris, 2026-11-13: "the goal is to get the
 * customer to pick products from the product lists we're presenting"). The customer tapped; the
 * route committed the choice and wrote `product_chosen` with the next open part's question. The
 * return turn says the choice in a line, as a fact, then that question, and picks nothing: it is
 * text only, so no card and no tool, and the digest carries the choices and the rule.
 */

const market = normaliseMarket(MARKET_FIXTURE)
const BUNQ = 'bunq:savings.bunq_savings'

const BASE: MarketPlan = buildPlan(
  market,
  buildPlanRequestSchema.parse({
    situation: {
      income: { annualGross: 110_000 },
      monthlySaving: 1_500,
      savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
      firstTimeBuyer: true,
    },
    goals: [{ id: 'home', kind: 'house_deposit', label: 'Buying a home', targetDate: '2028-06' }],
    homePrice: 400_000,
    propertyKind: 'new_build',
    buyingTogether: true,
    homePreferences: { sortBy: 'monthly_repayment' },
  }),
  '2026-11-12',
  '2026-11-12T09:00:00.000Z',
).plan
const PLAN: MarketPlan = {
  ...BASE,
  choices: {
    lump_sum: {
      slot: 'lump_sum',
      rowId: BUNQ,
      lead: 'bunq Savings Account',
      providerId: 'bunq',
      kind: 'instant access',
      value: '3.11% to 1 Jan',
      figure: 'keys Sep 2027, €409',
      chosenAt: '2026-11-13T10:00:00.000Z',
      endsOn: '2027-01-01',
    },
  },
}
const NEXT = slotQuestion('monthly_saving', PLAN)

/** As the choice route writes it. */
const chosenEvent = {
  type: 'product_chosen',
  payload: {
    planId: 'plan-1',
    slot: 'lump_sum',
    rowId: BUNQ,
    lead: 'bunq Savings Account',
    next: { slot: nextOpenSlot(PLAN), question: NEXT },
  },
}

beforeEach(() => {
  vi.mocked(saveMessage).mockClear()
})

const generationFor = (events: (typeof chosenEvent)[], trigger = 'return'): Generation =>
  ({
    stage: 'planning',
    hasFigures: true,
    afterPlanEdit: returnsAfterPlanEdit(trigger, events),
    digest: {
      customerName: null,
      authLevel: 'anonymous',
      facts: [],
      applications: [],
      declinedProducts: [],
      advisories: [],
      partner: null,
      eventsSinceLastSeen: events
        .map(describeEvent)
        .filter((line): line is string => line !== null),
      broughtPlans: [
        { title: PLAN.title, lines: savedPlanDigestLines({ id: 'plan-1', plan: PLAN }) },
      ],
    },
    history: [{ role: 'user', content: returnInstruction(events, { market: true }) }],
  }) as unknown as Generation

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

async function run(provider: ModelProvider, generation: Generation) {
  const executeTool = vi.fn<ToolExecutor>(() =>
    Promise.reject(new Error('no tool runs on the return turn after a choice')),
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
    generation,
    gate: { allowed: true, suppressHumour: false, clarifyInScope: false } as never,
    loaded: { persona: slidersFor('default') } as never,
    kb: { products: undefined } as never,
    rateTable: undefined as never,
    executeTool,
    maxTokens: 1_000,
    meter: createMeter(Date.now()),
    rejections,
    called,
    marketCatalogue: marketCatalogueSection(null),
  })) {
    events.push(event)
  }
  const cards = events.flatMap((event) => (event.type === 'card' ? [event.card] : []))
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
  return { executeTool, cards, text, rejections }
}

const systemOf = (request: ModelRequest | undefined): string =>
  (request?.system ?? []).map((block) => block.text).join('\n')
const lastUser = (request: ModelRequest | undefined): string => {
  const content = request?.messages.at(-1)?.content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

describe('the return turn after a product is chosen on a card', () => {
  it('is text only, like the return after any change to the plan', () => {
    expect(returnsAfterPlanEdit('return', [chosenEvent])).toBe(true)
    expect(
      returnsAfterPlanEdit('return', [{ ...chosenEvent, type: 'product_choice_removed' }]),
    ).toBe(true)
    expect(returnsAfterPlanEdit('message', [chosenEvent])).toBe(false)
  })

  it('tells the model the choice as a fact and hands it the next open part’s question', () => {
    const instruction = returnInstruction([chosenEvent], { market: true })
    expect(instruction).toContain('"You chose bunq Savings Account for the lump sum."')
    expect(instruction).toContain(`nothing else: "${NEXT}"`)
    expect(NEXT).toBe('Which account is the one for your €1,500 a month?')
    expect(instruction).toContain('never pick anything for them')
    expect(instruction).toContain('text only')
  })

  it('names the next open part’s question, makes no pick and shows no card', async () => {
    const reply = `The €32,000 is down for the bunq Savings Account. ${NEXT}`
    const { provider, requests } = recorded([{ deltas: [reply] }])
    const result = await run(provider, generationFor([chosenEvent]))

    expect(requests).toHaveLength(1)
    expect(requests[0]?.tool_choice).toEqual({ type: 'none' })
    // The digest carries the choices and the next part; the rule is in the market section.
    const system = systemOf(requests[0])
    expect(system).toContain(
      'Choices, theirs, made on the cards (never made for them): lump sum: bunq Savings Account (keys Sep 2027, €409); monthly saving: open; mortgage: open.',
    )
    expect(system).toContain(`Its deciding question, in their figures: "${NEXT}"`)
    expect(system).toContain('A choice is only ever made by them, from a card')
    expect(system).toContain('You chose bunq Savings Account for the lump sum.')
    expect(lastUser(requests[0])).toContain(NEXT)

    expect(result.text).toBe(reply)
    expect(result.text.endsWith(NEXT)).toBe(true)
    expect(adviceWordsIn(result.text)).toEqual([])
    expect(result.executeTool).not.toHaveBeenCalled()
    expect(result.cards).toEqual([])
    expect(saveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ caseId: CASE, role: 'assistant', cards: [], content: reply }),
    )
  })

  it('runs no tool even when the model reaches for show_products', async () => {
    const { provider } = recorded([
      {
        deltas: ['Here are accounts for the monthly saving.'],
        toolUses: [
          { name: 'show_products', input: { arrangement: 'by_access', focus: 'monthly' } },
        ],
      },
      { deltas: [`The €32,000 is down for the bunq Savings Account. ${NEXT}`] },
    ])
    const result = await run(provider, generationFor([chosenEvent]))
    expect(result.executeTool).not.toHaveBeenCalled()
    expect(result.cards).toEqual([])
    expect(result.rejections.map((rejection) => rejection.name)).toEqual(['show_products'])
    expect(result.text).toBe(`The €32,000 is down for the bunq Savings Account. ${NEXT}`)
  })

  it('says once what the plan now does after the last part, and asks nothing', () => {
    const line =
      'Every part of the plan is chosen: bunq Savings Account for the lump sum. The plan now follows them.'
    const instruction = returnInstruction(
      [{ ...chosenEvent, payload: { ...chosenEvent.payload, next: null, allChosenLine: line } }],
      { market: true },
    )
    expect(instruction).toContain(`what the plan now does: "${line}" Ask nothing after it.`)
    expect(instruction).not.toContain('Which account')
  })

  it('opens the part again after a removal, with its question', () => {
    const removed = {
      type: 'product_choice_removed',
      payload: {
        slot: 'lump_sum',
        rowId: BUNQ,
        lead: 'bunq Savings Account',
        next: { slot: 'lump_sum', question: 'Which account is the one for your €32,000?' },
      },
    }
    const instruction = returnInstruction([removed], { market: true })
    expect(instruction).toContain(
      '"You took bunq Savings Account off the plan as the choice for the lump sum; it is open again."',
    )
    expect(instruction).toContain('"Which account is the one for your €32,000?"')
  })
})
