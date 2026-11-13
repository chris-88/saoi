import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@shared/contracts/stream.ts'
import { loadCase } from '@shared/db/case-repository.ts'
import { buildCaseDigest } from '@shared/db/digest.ts'
import { fixtureProvider, fixtureTurnSchema } from '@shared/llm/fixture-provider.ts'
import { MARKET_SIGNED_IN_LINE } from '@shared/llm/market-prompt.ts'
import { SIGNED_IN_ACTION } from '@shared/llm/sign-in-prompt.ts'
import type { ModelProvider } from '@shared/llm/model.ts'
import { loadedCase, MESSAGE_ID } from '../testing.actions.ts'
import { buildGeneration, loadTurnContext, type Generation } from './context.ts'
import type { ModelFactory } from './generate.ts'
import { admit } from './gate.ts'
import { caseHasEvent, holdsMarketFigures, signInAlreadyAnswered } from './lookups.ts'
import { persistReply, recordCustomerTurn } from './persist.ts'
import { createTurnRunner } from './turn.ts'

vi.mock('./context.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTurnContext: vi.fn(),
  buildGeneration: vi.fn(),
}))
vi.mock('./gate.ts', () => ({ admit: vi.fn() }))
vi.mock('./persist.ts', () => ({
  recordCustomerTurn: vi.fn(),
  persistReply: vi.fn(),
  persistBlocked: vi.fn(),
}))
vi.mock('./lookups.ts', () => ({
  caseHasEvent: vi.fn(),
  holdsMarketFigures: vi.fn(),
  signInAlreadyAnswered: vi.fn(),
}))
vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadCase: vi.fn(),
  writeEvent: vi.fn(() => Promise.resolve()),
}))
vi.mock('@shared/db/alerts.ts', () => ({ markAlertsSeen: vi.fn(() => Promise.resolve()) }))

const CASE_ID = '11111111-1111-4111-8111-111111111111'
const EARLIER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/** A model that must not be reached, or one that says one line. */
function models(provider: ModelProvider): { factory: ModelFactory; streamed: () => number } {
  let calls = 0
  return {
    streamed: () => calls,
    factory: () => ({
      provider: {
        stream(request) {
          calls += 1
          return provider.stream(request)
        },
      },
      model: 'test-model',
      classify: () => Promise.reject(new Error('not gated here')),
    }),
  }
}

const saysOneLine = (text: string): ModelProvider =>
  fixtureProvider(fixtureTurnSchema.parse({ rounds: [{ deltas: [text] }] }))

function generation(hasFigures: boolean): Generation {
  const loaded = loadedCase(CASE_ID, { authLevel: 'authenticated' })
  return {
    alertIds: [],
    primary: null,
    signInForPlan: false,
    hasFigures,
    afterPlanEdit: false,
    goals: { candidates: [], lines: [] },
    goalContext: null,
    digest: buildCaseDigest(loaded, {}),
    stage: 'choosing',
    arrangement: null,
    currentAccountPick: null,
    needContext: null,
    history: [{ role: 'user', content: '(The customer did this in the app: Signed in.)' }],
  } as unknown as Generation
}

async function signIn(factory: ModelFactory): Promise<StreamEvent[]> {
  const runner = createTurnRunner({
    db: {} as never,
    models: factory,
    appBaseUrl: 'https://app.saoi.ie/',
    market: () => Promise.reject(new Error('not read here')),
  })
  const stream = await runner({
    caseId: CASE_ID,
    participantId: 'participant-1',
    body: { caseId: CASE_ID, trigger: 'action', message: SIGNED_IN_ACTION } as never,
  })
  const events: StreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

beforeEach(() => {
  vi.clearAllMocks()
  const loaded = loadedCase(CASE_ID, { authLevel: 'authenticated' })
  vi.mocked(loadTurnContext).mockResolvedValue({
    loaded,
    kb: { products: [] },
    rateTable: [],
    savingsOptions: [],
    nameFor: () => 'Account',
    tone: 'neutral',
  } as never)
  vi.mocked(admit).mockResolvedValue({
    allowed: true,
    category: 'banking',
    suppressHumour: false,
    clarifyInScope: false,
  } as never)
  vi.mocked(recordCustomerTurn).mockResolvedValue({
    pendingNotice: undefined,
    pendingReuse: undefined,
    pendingWelcome: undefined,
    pendingPlan: undefined,
  })
  vi.mocked(persistReply).mockResolvedValue(MESSAGE_ID)
  vi.mocked(caseHasEvent).mockResolvedValue(true)
  vi.mocked(holdsMarketFigures).mockResolvedValue(true)
  vi.mocked(loadCase).mockResolvedValue(loaded)
})

describe('a sign-in, answered once (2026-11-13)', () => {
  it('answers the first in a market conversation with one line, no question, no model', async () => {
    vi.mocked(signInAlreadyAnswered).mockResolvedValue(null)
    vi.mocked(buildGeneration).mockResolvedValue(generation(true))
    const { factory, streamed } = models(
      saysOneLine('You’re signed in, Chris. A plan or the accounts?'),
    )

    const events = await signIn(factory)

    expect(streamed()).toBe(0)
    const text = events.flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
    expect(text).toEqual([MARKET_SIGNED_IN_LINE])
    expect(MARKET_SIGNED_IN_LINE).not.toContain('?')
    expect(events.some((event) => event.type === 'card')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'done', messageId: MESSAGE_ID, gateCategory: 'banking' })
    // The "Signed in." note and the reply are written once each.
    expect(recordCustomerTurn).toHaveBeenCalledOnce()
    expect(vi.mocked(persistReply).mock.calls[0]?.[1].text).toBe(MARKET_SIGNED_IN_LINE)
  })

  it('writes nothing and says nothing for a later sign-in on the same case', async () => {
    vi.mocked(signInAlreadyAnswered).mockResolvedValue(EARLIER)
    const { factory, streamed } = models(saysOneLine('You’re signed in.'))

    const events = await signIn(factory)

    expect(events).toEqual([{ type: 'done', messageId: EARLIER, gateCategory: 'banking' }])
    expect(streamed()).toBe(0)
    expect(loadTurnContext).not.toHaveBeenCalled()
    expect(recordCustomerTurn).not.toHaveBeenCalled()
    expect(persistReply).not.toHaveBeenCalled()
  })

  it('leaves a Demo Bank sign-in to the model, as it was', async () => {
    vi.mocked(signInAlreadyAnswered).mockResolvedValue(null)
    vi.mocked(buildGeneration).mockResolvedValue(generation(false))
    const LINE = 'Signed in. What is your date of birth?'
    const { factory, streamed } = models(saysOneLine(LINE))

    const events = await signIn(factory)

    expect(streamed()).toBe(1)
    const text = events.flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
    expect(text.join('')).toBe(LINE)
  })
})
