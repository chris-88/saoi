import { describe, expect, it } from 'vitest'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { MarketInputError, berMatches, search } from './search.ts'

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-09'

describe('search: deposits', () => {
  it('ranks a lump sum by interest after DIRT that can be known over the horizon', () => {
    const result = search(market, { category: 'deposit', amount: 25_000, horizonMonths: 24 }, AS_OF)
    expect(result.ranking.objective).toBe('highest_net_return')
    expect(result.ranking.basis).toMatch(/after DIRT .* 24 months on a €25,000 lump sum/)
    expect(result.results).toHaveLength(5)
    const nets = result.results.map((r) =>
      r.figures.kind === 'savings' ? r.figures.netInterest : 0,
    )
    expect([...nets].sort((a, b) => b - a)).toEqual(nets)
    // Nordax's 24-month term at 3.45% is known for the whole horizon and leads.
    expect(result.results[0]?.product.id).toBe('nordax:deposit.c7830')
    expect(result.results[0]?.flags.join(' ')).toMatch(/Raisin/)
    expect(result.results[0]?.flags.join(' ')).toMatch(/Swedish Deposit Guarantee Scheme/)
    // A 3-month introductory rate with nothing stated after it does not outrank rates that hold.
    const raisin = result.results.find((r) => r.product.id === 'raisin_bank:deposit.c8504')
    expect(raisin).toBeUndefined()
    // The 60-month term outlives the horizon and is left out, counted.
    expect(result.excluded.some((e) => /ends after the 24-month horizon/.test(e.reason))).toBe(true)
    expect(result.attributions[0]).toMatch(/CCPC|Competition/)
  })

  it('takes `limit` and an objective', () => {
    const result = search(
      market,
      { category: 'deposit', amount: 10_000, objective: 'easiest_access', limit: 8 },
      AS_OF,
    )
    expect(result.results).toHaveLength(8)
    const access = result.results.map((r) =>
      r.product.terms.kind === 'deposit' ? r.product.terms.access : '',
    )
    expect(access[0]).toBe('instant')
    const order = { instant: 0, notice: 1, fixed_term: 2 } as Record<string, number>
    const ranks = access.map((kind) => order[kind] ?? 9)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })

  it('leaves platform products out on request', () => {
    const result = search(
      market,
      { category: 'deposit', amount: 25_000, horizonMonths: 24, includePlatforms: false },
      AS_OF,
    )
    expect(result.results.every((r) => r.product.platform === null)).toBe(true)
  })

  it('refuses an objective that does not apply', () => {
    expect(() =>
      search(market, { category: 'deposit', objective: 'lowest_monthly_repayment' }, AS_OF),
    ).toThrow(MarketInputError)
  })
})

describe('search: regular savers', () => {
  it('ranks monthly saving within each product’s cap, never counting a bonus', () => {
    const result = search(
      market,
      { category: 'savings', monthlyAmount: 800, horizonMonths: 24 },
      AS_OF,
    )
    expect(result.results[0]?.figures.kind).toBe('savings')
    const mortgageSaver = result.results.find((r) => r.product.id === 'boi:savings.mortgagesaver')
    if (mortgageSaver !== undefined) {
      expect(mortgageSaver.flags.join(' ')).toMatch(/bonus, not counted/)
    }
    // ChildSave is not an adult's saving account.
    expect(result.results.some((r) => /ChildSave/.test(r.product.name))).toBe(false)
    expect(result.assumptions.join(' ')).toMatch(/DIRT at 33%/)
  })
})

describe('search: mortgages', () => {
  it('filters by buyer type and LTV, and ranks by total cost after cashback', () => {
    const result = search(
      market,
      {
        category: 'mortgage',
        buyerType: 'first_time_buyer',
        loanAmount: 315_000,
        propertyValue: 350_000,
      },
      AS_OF,
    )
    expect(result.results.length).toBeGreaterThan(0)
    for (const r of result.results) {
      if (r.product.terms.kind !== 'mortgage') throw new Error('not a mortgage')
      expect(r.product.terms.buyerTypes).toContain('first_time_buyer')
      expect(r.product.terms.ltvMaxPct ?? 100).toBeGreaterThanOrEqual(90)
      expect(r.product.terms.ber).toBeNull()
      if (r.figures.kind !== 'mortgage') throw new Error('figures')
      expect(r.figures.ltvPct).toBe(90)
      expect(r.figures.monthlyRepayment).toBeGreaterThan(1_000)
    }
    expect(result.excluded.some((e) => /BER/.test(e.reason))).toBe(true)
  })

  it('includes BER rates when the BER is given', () => {
    const result = search(
      market,
      {
        category: 'mortgage',
        buyerType: 'first_time_buyer',
        loanAmount: 300_000,
        propertyValue: 400_000,
        ber: 'B2',
        limit: 25,
      },
      AS_OF,
    )
    expect(
      result.results.some(
        (r) => r.product.terms.kind === 'mortgage' && r.product.terms.ber === 'B',
      ),
    ).toBe(true)
  })

  it('matches BER bands', () => {
    expect(berMatches('B', 'B2')).toBe(true)
    expect(berMatches('B', 'C1')).toBe(false)
    expect(berMatches(null, 'G')).toBe(true)
    expect(berMatches('Exempt', 'exempt')).toBe(true)
  })
})

describe('search: loans, cards, accounts', () => {
  it('works out a loan’s repayment and total interest from its APR', () => {
    const result = search(
      market,
      { category: 'loan', amount: 10_000, termMonths: 60, purpose: 'car' },
      AS_OF,
    )
    const first = result.results[0]
    if (first?.figures.kind !== 'loan') throw new Error('no loan')
    expect(first.figures.totalInterest).toBeGreaterThan(0)
    expect(first.figures.totalRepaid).toBeCloseTo(first.figures.monthlyRepayment * 60, 0)
    const totals = result.results.map((r) =>
      r.figures.kind === 'loan' ? r.figures.totalInterest : 0,
    )
    expect([...totals].sort((a, b) => a - b)).toEqual(totals)
  })

  it('costs a card balance and ranks accounts by fee', () => {
    const cards = search(market, { category: 'credit_card', amount: 3_000 }, AS_OF)
    expect(cards.results[0]?.figures.kind).toBe('credit_card')
    const accounts = search(market, { category: 'current_account' }, AS_OF)
    const first = accounts.results[0]
    expect(first?.figures.kind === 'current_account' && first.figures.annualFeeEur).toBe(0)
  })
})
