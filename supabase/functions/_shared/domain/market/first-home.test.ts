import { describe, expect, it } from 'vitest'
import {
  buildPlanRequestSchema,
  firstHomeRequestSchema,
  firstHomeResponseSchema,
  reviewRequestSchema,
} from '../../contracts/market-tools.ts'
import { HELP_TO_BUY, MORTGAGE_MEASURES } from '../../market/first-home-rules.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { firstHome, helpToBuyFor } from './first-home.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'
import { review } from './review.ts'

const market = normaliseMarket(MARKET_FIXTURE)
const ask = (body: Record<string, unknown>) =>
  firstHome(market, firstHomeRequestSchema.parse(body), '2026-11-10')

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

  it('states the First Home Scheme as read from its own site, and green rates from the data', () => {
    expect(result.firstHomeScheme.confirmed).toBe(true)
    expect(result.firstHomeScheme.source.url).toMatch(/^https:\/\/www\.firsthomescheme\.ie/)
    expect(result.routes.map((route) => route.id)).toContain('first_home_scheme')
    expect(result.greenRates.note).toMatch(/No Central Bank or government rule/)
    expect(result.greenRates.cheapestGreen?.name ?? '').not.toMatch(/HVM|high(er)? value/i)
    expect(result.greenRates.cheapestStandard?.name ?? '').not.toMatch(/HVM|high(er)? value/i)
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

describe('routes and rent in the first-home result', () => {
  it('carries every route, three in the presentation after the limits, and no pick', () => {
    const result = ask({
      annualGrossIncome: 100_000,
      deposit: 30_000,
      propertyPrice: 400_000,
      propertyKind: 'new_build',
      jointApplication: true,
    })
    expect(result.routes).toHaveLength(6)
    expect(result.routes[0]?.id).toBe('new_build_help_to_buy')
    const lahl = result.routes.find((route) => route.id === 'local_authority_home_loan')
    expect(lahl?.status).toBe('not_applicable')
    expect(lahl?.line).toBe(
      'Local Authority Home Loan: not at €100,000 joint income, the ceiling is €85,000',
    )
    const at = result.presentation.findIndex((line) => line.startsWith('Central Bank limits'))
    expect(result.presentation.slice(at + 1, at + 5)).toEqual([
      ...result.routes.slice(0, 3).map((route) => route.line),
      'More routes: 3',
    ])
    expect(result.rentVsRepayment).toEqual([])
    for (const line of result.presentation) expect(adviceWordsIn(line)).toEqual([])
  })

  it('sets rent beside the options’ repayments as facts, changing no figure', () => {
    const body = { annualGrossIncome: 80_000, deposit: 40_000, propertyPrice: 350_000 }
    const without = ask(body)
    const withRent = ask({ ...body, monthlyRentEur: 1_800 })
    expect(withRent.lending).toEqual(without.lending)
    expect(withRent.options).toEqual(without.options)
    expect(withRent.rentVsRepayment.length).toBe(Math.min(3, withRent.options.length))
    for (const line of withRent.rentVsRepayment) {
      expect(line).toMatch(/^Rent €1,800 a month against a €[\d,]+ repayment \(/)
    }
  })
})
