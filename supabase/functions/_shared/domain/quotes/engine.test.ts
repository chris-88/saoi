import { describe, expect, it } from 'vitest'
import { buildQuote } from './engine.ts'
import type { ProductVariant } from './types.ts'

/**
 * Fixtures rather than Demo Bank's catalogue.
 *
 * Invariant 11 keeps the domain free of tenants, and it is right for a second reason: an engine
 * test that reads live product data fails whenever somebody edits a rate, which teaches people
 * to change the test rather than look at it.
 */
const FIXTURES: Readonly<Record<string, readonly ProductVariant[]>> = {
  mortgage: [
    {
      id: 'fixed_4y',
      name: '4-year fixed',
      highlight: 'Lowest monthly',
      shape: 'borrowing',
      annualRate: 0.031,
      fixedYears: 4,
      maxMonths: 420,
    },
    {
      id: 'fixed_1y',
      name: '1-year fixed',
      shape: 'borrowing',
      annualRate: 0.033,
      fixedYears: 1,
      maxMonths: 420,
    },
    {
      id: 'fixed_5y',
      name: '5-year fixed',
      shape: 'borrowing',
      annualRate: 0.034,
      fixedYears: 5,
      maxMonths: 420,
    },
  ],
  personal_loan: [
    {
      id: 'loan_3y',
      name: 'Over 3 years',
      shape: 'borrowing',
      annualRate: 0.079,
      minAmount: 2_000,
      minMonths: 36,
      maxMonths: 36,
    },
    {
      id: 'loan_5y',
      name: 'Over 5 years',
      shape: 'borrowing',
      annualRate: 0.085,
      minAmount: 2_000,
      minMonths: 60,
      maxMonths: 60,
    },
    {
      id: 'loan_7y',
      name: 'Over 7 years',
      shape: 'borrowing',
      annualRate: 0.094,
      minAmount: 10_000,
      minMonths: 84,
      maxMonths: 84,
    },
  ],
  savings: [
    { id: 'save_instant', name: 'Instant access', shape: 'saving', annualRate: 0.02 },
    { id: 'save_regular', name: 'Regular saver', shape: 'saving', annualRate: 0.03 },
  ],
  credit_card: [
    { id: 'card_standard', name: 'Standard card', shape: 'revolving', annualRate: 0.229 },
  ],
  joint_account: [],
}

const variants = (product: keyof typeof FIXTURES) => FIXTURES[product] ?? []

/**
 * The two questions from the brief, asked from opposite ends.
 *
 * "What would €600,000 over 30 years cost" and "I want a €30,000 car at about €400 a month" are
 * the same question, and answering only the first is how a calculator differs from a
 * conversation.
 */
describe('a question about money becomes options', () => {
  it('answers an amount and a term with a monthly figure', () => {
    const quote = buildQuote(variants('mortgage'), { amount: 600_000, months: 360 })

    expect(quote.problem).toBeNull()
    expect(quote.options.length).toBeGreaterThanOrEqual(3)
    expect(quote.basis).toBe('€600,000, over 30 years')

    const cheapest = quote.options[0]
    expect(cheapest?.headline.label).toBe('Monthly repayment')
    expect(cheapest?.headline.value).toMatch(/^€2,5\d\d \/ month$/)
    // The trade-off is the point: the total is what the monthly figure hides.
    expect(cheapest?.figures.map((figure) => figure.label)).toEqual([
      'Rate',
      'Over',
      'Total repaid',
    ])
  })

  it('answers an amount and a budget with a term', () => {
    const quote = buildQuote(variants('mortgage'), { amount: 30_000, monthly: 400 })

    expect(quote.problem).toBeNull()
    expect(quote.options[0]?.headline.label).toBe('Paid off in')
    expect(quote.basis).toBe('€30,000, at €400 a month')
  })

  it('lets a product define its own terms as the options', () => {
    // A personal loan is not "pick a term", it is three terms with different rates.
    const quote = buildQuote(variants('personal_loan'), { amount: 30_000 })

    expect(quote.options.map((option) => option.name)).toEqual([
      'Over 3 years',
      'Over 5 years',
      'Over 7 years',
    ])
    // Longer costs less a month and more in total, which is the whole comparison.
    const [three, , seven] = quote.options
    expect(three?.headline.value).not.toBe(seven?.headline.value)
  })

  /**
   * The product does not do two years; what it does is the answer. Returning nothing when three
   * perfectly good options exist is the worst of both.
   */
  it('offers the terms a product has when the one they asked for is not among them', () => {
    const quote = buildQuote(variants('personal_loan'), { amount: 3_000, months: 24 })

    expect(quote.problem).toBeNull()
    expect(quote.options.map((option) => option.name)).toEqual(['Over 3 years', 'Over 5 years'])
  })

  it('leaves out what the customer cannot have rather than listing it greyed', () => {
    // €5,000 is below the seven-year minimum, so that option is simply not there.
    const quote = buildQuote(variants('personal_loan'), { amount: 5_000 })
    expect(quote.options.map((option) => option.name)).toEqual(['Over 3 years', 'Over 5 years'])
  })

  it('works out what regular saving builds to', () => {
    const quote = buildQuote(variants('savings'), { monthly: 300, months: 24 })

    expect(quote.options[0]?.headline.label).toBe('After 2 years')
    expect(
      quote.options.every((option) => option.figures.some((f) => f.label === 'Interest earned')),
    ).toBe(true)
  })

  it('works out how long a target takes', () => {
    const quote = buildQuote(variants('savings'), { amount: 10_000, monthly: 500 })
    expect(quote.options[0]?.headline.label).toBe('To reach €10,000')
  })

  it('works out what clearing a card balance takes', () => {
    const quote = buildQuote(variants('credit_card'), { amount: 3_000, monthly: 200 })

    expect(quote.options[0]?.headline.label).toBe('Cleared in')
    expect(quote.options[0]?.figures.some((figure) => figure.label === 'Interest')).toBe(true)
  })

  /**
   * A product with set terms cannot stretch to a budget, and "no options" is not an answer
   * anybody can act on. What those terms actually cost is.
   */
  it('shows the gap rather than refusing, when a fixed term costs more than the budget', () => {
    const quote = buildQuote(variants('personal_loan'), { amount: 30_000, monthly: 20 })

    expect(quote.options.length).toBeGreaterThan(0)
    expect(quote.options[0]?.footnote).toMatch(/more than the €20 you mentioned/i)
  })

  it('says why when a payment would never clear the balance at all', () => {
    const quote = buildQuote(variants('credit_card'), { amount: 3_000, monthly: 5 })

    expect(quote.options).toEqual([])
    expect(quote.problem).toMatch(/would not cover the interest/i)
    expect(quote.problem).toMatch(/€3,000/)
  })

  it('needs two numbers before it can say anything', () => {
    expect(buildQuote(variants('mortgage'), { amount: 600_000 }).options).toEqual([])
  })

  it('has nothing to compare for a product without figures', () => {
    expect(buildQuote(variants('joint_account'), { amount: 100 }).problem).toMatch(/no figures/i)
  })
})

/**
 * Money they already have counts towards the target.
 *
 * A customer with €32,000 saved, putting away €1,200 a month towards €40,000, was told it would
 * take two years and nine months. That is how long €40,000 takes from nothing — thirty-three
 * payments of €1,200 — and they were seven months away. The arithmetic was right and it was
 * answering a question nobody asked.
 */
describe('a savings quote with money already saved', () => {
  const savings: readonly ProductVariant[] = [
    { id: 'regular', name: 'Regular saver', shape: 'saving', annualRate: 0.03 },
  ]

  it('counts what they have towards the target', () => {
    const quote = buildQuote(savings, { amount: 40_000, monthly: 1_200, opening: 32_000 })
    const headline = quote.options[0]?.headline.value ?? ''

    // Eight thousand short at twelve hundred a month, so seven payments.
    expect(headline).toBe('7 months')
  })

  it('still answers from nothing when nothing is saved', () => {
    const quote = buildQuote(savings, { amount: 40_000, monthly: 1_200 })

    expect(quote.options[0]?.headline.value).toBe('2y 9m')
  })

  it('says it is already done when the target has been passed', () => {
    const quote = buildQuote(savings, { amount: 40_000, monthly: 1_200, opening: 45_000 })

    expect(quote.options[0]?.headline.value).toBe('0 months')
  })

  it('adds what they have to a projection forwards', () => {
    const from0 = buildQuote(savings, { months: 12, monthly: 1_200 })
    const from32k = buildQuote(savings, { months: 12, monthly: 1_200, opening: 32_000 })

    const value = (q: typeof from0) =>
      Number((q.options[0]?.headline.value ?? '').replace(/\D/g, ''))
    expect(value(from32k)).toBeGreaterThan(value(from0) + 32_000)
  })

  it('says what it counted, so the figure can be checked', () => {
    const quote = buildQuote(savings, { amount: 40_000, monthly: 1_200, opening: 32_000 })

    expect(quote.basis).toContain('32,000')
  })
})
