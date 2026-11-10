import { describe, expect, it } from 'vitest'
import {
  homeCalculatorRequestSchema,
  homeCalculatorResponseSchema,
} from '../../contracts/market-tools.ts'
import { adviceWordsIn, MORTGAGE_WARNINGS, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { homeCalculator } from './home-calculator.ts'

const AS_OF = '2026-11-10'
const calc = (body: Record<string, unknown>) =>
  homeCalculator(homeCalculatorRequestSchema.parse(body), AS_OF)

describe('the home calculator', () => {
  it('works out the limits, the cash at the keys and the month it is saved', () => {
    const result = calc({
      depositSavedEur: 20_000,
      monthlySavingEur: 1_000,
      annualGrossIncomeEur: 60_000,
      secondIncomeEur: 40_000,
      targetPriceEur: 400_000,
      targetDate: '2028-06',
      firstTimeBuyer: true,
      propertyKind: 'second_hand',
    })
    expect(() => homeCalculatorResponseSchema.parse(result)).not.toThrow()
    expect(result.figures).toMatchObject({
      incomeEur: 100_000,
      maxLoanEur: 400_000,
      priceEur: 400_000,
      priceFrom: 'given',
      loanEur: 360_000,
      depositNeededEur: 40_000,
      stampDutyEur: 4_000,
      helpToBuyEur: 0,
      neededAtKeysEur: 47_000,
      // €27,000 more at €1,000 a month: 27 months from November 2026.
      depositReachedOn: '2029-02',
      targetDateMet: false,
    })
    expect(result.lines.join(' ')).toMatch(/both incomes/)
    expect(result.lines.join(' ')).toMatch(/8 months after June 2028, the date given/)
  })

  it('caps the loan by income and raises the deposit to match', () => {
    const result = calc({ annualGrossIncomeEur: 70_000, targetPriceEur: 350_000 })
    expect(result.figures.maxLoanEur).toBe(280_000)
    expect(result.figures.depositNeededEur).toBe(70_000)
    expect(result.lines.join(' ')).toMatch(/the loan is capped at €280,000/)
  })

  it('counts Help to Buy for a first-time buyer’s new build', () => {
    const result = calc({ targetPriceEur: 400_000, propertyKind: 'new_build' })
    expect(result.figures.helpToBuyEur).toBe(35_000)
    expect(result.figures.neededAtKeysEur).toBe(12_000)
  })

  it('asks for what is missing in plain questions, and never picks a product', () => {
    const result = calc({})
    expect(result.questions.map((q) => q.key)).toEqual([
      'depositSavedEur',
      'monthlySavingEur',
      'annualGrossIncomeEur',
      'targetPriceEur',
      'targetDate',
      'firstTimeBuyer',
      'propertyKind',
      'currentBank',
      'rateType',
    ])
    expect(result.figures.priceEur).toBeNull()
    expect(result.warnings).toEqual([...MORTGAGE_WARNINGS])
    expect(result.presentation.at(-1)).toBe(RESULT_STATEMENT)
    for (const line of result.presentation) expect(adviceWordsIn(line)).toEqual([])
  })

  it('without a price, sizes the home from the deposit by the date and the income limit', () => {
    const result = calc({
      depositSavedEur: 30_000,
      monthlySavingEur: 1_000,
      annualGrossIncomeEur: 80_000,
      targetDate: '2027-11',
    })
    expect(result.figures.priceFrom).toBe('limits')
    expect(result.figures.priceEur).toBeGreaterThan(300_000)
    expect(result.figures.loanEur).toBeLessThanOrEqual(320_000)
    expect(result.figures.targetDateMet).toBe(true)
  })
})
