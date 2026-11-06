import { describe, expect, it } from 'vitest'
import { monthlyRepayment, paidDuringFixedPeriod, totalRepaid } from './mortgage.ts'

describe('monthlyRepayment', () => {
  /*
   * The textbook case, to two decimal places. Pinned because every other test here checks a
   * relationship rather than a value, and a formula that is consistently wrong satisfies all of
   * those happily.
   */
  it('matches the standard annuity figure', () => {
    expect(monthlyRepayment(100_000, 5, 30)).toBeCloseTo(536.82, 2)
    expect(monthlyRepayment(300_000, 3.5, 30)).toBeCloseTo(1347.13, 2)
  })

  it('divides evenly at a zero rate rather than dividing by zero', () => {
    expect(monthlyRepayment(120_000, 0, 10)).toBeCloseTo(1000, 6)
  })

  it('costs more at a higher rate and less over a longer term', () => {
    expect(monthlyRepayment(250_000, 4, 25)).toBeGreaterThan(monthlyRepayment(250_000, 3, 25))
    expect(monthlyRepayment(250_000, 4, 35)).toBeLessThan(monthlyRepayment(250_000, 4, 25))
  })

  it('is zero for nothing borrowed and for no term', () => {
    expect(monthlyRepayment(0, 4, 25)).toBe(0)
    expect(monthlyRepayment(250_000, 4, 0)).toBe(0)
  })
})

describe('what a term costs', () => {
  it('repays more than was borrowed', () => {
    expect(totalRepaid(250_000, 3.5, 30)).toBeGreaterThan(250_000)
  })

  it('counts only the fixed period, not the whole term', () => {
    const four = paidDuringFixedPeriod(400_000, 3.1, 30, 4)
    expect(four).toBeCloseTo(monthlyRepayment(400_000, 3.1, 30) * 48, 6)
    expect(four).toBeLessThan(totalRepaid(400_000, 3.1, 30))
  })

  it('does not run past the end of the mortgage', () => {
    // A ten-year fix on a five-year mortgage is five years of payments, not ten.
    expect(paidDuringFixedPeriod(100_000, 3, 5, 10)).toBeCloseTo(
      paidDuringFixedPeriod(100_000, 3, 5, 5),
      6,
    )
  })
})
