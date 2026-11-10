import { describe, expect, it } from 'vitest'
import {
  homeCalculatorRequestSchema,
  homeCalculatorResponseSchema,
  homeRouteSchema,
} from '../../contracts/market-tools.ts'
import { LOCAL_AREAS } from '../../market/areas.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import {
  AFFORDABLE_PURCHASE,
  FIRST_HOME_SCHEME,
  LOCAL_AUTHORITY_HOME_LOAN,
  VACANT_PROPERTY_GRANT,
} from '../../market/first-home-rules.ts'
import { homeCalculator } from './home-calculator.ts'
import { homeRoutes, routeLines } from './routes.ts'

const AS_OF = '2026-11-10'
const calc = (body: Record<string, unknown>) =>
  homeCalculator(homeCalculatorRequestSchema.parse(body), AS_OF)
const route = (result: ReturnType<typeof calc>, id: string) => {
  const found = result.routes.find((item) => item.id === id)
  if (found === undefined) throw new Error(`no route ${id}`)
  return found
}

/** The Bank of Ireland example: €400k, €30k saved, €1,000 a month, €60k + €40k, mid-2028. */
const BOI = {
  depositSavedEur: 30_000,
  monthlySavingEur: 1_000,
  annualGrossIncomeEur: 60_000,
  secondIncomeEur: 40_000,
  targetPriceEur: 400_000,
  targetDate: '2028-06',
  currentBank: 'Bank of Ireland',
  stayWithBank: true,
}

describe('the scheme rules, as recorded', () => {
  it('carries a page and the day it was read for every scheme', () => {
    for (const source of [
      ...FIRST_HOME_SCHEME.sources,
      ...LOCAL_AUTHORITY_HOME_LOAN.sources,
      ...AFFORDABLE_PURCHASE.sources,
      ...VACANT_PROPERTY_GRANT.sources,
    ]) {
      expect(source.url).toMatch(/^https:\/\//)
      expect(source.checkedOn).toBe('2026-11-10')
      expect(source.fact.length).toBeGreaterThan(20)
    }
    expect(LOCAL_AUTHORITY_HOME_LOAN.maxIncomeSingleEur).toBe(80_000)
    expect(LOCAL_AUTHORITY_HOME_LOAN.maxIncomeJointEur).toBe(85_000)
    expect(LOCAL_AUTHORITY_HOME_LOAN.insufficientOffers).toBe(2)
    expect(FIRST_HOME_SCHEME.maxSharePct).toBe(30)
    expect(FIRST_HOME_SCHEME.maxShareWithHelpToBuyPct).toBe(20)
    // The build year differs between the two councils' pages: not confirmed.
    expect(VACANT_PROPERTY_GRANT.confirmed).toBe(false)
  })

  it('has a price limit for every county and Dublin local authority', () => {
    for (const area of LOCAL_AREAS) {
      expect(FIRST_HOME_SCHEME.ceilings[area].lowEur).toBeGreaterThan(0)
      expect(LOCAL_AUTHORITY_HOME_LOAN.ceilings[area].highEur).toBeGreaterThan(0)
    }
  })
})

describe('the Bank of Ireland example', () => {
  const result = calc(BOI)

  it('returns every route in the contract, as facts, with no pick', () => {
    expect(() => homeCalculatorResponseSchema.parse(result)).not.toThrow()
    expect(result.routes.map((item) => item.id).sort()).toEqual(
      [
        'affordable_purchase',
        'first_home_scheme',
        'local_authority_home_loan',
        'new_build_help_to_buy',
        'second_hand',
        'vacant_property_grant',
      ].sort(),
    )
    for (const item of result.routes) {
      expect(() => homeRouteSchema.parse(item)).not.toThrow()
      expect(item.line.length).toBeLessThanOrEqual(92)
      expect(adviceWordsIn(item.line)).toEqual([])
      expect(item.line).not.toMatch(/\b(best|fastest|recommend|should)\b/i)
      if (item.status === 'needs_one_detail') expect(item.missing).toMatch(/\?/)
      if (item.status === 'not_applicable') expect(item.reason).not.toBeNull()
    }
  })

  it('keeps the second-hand keys date the engine gave before routes', () => {
    // €47,000 at the keys, €17,000 more at €1,000 a month: April 2028, as before.
    expect(result.figures.neededAtKeysEur).toBe(47_000)
    expect(result.figures.depositReachedOn).toBe('2028-04')
    expect(route(result, 'second_hand')).toMatchObject({
      status: 'potential',
      keysOn: '2028-04',
      line: 'Second-hand: keys Apr 2028, €47,000 needed at the keys',
    })
  })

  it('makes the new-build route conditional on tax paid', () => {
    expect(route(result, 'new_build_help_to_buy')).toMatchObject({
      status: 'needs_one_detail',
      keysOn: '2026-11',
      line: 'New build with Help to Buy: keys Nov 2026 if your tax paid covers €35,000',
      missing: 'How much Income Tax and DIRT was paid over the last four tax years?',
    })
  })

  it('rules out the Local Authority Home Loan at €100,000 joint income', () => {
    expect(route(result, 'local_authority_home_loan')).toMatchObject({
      status: 'not_applicable',
      line: 'Local Authority Home Loan: not at €100,000 joint income, the ceiling is €85,000',
    })
  })

  it('asks for the county where the First Home ceiling depends on it', () => {
    expect(route(result, 'first_home_scheme')).toMatchObject({
      status: 'needs_one_detail',
      missing: 'Which county is the home in?',
    })
    const inDublin = calc({ ...BOI, county: 'dublin_city' })
    expect(route(inDublin, 'first_home_scheme')).toMatchObject({
      status: 'potential',
      line: 'First Home Scheme: shared equity up to €80,000 (20% with Help to Buy) on a new build',
    })
    const inCarlow = calc({ ...BOI, county: 'carlow' })
    expect(route(inCarlow, 'first_home_scheme')).toMatchObject({
      status: 'not_applicable',
      line: 'First Home Scheme: not at €400,000, the Carlow ceiling is €375,000',
    })
    const inCork = calc({ ...BOI, targetPriceEur: 480_000, county: 'cork' })
    expect(route(inCork, 'first_home_scheme').missing).toMatch(/Cork City €500,000/)
  })

  it('rules out affordable purchase on the income test, with the figures', () => {
    expect(route(result, 'affordable_purchase')).toMatchObject({
      status: 'not_applicable',
      line: 'Affordable purchase: not at €100,000 income for a €400,000 home, the limit is €85,500',
    })
  })

  it('states the vacant property grant as works money, never deposit money', () => {
    const grant = route(result, 'vacant_property_grant')
    expect(grant.line).toBe(
      'Vacant property grant: up to €50,000 for works after purchase, not the deposit',
    )
    expect(grant.keysOn).toBeNull()
    expect(grant.confirmed).toBe(false)
  })

  it('orders potential, then needs one detail, then not applicable, with no kind given', () => {
    const ranks = { potential: 0, needs_one_detail: 1, not_applicable: 2 }
    const order = result.routes.map((item) => ranks[item.status])
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('puts the routes right after the headline: three lines, then how many more', () => {
    const at = result.presentation.indexOf(result.lines.at(-1) ?? '')
    expect(result.presentation.slice(at + 1, at + 5)).toEqual([
      ...result.routes.slice(0, 3).map((item) => item.line),
      'More routes: 3',
    ])
    for (const line of result.presentation) expect(adviceWordsIn(line)).toEqual([])
  })
})

describe('the customer’s own kind of property comes first', () => {
  it('leads with second-hand for a second-hand home', () => {
    expect(calc({ ...BOI, propertyKind: 'second_hand' }).routes[0]?.id).toBe('second_hand')
  })

  it('leads with the new build for a new build, even when it is not applicable', () => {
    const result = calc({ ...BOI, targetPriceEur: 520_000, propertyKind: 'new_build' })
    expect(result.routes[0]).toMatchObject({
      id: 'new_build_help_to_buy',
      status: 'not_applicable',
      line: 'New build with Help to Buy: not at €520,000, the limit is €500,000',
      keysOn: null,
    })
    expect(result.figures.helpToBuyEur).toBe(0)
    expect(result.figures.helpToBuyConditional).toBe(false)
    expect(route(result, 'first_home_scheme').status).toBe('not_applicable')
  })
})

describe('a single €70,000 income', () => {
  it('leaves the Local Authority Home Loan open, short one detail at most', () => {
    const result = calc({ annualGrossIncomeEur: 70_000 })
    const lahl = route(result, 'local_authority_home_loan')
    expect(['potential', 'needs_one_detail']).toContain(lahl.status)
    expect(lahl.line).toMatch(/€70,000 within the €80,000 ceiling/)
  })

  it('is potential when the price and county are within the limits', () => {
    const result = calc({ annualGrossIncomeEur: 70_000, targetPriceEur: 300_000, county: 'meath' })
    expect(route(result, 'local_authority_home_loan')).toMatchObject({
      status: 'potential',
      line: 'Local Authority Home Loan: €70,000 is within the €80,000 single ceiling',
    })
  })

  it('asks whether anyone is buying with them between the two ceilings', () => {
    const routes = homeRoutes(
      {
        priceEur: 300_000,
        propertyKind: undefined,
        firstTimeBuyer: true,
        incomeEur: 82_000,
        applicants: undefined,
        savedEur: 0,
        monthlyEur: 0,
        taxPaidEur: undefined,
        county: 'meath',
        maxLoanEur: 328_000,
        maxLtvPct: 90,
      },
      AS_OF,
    )
    expect(routes.find((item) => item.id === 'local_authority_home_loan')?.missing).toMatch(
      /Is anyone buying with you\?/,
    )
  })
})

describe('tax paid given', () => {
  it('counts Help to Buy in the headline and on the new-build route', () => {
    const result = calc({ ...BOI, propertyKind: 'new_build', taxPaidLastFourYearsEur: 50_000 })
    expect(result.figures).toMatchObject({
      helpToBuyEur: 35_000,
      helpToBuyConditional: false,
      neededAtKeysEur: 12_000,
      depositReachedOn: '2026-11',
      targetDateMet: true,
    })
    expect(route(result, 'new_build_help_to_buy')).toMatchObject({
      status: 'potential',
      keysOn: '2026-11',
      line: 'New build with Help to Buy: keys Nov 2026 with €35,000 Help to Buy',
    })
  })
})

describe('a buyer who has owned a home before', () => {
  it('rules out Help to Buy and asks about Fresh Start for the schemes that allow it', () => {
    const result = calc({ ...BOI, firstTimeBuyer: false, secondIncomeEur: 10_000 })
    expect(route(result, 'new_build_help_to_buy').status).toBe('not_applicable')
    expect(route(result, 'affordable_purchase').missing).toMatch(/Fresh Start/)
  })
})

describe('routeLines', () => {
  it('shows three, then the count of the rest', () => {
    const routes = calc(BOI).routes
    expect(routeLines(routes)).toHaveLength(4)
    expect(routeLines(routes.slice(0, 2))).toHaveLength(2)
  })
})
