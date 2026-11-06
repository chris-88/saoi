import { describe, expect, it } from 'vitest'
import { suggestionsFor, type SuitabilityContext } from './suitability.ts'
import type { ProductVariant } from './types.ts'

const VARIANTS: SuitabilityContext['variants'] = {
  personal_loan: [
    { id: 'loan_3y', name: 'Over 3 years', shape: 'borrowing', annualRate: 0.079 },
    { id: 'loan_5y', name: 'Over 5 years', shape: 'borrowing', annualRate: 0.085 },
  ] as readonly ProductVariant[],
  credit_card: [
    { id: 'card_low', name: 'Low rate card', shape: 'revolving', annualRate: 0.139 },
    { id: 'card_std', name: 'Standard card', shape: 'revolving', annualRate: 0.229 },
  ] as readonly ProductVariant[],
}

function contextOf(facts: Record<string, unknown>): SuitabilityContext {
  return {
    variants: VARIANTS,
    facts: {
      has: (key) => facts[key as string] !== undefined,
      get: (key) => facts[key as string],
      number: (key) =>
        typeof facts[key as string] === 'number' ? (facts[key as string] as number) : null,
      boolean: (key) =>
        typeof facts[key as string] === 'boolean' ? (facts[key as string] as boolean) : null,
    },
  }
}

/**
 * The customer asks for the product they have heard of. Whether it fits depends on two things
 * nobody asked them: what the money is for, and how soon they mean to be rid of it.
 */
describe('whether what they asked for is what suits them', () => {
  it('says nothing until they have said enough', () => {
    // An amount alone is not a reason to recommend anything. Guessing from it is cross-selling.
    expect(
      suggestionsFor('personal_loan', contextOf({ 'borrowing.requestedAmount': 3_000 })),
    ).toEqual([])
    expect(suggestionsFor('personal_loan', contextOf({ 'borrowing.repaymentMonths': 3 }))).toEqual(
      [],
    )
    expect(suggestionsFor('personal_loan', contextOf({}))).toEqual([])
  })

  it('raises a card for a loan they mean to clear in months', () => {
    const [suggestion] = suggestionsFor(
      'personal_loan',
      contextOf({ 'borrowing.requestedAmount': 3_000, 'borrowing.repaymentMonths': 4 }),
    )

    expect(suggestion?.to).toBe('credit_card')
    // The honest framing: the card costs more, and the trade is not being tied to a term.
    expect(suggestion?.because).toMatch(/does not|ties them to a term/i)
    expect(suggestion?.because).toMatch(/€/)
    expect(suggestion?.strength).toBe('worth_raising')
  })

  it('leaves a loan alone when they mean to take their time', () => {
    expect(
      suggestionsFor(
        'personal_loan',
        contextOf({ 'borrowing.requestedAmount': 3_000, 'borrowing.repaymentMonths': 48 }),
      ),
    ).toEqual([])
  })

  /** The other direction, and a much bigger number. */
  it('raises a loan for a card balance they will carry for years', () => {
    const [suggestion] = suggestionsFor(
      'credit_card',
      contextOf({ 'borrowing.requestedAmount': 5_000, 'borrowing.repaymentMonths': 36 }),
    )

    expect(suggestion?.to).toBe('personal_loan')
    expect(suggestion?.strength).toBe('clearly_better')
    expect(suggestion?.because).toMatch(/more in interest/i)
  })

  it('does not bother them over a few euro', () => {
    // A small balance over eighteen months is barely different either way.
    expect(
      suggestionsFor(
        'credit_card',
        contextOf({ 'borrowing.requestedAmount': 300, 'borrowing.repaymentMonths': 18 }),
      ),
    ).toEqual([])
  })

  it('asks once whether they want to borrow money they already have', () => {
    const suggestions = suggestionsFor(
      'personal_loan',
      contextOf({
        'borrowing.requestedAmount': 4_000,
        'borrowing.repaymentMonths': 24,
        'assets.savingsBalance': 20_000,
      }),
    )

    const own = suggestions.find((item) => item.id === 'already_has_it')
    expect(own).toBeDefined()
    // Theirs to decide: keeping a reserve intact is a good reason not to.
    expect(own?.because).toMatch(/their decision/i)
  })

  it('leaves it alone when the savings would not cover it twice over', () => {
    const suggestions = suggestionsFor(
      'personal_loan',
      contextOf({
        'borrowing.requestedAmount': 4_000,
        'borrowing.repaymentMonths': 24,
        'assets.savingsBalance': 5_000,
      }),
    )

    expect(suggestions.find((item) => item.id === 'already_has_it')).toBeUndefined()
  })
})
