import { beforeEach, describe, expect, it, vi } from 'vitest'
import { productComparisonCardSchema } from '@shared/contracts/cards.ts'
import { writeEvent } from '@shared/db/case-repository.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { comparisonCardText } from '@shared/domain/market/compare.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { productsHoldings, productsPlan } from '@shared/domain/market/products-card.fixture.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import { CASE, toolContext } from './_testing.ts'
import { compareProductsTool } from './compare-products.ts'

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
const context = () => toolContext({ market: () => Promise.resolve(MARKET) })
const IDS = ['bunq:savings.bunq_savings', 'boi:savings.supersaver']

beforeEach(() => {
  vi.mocked(writeEvent).mockClear()
  vi.mocked(loadHoldings).mockReset().mockResolvedValue(productsHoldings())
  vi.mocked(loadClaimedPlans)
    .mockReset()
    .mockResolvedValue([{ id: 'plan-1', plan: productsPlan() }])
})

describe('compare_products', () => {
  it('builds the comparison from the case and the market, and hands the model the question', async () => {
    const outcome = await compareProductsTool.run({ rowIds: IDS }, context())
    expect(outcome.refused).toBeUndefined()
    const card = productComparisonCardSchema.parse(outcome.card)
    expect(card.columns.map((column) => column.rowId)).toEqual(IDS)
    expect(adviceWordsIn(comparisonCardText(card))).toEqual([])

    // One line about the card, then the card's own question, and nothing else; the must-knows
    // are on the card and not repeated; the differences are there for "help me choose".
    expect(outcome.result).toContain(`"${card.decides}"`)
    expect(outcome.result).toMatch(/do not repeat them/)
    expect(outcome.result).toMatch(/never say which one to take/)
    for (const line of card.differences) expect(outcome.result).toContain(`- ${line}`)
    expect(outcome.result).toMatch(/- bunq Savings Account: €[\d,]+ by July 2028 counts 3\.11%/)
    expect(adviceWordsIn(outcome.result)).toEqual([])

    // Recorded for the next turn: ids and names, no figures.
    expect(writeEvent).toHaveBeenCalledWith(expect.anything(), {
      caseId: CASE,
      type: 'products_compared',
      actor: 'model',
      payload: {
        rowIds: IDS,
        leads: ['bunq Savings Account', 'Bank of Ireland SuperSaver Account'],
      },
    })
  })

  it('refuses an id the market does not hold, and writes nothing', async () => {
    const outcome = await compareProductsTool.run(
      { rowIds: ['bunq:savings.bunq_savings', 'nobody:x'] },
      context(),
    )
    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
    expect(outcome.result).toMatch(/^No comparison: nobody:x is not in the market Saoi holds\./)
    expect(writeEvent).not.toHaveBeenCalled()
  })

  it('refuses when the market cannot be read', async () => {
    const outcome = await compareProductsTool.run(
      { rowIds: IDS },
      toolContext({ market: () => Promise.reject(new Error('down')) }),
    )
    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
  })
})
