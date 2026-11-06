import { describe, expect, it } from 'vitest'
import {
  monthsFor,
  monthsToSave,
  principalFor,
  repaymentFor,
  savedAfter,
  totalPaid,
} from './maths.ts'

/**
 * The sums Saoirse used to do in prose.
 *
 * The rates these run on are invented; the arithmetic is not. A repayment figure is the kind of
 * wrong a customer acts on, so it is computed and tested rather than written by a model.
 */
describe('what a loan costs', () => {
  it('works out a monthly repayment', () => {
    // €600,000 over 30 years at 3.1%: a shade over €2,560.
    const monthly = repaymentFor(600_000, 0.031, 360)
    expect(Math.round(monthly)).toBe(2562)
  })

  it('charges nothing extra at a rate of zero', () => {
    expect(repaymentFor(12_000, 0, 12)).toBe(1_000)
  })

  it('refuses to quote on nothing', () => {
    expect(repaymentFor(0, 0.05, 240)).toBe(0)
    expect(repaymentFor(10_000, 0.05, 0)).toBe(0)
  })

  it('totals the whole term', () => {
    expect(totalPaid(1_000, 60)).toBe(60_000)
  })
})

describe('solving for the missing number', () => {
  /** "I want a €30,000 car and about €400 a month" — the term is what they are really asking. */
  it('works out the term from a budget', () => {
    // Nine years: €43,200 paid on a €30,000 loan, so €13,200 of interest at 8.5%.
    expect(monthsFor(30_000, 0.085, 400)).toBe(108)
  })

  /**
   * A payment that never clears the interest never clears the loan. "About six hundred years" is
   * arithmetically true and useless; the customer needs to be told the payment is too small.
   */
  it('says a payment is too small rather than quoting six hundred years', () => {
    expect(monthsFor(30_000, 0.085, 50)).toBeNull()
    expect(monthsFor(30_000, 0.085, 0)).toBeNull()
  })

  it('works out what a budget will buy', () => {
    // The same €400 over a shorter term buys less, which is the trade-off the card exists
    // to show.
    expect(Math.round(principalFor(400, 0.085, 90))).toBe(26_552)
    expect(Math.round(principalFor(400, 0.085, 108))).toBe(30_122)
  })

  it('agrees with itself in both directions', () => {
    const monthly = repaymentFor(25_000, 0.07, 60)
    expect(monthsFor(25_000, 0.07, monthly)).toBe(60)
  })
})

describe('what saving builds up to', () => {
  it('adds interest to regular deposits', () => {
    // €200 a month for two years at 3% is a little over the €4,800 paid in.
    const saved = savedAfter(200, 0.03, 24)
    expect(saved).toBeGreaterThan(4_800)
    expect(Math.round(saved)).toBe(4_941)
  })

  it('compounds what was already there', () => {
    expect(Math.round(savedAfter(0, 0.12, 12, 1_000))).toBe(1_127)
  })

  it('works out how long a target takes', () => {
    // €14,000 short at €2,300 a month: about six months, which is the §48 conversation.
    expect(monthsToSave(60_000, 2_300, 0.02, 46_000)).toBe(6)
  })

  it('is already there when the target is met', () => {
    expect(monthsToSave(10_000, 500, 0.02, 10_000)).toBe(0)
  })

  it('says never rather than guessing when nothing is going in', () => {
    expect(monthsToSave(10_000, 0, 0.02, 100)).toBeNull()
  })
})
