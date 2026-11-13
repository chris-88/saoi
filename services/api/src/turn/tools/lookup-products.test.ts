import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeEvent } from '@shared/db/case-repository.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { LOOKUP_ANSWER_RULE, LOOKUP_MISS_RULE } from '@shared/domain/market/lookup.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import { validateToolCall } from '@shared/llm/tools.ts'
import { CASE, toolContext } from './_testing.ts'
import { lookupProductsTool } from './lookup-products.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
}))

const MARKET = normaliseMarket(MARKET_FIXTURE)
const context = () => toolContext({ market: () => Promise.resolve(MARKET) })

beforeEach(() => {
  vi.mocked(writeEvent).mockClear()
})

const looked = () =>
  vi
    .mocked(writeEvent)
    .mock.calls.flatMap((call) => (call[1].type === 'products_looked_up' ? [call[1]] : []))

describe('lookup_products', () => {
  it('answers a provider query with every product of that provider, as facts', async () => {
    const outcome = await lookupProductsTool.run({ query: 'MoCo' }, context())
    expect(outcome.card).toBeUndefined()
    expect(outcome.refused).toBeUndefined()
    expect(outcome.result).toContain('MoCo, MoCo EasySaver')
    expect(outcome.result).toContain('Rate: 2.10% AER variable.')
    expect(outcome.result).toContain(LOOKUP_ANSWER_RULE)
    expect(adviceWordsIn(outcome.result)).toEqual([])
  })

  it('answers a product query with its rate, period, source and day checked', async () => {
    const outcome = await lookupProductsTool.run(
      { query: 'AIB 24 month fixed', category: 'deposit' },
      context(),
    )
    expect(outcome.result).toContain('AIB, Personal Fixed Term Deposit')
    expect(outcome.result).toContain('Rate: 2.26% AER for 2 years, fixed for the term')
    expect(outcome.result).toMatch(/Source: CCPC .*checked 9 Nov(ember)? 2026\./)
    expect(looked()).toEqual([
      expect.objectContaining({
        caseId: CASE,
        actor: 'model',
        payload: {
          query: 'AIB 24 month fixed',
          category: 'deposit',
          ids: ['aib:deposit.ladder_personal_fixed_term_deposit'],
          names: ['AIB Personal Fixed Term Deposit'],
          more: 0,
        },
      }),
    ])
    // The ids and the query, never a figure.
    expect(JSON.stringify(looked()[0]?.payload)).not.toMatch(/\d\.\d\d/)
  })

  it('says a miss is a miss, and records it', async () => {
    const outcome = await lookupProductsTool.run({ query: 'Revolut savings' }, context())
    expect(outcome.result).toContain(LOOKUP_MISS_RULE)
    expect(looked()[0]?.payload).toMatchObject({ query: 'Revolut savings', ids: [] })
  })

  it('never says a product is not held when the market cannot be read', async () => {
    const outcome = await lookupProductsTool.run(
      { query: 'AIB' },
      toolContext({ market: () => Promise.reject(new Error('down')) }),
    )
    expect(outcome.result).toMatch(/could not be read/)
    expect(outcome.result).toMatch(/do not say the product is not held/)
    expect(looked()).toEqual([])
  })

  it('takes a query and a category, and refuses a limit past eight', () => {
    expect(validateToolCall('lookup_products', { query: 'BOI 18m fixed' }).ok).toBe(true)
    expect(validateToolCall('lookup_products', { query: 'x' }).ok).toBe(false)
    expect(validateToolCall('lookup_products', { query: 'AIB', limit: 9 }).ok).toBe(false)
    expect(validateToolCall('lookup_products', { query: 'AIB', category: 'bonds' }).ok).toBe(false)
  })
})
