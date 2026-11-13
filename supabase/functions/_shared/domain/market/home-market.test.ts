import { describe, expect, it } from 'vitest'
import {
  homeCalculatorRequestSchema,
  homeCalculatorResponseSchema,
} from '../../contracts/market-tools.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { allocatable } from './allocate.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { homeCalculator } from './home-calculator.ts'
import { monthName } from './home-arithmetic.ts'
import { homeMarketSummary } from './home-market.ts'
import { normaliseMarket } from './normalise.ts'
import { homePathways } from './pathways.ts'
import { bestRung, monthsUntil, placement, simulateDeposit } from './simulate.ts'

const AS_OF = '2026-11-10'
const MARKET = normaliseMarket(MARKET_FIXTURE)

/** The €400k example: two incomes, €30,000 saved, €1,000 a month, keys by June 2028. */
const REQUEST = homeCalculatorRequestSchema.parse({
  depositSavedEur: 30_000,
  monthlySavingEur: 1_000,
  annualGrossIncomeEur: 60_000,
  secondIncomeEur: 40_000,
  targetPriceEur: 400_000,
  targetDate: '2028-06',
  propertyKind: 'second_hand',
  firstTimeBuyer: true,
})

describe('the home calculator with the market beside it', () => {
  const result = homeCalculator(REQUEST, AS_OF, MARKET)

  it('states the most the limits allow and the term', () => {
    expect(() => homeCalculatorResponseSchema.parse(result)).not.toThrow()
    // €400,000 at 90%: €444,444, floored to €444,000; the loan there is €399,600.
    expect(result.figures.maxPriceEur).toBe(444_000)
    expect(result.figures.termYears).toBe(30)
    expect(result.lines).toContain(
      'Within the Central Bank limits, up to €444,000 with a €44,400 deposit over 30 years; lenders decide.',
    )
  })

  it('gives the top savings rate for money reachable by the keys month, and its interest after DIRT', () => {
    const savings = result.market?.savings
    expect(savings).not.toBeNull()
    if (savings === null || savings === undefined) return
    // €47,000 needed at the keys from €30,000 at €1,000 a month: April 2028, before the date given.
    expect(result.figures.depositReachedOn).toBe('2028-04')
    const horizon = monthsUntil(AS_OF, '2028-04')
    // The highest rate among the accounts the plan engine allows that take this saving whole.
    const rates = allocatable(MARKET.products, { horizonMonths: horizon, lockAllowed: true })
      .flatMap((product) => {
        const terms = product.terms
        if (terms.kind !== 'deposit') return []
        const placed = placement(terms, 30_000, 1_000)
        if (placed.lump < 30_000 && placed.monthly < 1_000) return []
        const rate =
          terms.access === 'fixed_term'
            ? (bestRung(terms.ladder, horizon)?.aerPct ?? null)
            : (terms.aerPct ?? Math.max(...terms.bands.map((band) => band.aerPct)))
        return rate === null ? [] : [{ product, rate }]
      })
      .sort((a, b) => b.rate - a.rate)
    const top = rates[0]
    expect(top).toBeDefined()
    if (top === undefined || top.product.terms.kind !== 'deposit') return
    expect(savings.topRatePct).toBe(top.rate)
    expect(savings.topRateProvider).toBe(top.product.providerName)
    expect(savings.by).toBe('2028-04')
    expect(savings.runsTo).toBe('keys_month')
    expect(savings.accounts).toBeGreaterThan(1)
    expect(savings.accounts).toBeLessThanOrEqual(rates.length)

    const projected = simulateDeposit(top.product.terms, {
      lumpSum: 30_000,
      monthly: 1_000,
      horizonMonths: horizon,
      asOf: AS_OF,
    }).figures
    expect(savings.interestToTargetEur).toBeGreaterThan(0)
    expect(savings.interestToTargetEur).toBeCloseTo(projected.netInterest, 2)
    expect(savings.interestToTargetEur).toBeLessThan(projected.grossInterest)
    expect(savings.basis).toMatch(/after DIRT; no product is picked/)
  })

  it('counts every mortgage option for the loan, with the monthly range', () => {
    const mortgage = result.market?.mortgage
    expect(mortgage).not.toBeNull()
    if (mortgage === null || mortgage === undefined) return
    const home = homePathways({
      market: MARKET,
      firstTimeBuyer: true,
      firstTimeBuyerStated: true,
      newBuild: false,
      annualGrossIncome: 100_000,
      homePrice: 400_000,
      taxPaid: undefined,
      savedByGoal: 47_000,
      goalDate: '2028-06',
      reachedOn: () => '2028-04',
      monthlySaving: 1_000,
      monthName,
      savers: [],
    })
    expect(home).not.toBeNull()
    expect(mortgage.loanEur).toBe(360_000)
    expect(mortgage.termYears).toBe(30)
    expect(mortgage.options).toBe(home?.pathways.length)
    expect(mortgage.options).toBeGreaterThan(1)
    expect(mortgage.lowestMonthlyEur).toBeLessThanOrEqual(mortgage.highestMonthlyEur)
    expect(mortgage.lowestRatePct).toBe(
      Math.min(...(home?.pathways ?? []).map((pathway) => pathway.mortgage.ratePct)),
    )
    expect(mortgage.basis).toMatch(/no lender is picked/)
  })

  it('adds the two summaries after the existing lines, as facts', () => {
    const [savingsLine, mortgageLine] = result.market?.lines ?? []
    expect(savingsLine).toMatch(
      /^Savings: the top rate on the market is \d+\.\d{2}% \(.+\), about €[\d,]+ interest after DIRT by April 2028 in that account; \d+ accounts fit\./,
    )
    // bunq's 3.11% as CCPC states it (2026-11-13): for new customers, no end stated, so the line
    // says how long it holds is not stated (it named the bonus end from bunq's own page before).
    expect(savingsLine).toMatch(
      / 3\.11% is a rate for new accounts; how long it holds is not stated, and the interest figure counts it throughout\.$/,
    )
    expect(result.market?.savings?.topRatePeriod).toBe(
      '3.11% is a rate for new accounts; how long it holds is not stated, and the interest figure counts it throughout.',
    )
    expect(mortgageLine).toMatch(
      /^Mortgages: \d+ fit €360,000 over 30 years, from €[\d,]+ to €[\d,]+ a month\.$/,
    )
    expect(result.lines.slice(-2)).toEqual([savingsLine, mortgageLine])
    expect(result.presentation).toEqual(expect.arrayContaining([savingsLine, mortgageLine]))
    const text = JSON.stringify(result.market)
    expect(adviceWordsIn(text)).toEqual([])
    expect(text).not.toMatch(/\b(best|should)\b/i)
  })

  it('runs the savings to the keys month a plan names, to the date given without one, else 12 months', () => {
    // A plan's keys month (counting savings interest) is passed in and wins over the calculator's.
    const planned = homeMarketSummary(MARKET, REQUEST, result.figures, AS_OF, '2028-03')
    expect(planned?.savings?.by).toBe('2028-03')
    expect(planned?.savings?.runsTo).toBe('keys_month')
    expect(planned?.savings?.basis).toMatch(
      /by March 2028, the month the money for the keys is there/,
    )
    expect(planned?.savings?.interestToTargetEur).toBeLessThan(
      result.market?.savings?.interestToTargetEur ?? 0,
    )

    // Nothing saved a month: the keys are not reached, so the figures run to the date given.
    const stalled = homeCalculatorRequestSchema.parse({ ...REQUEST, monthlySavingEur: 0 })
    const stalledResult = homeCalculator(stalled, AS_OF, MARKET)
    expect(stalledResult.figures.depositReachedOn).toBeNull()
    expect(stalledResult.market?.savings?.by).toBe('2028-06')
    expect(stalledResult.market?.savings?.runsTo).toBe('date_given')
    expect(stalledResult.market?.savings?.basis).toMatch(/by June 2028, the date given/)

    // Neither: 12 months on, as before.
    const undated = homeCalculatorRequestSchema.parse({
      ...REQUEST,
      monthlySavingEur: 0,
      targetDate: undefined,
    })
    const undatedResult = homeCalculator(undated, AS_OF, MARKET)
    expect(undatedResult.market?.savings?.by).toBe('2027-11')
    expect(undatedResult.market?.savings?.runsTo).toBe('no_date')
  })

  it('is null without market data', () => {
    expect(homeCalculator(REQUEST, AS_OF).market).toBeNull()
    expect(homeMarketSummary(normaliseMarket([]), REQUEST, result.figures, AS_OF)).toBeNull()
    const without = homeCalculator(REQUEST, AS_OF, normaliseMarket([]))
    expect(without.market).toBeNull()
    expect(without.lines.some((line) => line.startsWith('Savings:'))).toBe(false)
    expect(() => homeCalculatorResponseSchema.parse(without)).not.toThrow()
  })

  it('leaves the mortgage out until a price is known', () => {
    const summary = homeCalculator(
      homeCalculatorRequestSchema.parse({ depositSavedEur: 10_000 }),
      AS_OF,
      MARKET,
    ).market
    expect(summary?.mortgage).toBeNull()
    expect(summary?.savings?.by).toBe('2027-11')
  })
})
