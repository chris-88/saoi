import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadedCase } from '../testing.actions.ts'
import { recordFacts, writeEvent } from '@shared/db/case-repository.ts'
import { createToolExecutor, type ToolContext } from './tools.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordFacts: vi.fn(),
  writeEvent: vi.fn(() => Promise.resolve()),
  // The case as reloaded after a fact: nothing to recompute here.
  loadCase: vi.fn(() => Promise.resolve(null)),
}))

const CASE = '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11'

function context(over: Partial<ToolContext> = {}): ToolContext {
  return {
    // The Supabase client is never reached by these paths: the shared writers are mocked and
    // everything else under test reads the loaded case.
    admin: {} as never,
    turn: { caseId: CASE, trigger: 'message' },
    loaded: loadedCase(CASE),
    primary: 'participant-primary',
    gate: {
      allowed: true,
      category: 'banking',
      clarifyInScope: false,
      suppressHumour: false,
      suppressProductOffers: false,
      profanity: false,
      injectionFlagged: false,
    },
    goals: { candidates: [], lines: [] },
    goalContext: null,
    kb: { products: [] } as never,
    rateTable: [] as never,
    savingsOptions: [],
    nameFor: () => 'Savings account',
    digest: {} as never,
    currentAccountPick: null,
    needContext: [] as never,
    customerMessage: '',
    market: () => Promise.resolve({ products: [], recordsOf: new Map(), viewOfRow: new Map() }),
    rejections: [],
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(recordFacts).mockReset()
  vi.mocked(writeEvent).mockClear()
})

describe('record_facts', () => {
  it('writes an event per accepted fact and reports the ones the catalogue refused', async () => {
    vi.mocked(recordFacts).mockResolvedValue({
      accepted: ['household.buyingWith'],
      rejected: [{ key: 'health.condition', reason: 'not extractable' }],
    } as never)
    const ctx = context()

    const outcome = await createToolExecutor(ctx)('record_facts', {
      facts: [
        { key: 'household.buyingWith', value: 'partner' },
        { key: 'health.condition', value: 'x' },
      ],
    })

    expect(recordFacts).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({ caseId: CASE, source: 'customer_stated' }),
    )
    expect(writeEvent).toHaveBeenCalledTimes(1)
    expect(writeEvent).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({
        type: 'context_captured',
        actor: 'model',
        payload: { key: 'household.buyingWith' },
      }),
    )
    expect(outcome.result).toBe('Recorded 1. Not recorded — health.condition: not extractable')
    // A partial rejection keeps the round's words: it is not a refusal.
    expect(outcome.refused).toBeUndefined()
    // Recorded as a rejection so the turn can explain itself afterwards.
    expect(ctx.rejections).toEqual([
      { name: 'record_facts', error: 'health.condition: not extractable' },
    ])
  })

  it('records nothing and writes nothing when every fact bounces', async () => {
    vi.mocked(recordFacts).mockResolvedValue({
      accepted: [],
      rejected: [{ key: 'a.b', reason: 'unknown key' }],
    })

    const outcome = await createToolExecutor(context())('record_facts', {
      facts: [{ key: 'a.b', value: 1 }],
    })

    expect(writeEvent).not.toHaveBeenCalled()
    expect(outcome.result).toBe('Recorded 0. Not recorded — a.b: unknown key')
  })
})

describe('show_product_options', () => {
  it('is refused as too early while Saoirse does not yet understand the customer’s position', async () => {
    const outcome = await createToolExecutor(context())('show_product_options', {
      products: [{ product: 'mortgage', reason: 'You want to buy.' }],
    })

    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
    expect(outcome.result).toMatch(/^Too early/)
  })
})

describe('an unknown tool', () => {
  it('is answered, not thrown', async () => {
    const outcome = await createToolExecutor(context())('not_a_tool' as never, {})
    expect(outcome.result).toBe('That is not available yet.')
  })
})
