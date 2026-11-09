import { describe, expect, it } from 'vitest'
import {
  buildPlanRequestSchema,
  firstHomeRequestSchema,
  firstHomeResponseSchema,
  reviewRequestSchema,
} from '../../contracts/market-tools.ts'
import { HELP_TO_BUY, MORTGAGE_MEASURES } from '../../market/first-home-rules.ts'
import { firstHome, helpToBuyFor } from './first-home.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'
import { review } from './review.ts'

const market = normaliseMarket(MARKET_FIXTURE)
const ask = (body: Record<string, unknown>) => firstHome(market, firstHomeRequestSchema.parse(body))

describe('the first-home rules, as recorded', () => {
  it('carries a primary source and a date for every rule', () => {
    for (const source of [...HELP_TO_BUY.sources, MORTGAGE_MEASURES.source]) {
      expect(source.url).toMatch(/^https:\/\/www\.(revenue|centralbank)\.ie\//)
      expect(source.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(HELP_TO_BUY.capEur).toBe(35_000)
    expect(HELP_TO_BUY.endsOn).toBe('2029-12-31')
  })
})

describe('Help to Buy', () => {
  it('is the lesser of 10% of the price, the cap and tax paid', () => {
    const base = { propertyKind: 'new_build' as const, firstTimeBuyer: true }
    expect(helpToBuyFor({ ...base, price: 300_000, taxPaid: 50_000 })).toMatchObject({
      status: 'available',
      amountEur: 30_000,
      limitedBy: 'share_of_price',
    })
    expect(helpToBuyFor({ ...base, price: 420_000, taxPaid: 50_000 })).toMatchObject({
      amountEur: 35_000,
      limitedBy: 'cap',
    })
    expect(helpToBuyFor({ ...base, price: 420_000, taxPaid: 22_000 })).toMatchObject({
      amountEur: 22_000,
      limitedBy: 'tax_paid',
    })
  })

  it('depends on what was not given, and is not available outside its rules', () => {
    expect(
      helpToBuyFor({
        price: 380_000,
        propertyKind: 'new_build',
        firstTimeBuyer: true,
        taxPaid: undefined,
      }),
    ).toMatchObject({ status: 'depends', amountEur: null, upToEur: 35_000 })
    expect(
      helpToBuyFor({
        price: 380_000,
        propertyKind: undefined,
        firstTimeBuyer: true,
        taxPaid: 50_000,
      }).status,
    ).toBe('depends')
    expect(
      helpToBuyFor({
        price: 380_000,
        propertyKind: 'second_hand',
        firstTimeBuyer: true,
        taxPaid: 50_000,
      }).status,
    ).toBe('not_available')
    expect(
      helpToBuyFor({
        price: 520_000,
        propertyKind: 'new_build',
        firstTimeBuyer: true,
        taxPaid: 50_000,
      }).status,
    ).toBe('not_available')
    expect(
      helpToBuyFor({
        price: 380_000,
        propertyKind: 'new_build',
        firstTimeBuyer: false,
        taxPaid: 50_000,
      }).status,
    ).toBe('not_available')
  })
})

describe('a first home: €62,000 gross, €35,000 saved, a new build at €380,000', () => {
  const result = ask({
    annualGrossIncome: 62_000,
    deposit: 35_000,
    propertyPrice: 380_000,
    propertyKind: 'new_build',
  })

  it('applies the Central Bank limits with Help to Buy towards the deposit', () => {
    expect(result.lending).toMatchObject({
      loanToIncome: 4,
      maxLtvPct: 90,
      allowancePct: 15,
      maxLoanByIncome: 248_000,
      maxPriceWithoutHelpToBuy: 283_000,
    })
    // P = 35,000 + 10% of P + 248,000.
    expect(result.lending.maxPriceWithHelpToBuy).toBeCloseTo(314_444.44, 1)
    expect(result.lending.forPrice).toMatchObject({
      depositNeeded: 38_000,
      helpToBuy: 35_000,
      depositShortfall: 0,
      loanNeeded: 310_000,
      withinIncomeLimit: false,
      aboveIncomeLimitBy: 62_000,
      helpToBuyMortgageShareMet: true,
    })
    expect(result.helpToBuy).toMatchObject({ status: 'depends', upToEur: 35_000, limitedBy: 'cap' })
  })

  it('states the First Home scheme only as far as it is confirmed, and green rates from the data', () => {
    expect(result.firstHomeScheme.confirmed).toBe(false)
    expect(result.greenRates.note).toMatch(/No Central Bank or government rule/)
    expect(() => firstHomeResponseSchema.parse(result)).not.toThrow()
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/you should|we recommend/)
  })
})

describe('first home in the review and the plan', () => {
  const situation = {
    income: { annualGross: 62_000 },
    monthlySaving: 800,
    savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
    firstTimeBuyer: true,
  }
  const goals = [
    { id: 'home', kind: 'house_deposit', label: 'First home', targetDate: '2027-11', priority: 1 },
  ]

  it('names Help to Buy in the review', () => {
    const result = review(market, reviewRequestSchema.parse({ situation, goals }), '2026-11-09')
    const finding = result.findings.find((f) => f.kind === 'help_to_buy')
    expect(finding?.figures['capEur']).toBe(35_000)
    expect(finding?.figures['maxPriceWithHelpToBuy']).toBeGreaterThan(
      finding?.figures['maxPriceWithoutHelpToBuy'] ?? Infinity,
    )
  })

  it('adds Help to Buy to the plan’s affordability', () => {
    const result = buildPlan(
      market,
      buildPlanRequestSchema.parse({ situation, goals }),
      '2026-11-09',
      '2026-11-09T12:00:00.000Z',
    )
    expect(result.affordability?.helpToBuy?.maxPriceWithHelpToBuy).toBeGreaterThan(
      result.affordability?.maxPrice ?? Infinity,
    )
    expect(result.affordability?.helpToBuy?.sourceUrl).toMatch(/revenue\.ie/)
  })
})
