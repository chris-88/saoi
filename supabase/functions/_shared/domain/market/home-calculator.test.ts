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

  it('counts Help to Buy for a first-time buyer’s new build when tax paid is given', () => {
    const result = calc({
      targetPriceEur: 400_000,
      propertyKind: 'new_build',
      taxPaidLastFourYearsEur: 40_000,
    })
    expect(result.figures.helpToBuyEur).toBe(35_000)
    expect(result.figures.helpToBuyConditional).toBe(false)
    expect(result.figures.neededAtKeysEur).toBe(12_000)
    expect(result.lines.join(' ')).toMatch(/less €35,000 Help to Buy/)
  })

  it('limits Help to Buy in the headline to the tax paid given', () => {
    const result = calc({
      targetPriceEur: 400_000,
      propertyKind: 'new_build',
      taxPaidLastFourYearsEur: 20_000,
    })
    expect(result.figures.helpToBuyEur).toBe(20_000)
    expect(result.figures.neededAtKeysEur).toBe(27_000)
  })

  it('leaves Help to Buy out of the headline when tax paid is not given, and says so', () => {
    const result = calc({
      depositSavedEur: 30_000,
      monthlySavingEur: 1_000,
      targetPriceEur: 400_000,
      propertyKind: 'new_build',
    })
    expect(result.figures).toMatchObject({
      helpToBuyEur: 35_000,
      helpToBuyConditional: true,
      neededAtKeysEur: 47_000,
      depositReachedOn: '2028-04',
    })
    expect(result.lines.join(' ')).toMatch(/Help to Buy is not counted above: up to €35,000/)
    const route = result.routes[0]
    expect(route?.id).toBe('new_build_help_to_buy')
    expect(route?.keysOn).toBe('2026-11')
    expect(route?.line).toBe(
      'New build with Help to Buy: keys Nov 2026 if your tax paid covers €35,000',
    )
  })

  it('leaves second-hand without Help to Buy, conditional or not', () => {
    const result = calc({ targetPriceEur: 400_000, propertyKind: 'second_hand' })
    expect(result.figures.helpToBuyEur).toBe(0)
    expect(result.figures.helpToBuyConditional).toBe(false)
  })

  it('names the first-time buyer default in `assumed`, and only when it was not said', () => {
    expect(calc({}).assumed.join(' ')).toMatch(/First-time buyer, as nothing else was said/)
    expect(calc({ firstTimeBuyer: true }).assumed).toEqual([])
    expect(calc({ firstTimeBuyer: false }).assumed).toEqual([])
  })

  it('asks for rent last, as an optional question that changes no figure', () => {
    const base = {
      depositSavedEur: 30_000,
      monthlySavingEur: 1_000,
      annualGrossIncomeEur: 60_000,
      targetPriceEur: 400_000,
    }
    const without = calc(base)
    const withRent = calc({ ...base, monthlyRentEur: 1_800 })
    expect(without.questions.at(-1)).toEqual({
      key: 'monthlyRentEur',
      question: 'What do you pay in rent a month? (optional)',
      optional: true,
    })
    expect(withRent.questions.map((q) => q.key)).not.toContain('monthlyRentEur')
    expect(withRent.figures).toEqual(without.figures)
    expect(withRent.routes).toEqual(without.routes)
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
      'monthlyRentEur',
    ])
    expect(result.questions.filter((q) => q.optional).map((q) => q.key)).toEqual(['monthlyRentEur'])
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

describe('the core-information gate', () => {
  const CORE = {
    depositSavedEur: 30_000,
    monthlySavingEur: 1_000,
    annualGrossIncomeEur: 80_000,
  }
  const asked = (result: ReturnType<typeof calc>) =>
    result.gate.missing.filter((item) => item.askNow).map((item) => item.key)
  const holdsTheLine = (result: ReturnType<typeof calc>) => {
    expect(() => homeCalculatorResponseSchema.parse(result)).not.toThrow()
    for (const item of result.gate.missing) {
      expect(adviceWordsIn(`${item.question} ${item.moves}`)).toEqual([])
      expect(item.question).toMatch(/\?/)
      expect(item.moves).not.toMatch(/\?|€|\b(you should|tell|give|enter|share|add)\b/i)
    }
    for (const line of result.presentation) expect(adviceWordsIn(line)).toEqual([])
    expect(asked(result).length).toBeLessThanOrEqual(2)
  }

  it('is ready with all four in, and presents the figures as before', () => {
    const result = calc({ ...CORE, targetPriceEur: 350_000, targetDate: '2028-06' })
    holdsTheLine(result)
    expect(result.gate).toEqual({ ready: true, missing: [] })
    expect(result.presentation.slice(0, result.lines.length)).toEqual(result.lines)
    expect(result.presentation).toEqual(expect.arrayContaining([...MORTGAGE_WARNINGS]))
  })

  it('is ready with a date and no price, when the other three are in', () => {
    const result = calc({ ...CORE, targetDate: '2028-06' })
    holdsTheLine(result)
    expect(result.gate.ready).toBe(true)
    expect(result.figures.priceFrom).toBe('limits')
    expect(result.presentation.join(' ')).toMatch(/€/)
  })

  it('is ready with a price and no date, when the other three are in', () => {
    const result = calc({ ...CORE, targetPriceEur: 350_000 })
    holdsTheLine(result)
    expect(result.gate.ready).toBe(true)
    // The date stays a chip for the card, never a gate.
    expect(result.questions.map((q) => q.key)).toContain('targetDate')
  })

  it('is not ready on a date alone, and asks the income and the price', () => {
    const result = calc({ targetDate: '2028-06' })
    holdsTheLine(result)
    expect(result.gate.ready).toBe(false)
    expect(result.gate.missing.map((item) => item.key)).not.toContain('targetDate')
    expect(asked(result)).toEqual(['annualGrossIncomeEur', 'depositSavedEur'])
  })

  it('holds the figures back when the income is missing, and asks it with what it moves', () => {
    const result = calc({
      depositSavedEur: 30_000,
      monthlySavingEur: 1_000,
      targetPriceEur: 350_000,
    })
    holdsTheLine(result)
    expect(result.gate.ready).toBe(false)
    expect(result.gate.missing).toEqual([
      {
        key: 'annualGrossIncomeEur',
        question: 'What is your gross income a year, before tax?',
        moves: 'It sets what the Central Bank limits allow.',
        askNow: true,
      },
    ])
    expect(result.presentation).toEqual([
      'What is your gross income a year, before tax? It sets what the Central Bank limits allow.',
      RESULT_STATEMENT,
    ])
    // The card still gets its figures and rules.
    expect(result.figures.neededAtKeysEur).toBe(41_500)
    expect(result.rules.loanToIncome).toBe(4)
    expect(result.inputs.targetPriceEur).toBe(350_000)
  })

  it('with nothing given, asks two plain questions and quotes no figure', () => {
    const result = calc({})
    holdsTheLine(result)
    expect(result.gate.ready).toBe(false)
    expect(result.gate.missing.map((item) => item.key)).toEqual([
      'annualGrossIncomeEur',
      'targetPriceEur',
      'targetDate',
      'depositSavedEur',
      'monthlySavingEur',
    ])
    expect(asked(result)).toEqual(['annualGrossIncomeEur', 'targetPriceEur'])
    expect(result.presentation).toHaveLength(3)
    expect(result.presentation[1]).toMatch(/A month for the keys works instead/)
    const text = result.presentation.join(' ')
    expect(text).not.toMatch(/€|\d/)
    expect(text).not.toMatch(
      /Still to know|First-time buyer|Save this|Show my options|Compare all product options|routes/i,
    )
    expect(result.presentation.at(-1)).toBe(RESULT_STATEMENT)
    // The chips stay for the card.
    expect(result.questions).toHaveLength(10)
  })

  it('asks the price, not the date, when both are missing', () => {
    const result = calc(CORE)
    holdsTheLine(result)
    expect(result.gate.ready).toBe(false)
    expect(result.gate.missing.map((item) => [item.key, item.askNow])).toEqual([
      ['targetPriceEur', true],
      ['targetDate', false],
    ])
  })

  it('never blocks on the kind of home, first-time status, bank, rate type or rent', () => {
    const result = calc({ ...CORE, targetPriceEur: 350_000 })
    expect(result.gate.ready).toBe(true)
    expect(result.questions.map((q) => q.key)).toEqual(
      expect.arrayContaining(['firstTimeBuyer', 'propertyKind', 'currentBank', 'rateType']),
    )
  })

  it('is ready on one income when not buying together, or when not said', () => {
    expect(calc({ ...CORE, targetPriceEur: 350_000 }).gate.ready).toBe(true)
    expect(calc({ ...CORE, targetPriceEur: 350_000, buyingTogether: false }).gate.ready).toBe(true)
  })

  it('when buying together, waits for the second income and asks it', () => {
    const one = calc({ ...CORE, targetPriceEur: 350_000, buyingTogether: true })
    holdsTheLine(one)
    expect(one.gate.ready).toBe(false)
    expect(one.gate.missing).toEqual([
      {
        key: 'secondIncomeEur',
        question: 'What is the other buyer’s gross income a year, before tax?',
        moves: 'Both incomes together set what the Central Bank limits allow.',
        askNow: true,
      },
    ])
    const both = calc({
      ...CORE,
      secondIncomeEur: 40_000,
      targetPriceEur: 350_000,
      buyingTogether: true,
    })
    expect(both.gate.ready).toBe(true)
    expect(both.figures.incomeEur).toBe(120_000)
  })

  it('when buying together with nothing given, asks both incomes first', () => {
    const result = calc({ buyingTogether: true })
    holdsTheLine(result)
    expect(asked(result)).toEqual(['annualGrossIncomeEur', 'secondIncomeEur'])
  })
})
