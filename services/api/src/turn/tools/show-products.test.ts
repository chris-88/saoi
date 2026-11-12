import { beforeEach, describe, expect, it, vi } from 'vitest'
import { marketProductsCardSchema, type MarketProductsCard } from '@shared/contracts/cards.ts'
import { writeEvent } from '@shared/db/case-repository.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { productsCardText } from '@shared/domain/market/products-card.ts'
import { productsHoldings, productsPlan } from '@shared/domain/market/products-card.fixture.ts'
import { adviceWordsIn, MORTGAGE_WARNINGS } from '@shared/market/disclosures.ts'
import { CASE, toolContext } from './_testing.ts'
import { showProductsTool } from './show-products.ts'

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

beforeEach(() => {
  vi.mocked(writeEvent).mockClear()
  vi.mocked(loadHoldings).mockReset().mockResolvedValue(productsHoldings())
  vi.mocked(loadClaimedPlans)
    .mockReset()
    .mockResolvedValue([{ id: 'plan-1', plan: productsPlan() }])
})

function cardFrom(outcome: Awaited<ReturnType<typeof showProductsTool.run>>): MarketProductsCard {
  expect(outcome.refused).toBeUndefined()
  return marketProductsCardSchema.parse(outcome.card)
}

describe('show_products', () => {
  it.each([
    ['held_vs_market', 'Your account against the market'],
    ['by_access', 'Instant access against fixed term'],
    ['fits_date', 'Accounts that fit July 2028'],
    ['mortgage_by_sort', 'Mortgage options at 90% loan-to-value'],
  ] as const)('builds the %s card from the case and the market', async (arrangement, title) => {
    const outcome = await showProductsTool.run({ arrangement }, context())
    const card = cardFrom(outcome)
    expect(card.arrangement).toMatchObject({ kind: arrangement, title })
    expect(card.rows.length).toBeGreaterThan(0)
    expect(card.rows.length).toBeLessThanOrEqual(8)
    expect(adviceWordsIn(productsCardText(card))).toEqual([])
    // The result tells Saoirse to say one line and ask nothing; it carries no figure to restate.
    expect(outcome.result).toMatch(/ask nothing else/)
    expect(writeEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caseId: CASE,
        type: 'products_shown',
        actor: 'model',
        payload: expect.objectContaining({ arrangement }) as unknown,
      }),
    )
  })

  it('puts their own held account on top of held_vs_market, with its own rate', async () => {
    const card = cardFrom(await showProductsTool.run({ arrangement: 'held_vs_market' }, context()))
    expect(card.rows[0]).toMatchObject({ lead: 'Your BoI savings', value: '0.50%', held: true })
  })

  it('takes the mortgage figures from the plan, with the warnings', async () => {
    const card = cardFrom(
      await showProductsTool.run(
        { arrangement: 'mortgage_by_sort', sortBy: 'monthly_repayment' },
        context(),
      ),
    )
    expect(card.basis.figures).toContain('a €400,000 home, €360,000 borrowed (90% of the price)')
    expect(card.basis.figures).toContain('€110,000 a year before tax')
    expect(card.basis.warnings).toEqual([...MORTGAGE_WARNINGS])
    expect(card.arrangement.line).toMatch(/^Arranged by monthly repayment, lowest first\./)
  })

  it('returns the questions, and no card, when the case has no figures', async () => {
    vi.mocked(loadHoldings).mockResolvedValue([])
    vi.mocked(loadClaimedPlans).mockResolvedValue([])
    const outcome = await showProductsTool.run({ arrangement: 'held_vs_market' }, context())
    expect(outcome.card).toBeUndefined()
    expect(outcome.refused).toBeUndefined()
    expect(outcome.result).toMatch(/^No card: these figures are needed first\. Ask the first one/)
    expect(writeEvent).not.toHaveBeenCalled()
  })

  it('refuses when the market cannot be read', async () => {
    const outcome = await showProductsTool.run(
      { arrangement: 'by_access' },
      toolContext({ market: () => Promise.reject(new Error('down')) }),
    )
    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
  })
})
