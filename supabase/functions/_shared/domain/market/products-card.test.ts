import { describe, expect, it } from 'vitest'
import { marketProductsCardSchema, type MarketProductsCard } from '../../contracts/cards.ts'
import { adviceWordsIn, MORTGAGE_WARNINGS, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import {
  caseFigures,
  productsCard,
  productsCardText,
  type ProductsResult,
} from './products-card.ts'
import { PRODUCTS_AS_OF, productsHoldings, productsPlan } from './products-card.fixture.ts'

const MARKET = normaliseMarket(MARKET_FIXTURE)
const FIGURES = caseFigures({
  plan: productsPlan(),
  holdings: productsHoldings(),
  fact: () => undefined,
})

function cardOf(result: ProductsResult): MarketProductsCard {
  if (result.kind !== 'card') throw new Error(`expected a card, got ${JSON.stringify(result)}`)
  return marketProductsCardSchema.parse(result.card)
}

describe('caseFigures: the plan, the holdings and the facts', () => {
  it('reads the claimed plan and prefers holdings for what is held', () => {
    expect(FIGURES).toMatchObject({
      monthlySavingEur: 1_000,
      keysMonth: '2028-07',
      keysFrom: 'plan',
      priceEur: 400_000,
      incomeEur: 110_000,
      firstTimeBuyer: null,
      newBuild: false,
      currentBank: 'AIB',
      sortBy: 'five_year_cost',
    })
    expect(FIGURES.held.map((account) => [account.label, account.kind, account.ratePct])).toEqual([
      ['BoI savings', 'savings', 0.5],
      ['Current account', 'current', null],
    ])
  })

  it('falls back to facts when there is no plan or holding', () => {
    const facts: Record<string, unknown> = {
      'assets.savingsBalance': 12_000,
      'goals.monthlySaving': 400,
      'goals.targetDate': '2027-09',
      'housing.purchasePrice': 300_000,
    }
    const figures = caseFigures({ plan: null, holdings: [], fact: (key) => facts[key] })
    expect(figures).toMatchObject({
      monthlySavingEur: 400,
      keysMonth: '2027-09',
      keysFrom: 'date_given',
      priceEur: 300_000,
    })
    expect(figures.held).toHaveLength(1)
  })
})

describe('productsCard: arranged by the question asked', () => {
  it('held_vs_market: their account on top as the baseline, the market by rate under it', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
    )
    expect(card.arrangement.kind).toBe('held_vs_market')
    expect(card.arrangement.title).toBe('Your account against the market')
    expect(card.arrangement.line).toMatch(/Ask for them by access, or by the date, instead\./)
    expect(card.rows.length).toBeLessThanOrEqual(8)
    const [own, current, ...market] = card.rows
    expect(own).toMatchObject({ lead: 'Your BoI savings', value: '0.50%', held: true })
    expect(own?.figure).toMatch(/^€\d[\d,]* by Jul 2028$/)
    expect(current).toMatchObject({ lead: 'Your Current account', held: true })
    expect(market.every((row) => !row.held)).toBe(true)
    // By rate, highest first.
    const rates = market.map((row) => Number(row.value.replace('%', '')))
    expect(rates).toEqual([...rates].sort((a, b) => b - a))
    expect(card.more).toBeGreaterThan(0)
    expect(card.basis.figures.join(' ')).toMatch(
      /BoI savings \(Bank of Ireland\): €20,000 at 0\.50%/,
    )
    expect(card.basis.coverage).toMatch(/savings and deposit accounts on the Irish market/)
    expect(card.statement).toBe(RESULT_STATEMENT)
  })

  it('by_access: instant access beside fixed term, the price of access stated', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    expect(card.arrangement.title).toBe('Instant access against fixed term')
    const kinds = card.rows.map((row) => row.kind)
    expect(kinds).toContain('instant access')
    expect(kinds.some((kind) => /fixed$/.test(kind))).toBe(true)
    // Instant first, then fixed: the two sides are not interleaved.
    const firstFixed = kinds.findIndex((kind) => kind.endsWith('fixed'))
    expect(kinds.slice(firstFixed).every((kind) => kind.endsWith('fixed'))).toBe(true)
    expect(card.arrangement.line).toMatch(/price of access|access costs nothing here/)
  })

  it('fits_date: the six-month terms when the keys are more than six months away, bonus counted by the date', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    expect(card.question).toBe('Where can the deposit sit until the keys in July 2028?')
    expect(card.arrangement.title).toBe('Accounts that fit July 2028')
    const fixed = card.rows.filter((row) => row.kind.endsWith('fixed'))
    expect(fixed.length).toBeGreaterThan(0)
    expect(fixed.every((row) => row.kind === '6-month fixed')).toBe(true)
    expect(card.basis.objective).toMatch(/fixed terms are shown at six months/)
    expect(card.basis.assumptions.join(' ')).toMatch(/A bonus is counted in the total by the date/)
  })

  it('fits_date: within six months, the longest term that ends by the keys', () => {
    const near = { ...FIGURES, keysMonth: '2027-03' }
    const card = cardOf(productsCard(MARKET, near, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    for (const row of card.rows.filter((item) => item.kind.endsWith('fixed'))) {
      expect(Number(/^(\d+)-month/.exec(row.kind)?.[1] ?? 99)).toBeLessThanOrEqual(4)
    }
  })

  it('mortgage_by_sort: the lender options at their LTV, in the sort they chose, with the warnings', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'mortgage_by_sort' }, PRODUCTS_AS_OF),
    )
    expect(card.arrangement.title).toBe('Mortgage options at 90% loan-to-value')
    expect(card.arrangement.line).toMatch(
      /^Arranged by cost over the first 5 years, lowest first, the order you chose\./,
    )
    expect(card.rows.length).toBeGreaterThan(0)
    for (const row of card.rows) {
      expect(row.value).toMatch(/^€[\d,]+\/mo$/)
      expect(row.figure).toMatch(/over 5 years$/)
      expect(row.held).toBe(false)
    }
    const costs = card.rows.map((row) => Number(row.figure.replace(/[^\d]/g, '').slice(0, -1)))
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(card.basis.warnings).toEqual([...MORTGAGE_WARNINGS])
    expect(card.basis.figures[0]).toBe('a €400,000 home, €360,000 borrowed (90% of the price)')
  })

  it('mortgage_by_sort: another sort and the customer’s own filter', () => {
    const card = cardOf(
      productsCard(
        MARKET,
        FIGURES,
        {
          arrangement: 'mortgage_by_sort',
          sortBy: 'monthly_repayment',
          filters: { rateType: 'fixed' },
        },
        PRODUCTS_AS_OF,
      ),
    )
    const monthly = card.rows.map((row) => Number(row.value.replace(/[^\d]/g, '')))
    expect(monthly).toEqual([...monthly].sort((a, b) => a - b))
    expect(card.rows.every((row) => row.kind.includes('fixed'))).toBe(true)
    expect(card.basis.figures).toContain('Showing fixed rates only, as you asked.')
  })

  it('says nothing that advises, in any string it emits', () => {
    for (const arrangement of [
      'held_vs_market',
      'by_access',
      'fits_date',
      'mortgage_by_sort',
    ] as const) {
      const card = cardOf(productsCard(MARKET, FIGURES, { arrangement }, PRODUCTS_AS_OF))
      const text = productsCardText(card)
      expect(adviceWordsIn(text), arrangement).toEqual([])
      expect(text, arrangement).not.toMatch(/\b(best|should|recommended)\b/i)
    }
  })
})

describe('productsCard: no figures, no card', () => {
  it('returns the questions that would let it run', () => {
    const empty = caseFigures({ plan: null, holdings: [], fact: () => undefined })
    const result = productsCard(MARKET, empty, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF)
    expect(result.kind).toBe('questions')
    if (result.kind === 'questions') expect(result.questions.length).toBeGreaterThan(0)
  })

  it('asks for the price before a mortgage card, and the date before fits_date', () => {
    const noPrice = { ...FIGURES, priceEur: null }
    expect(
      productsCard(MARKET, noPrice, { arrangement: 'mortgage_by_sort' }, PRODUCTS_AS_OF),
    ).toEqual({ kind: 'questions', questions: ['What price of home are you looking at?'] })
    const noDate = { ...FIGURES, keysMonth: null }
    expect(productsCard(MARKET, noDate, { arrangement: 'fits_date' }, PRODUCTS_AS_OF).kind).toBe(
      'questions',
    )
  })
})
