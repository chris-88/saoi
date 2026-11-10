import { describe, expect, it } from 'vitest'
import { moneyCheckRequestSchema, moneyCheckResponseSchema } from '../../contracts/market-tools.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { moneyCheck } from './money-check.ts'
import { normaliseMarket } from './normalise.ts'

const market = normaliseMarket(MARKET_FIXTURE)
const check = (body: Record<string, unknown>) =>
  moneyCheck(market, moneyCheckRequestSchema.parse(body), '2026-11-09', '2026-11-09T12:00:00.000Z')

describe('the money check, one call on whatever was said', () => {
  it('with nothing said, asks the questions that would start it', () => {
    const result = check({})
    expect(result.plan).toBeNull()
    expect(result.questions[0]).toMatch(/How much is held/)
    expect(result.questions.length).toBeLessThanOrEqual(3)
    expect(result.presentation.join(' ')).toMatch(/To sharpen this, the customer could say: \(1\)/)
    expect(() => moneyCheckResponseSchema.parse(result)).not.toThrow()
  })

  it('with money and no goal, builds a plan for the savings held and says so', () => {
    const result = check({
      situation: {
        savings: [{ label: 'Current account', balance: 20_000, access: 'current_account' }],
      },
    })
    expect(result.plan).not.toBeNull()
    expect(result.planGoalAssumed).toMatch(/no date/)
    expect(result.presentation.join(' ')).toMatch(/No goal was given/)
    expect(result.questions.join(' ')).toMatch(/What is the money for/)
  })

  it('with test 2’s situation, gives the plan, money found first, and Help to Buy for the home', () => {
    const result = check({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'Current account', balance: 25_000, access: 'current_account' }],
        debts: [
          {
            id: 'car',
            label: 'Car loan',
            kind: 'car_finance',
            balance: 9_000,
            ratePct: 9,
            monthsRemaining: 36,
          },
        ],
      },
      goals: [
        { id: 'deposit', kind: 'house_deposit', label: 'House deposit', targetDate: '2028-11' },
      ],
    })
    expect(result.planGoalAssumed).toBeNull()
    expect(result.presentation[0]).toMatch(/^Your home: keys around /)
    expect(result.presentation).toContain(result.plan?.moneyFound.headline)
    expect(result.presentation.join(' ')).toMatch(/Help to Buy: depends, up to €35,000/)
    expect(result.questions.join(' ')).toMatch(/gross income/)
    expect(result.questions.join(' ')).not.toMatch(/Is this a first home/)
    expect(result.presentation.at(-2)).toMatch(/the customer decides/)
    expect(result.presentation.at(-1)).toMatch(/^Answer this one and the plan gets sharper: /)
    expect(() => moneyCheckResponseSchema.parse(result)).not.toThrow()
  })

  it('never shows a negative gain, and names the month rather than a month number', () => {
    const result = check({
      situation: {
        income: { annualGross: 62_000 },
        monthlySaving: 800,
        savings: [{ label: 'Savings', balance: 35_000 }],
        firstTimeBuyer: true,
      },
      goals: [
        {
          id: 'home',
          kind: 'house_deposit',
          label: 'First home',
          targetAmount: 38_000,
          targetDate: '2027-06',
        },
      ],
      homePrice: 380_000,
      propertyKind: 'new_build',
    })
    const all = [
      ...result.presentation,
      ...(result.plan?.whatIf.lines ?? []),
      ...(result.plan?.reasoning ?? []),
    ].join(' ')
    expect(all).not.toMatch(/€-/)
    const open = check({ situation: { savings: [{ label: 'Current account', balance: 20_000 }] } })
    expect(open.presentation.join(' ')).not.toMatch(/month 12/)
    expect(open.presentation.join(' ')).not.toMatch(/nothing owed on the debts given/)
  })
})
