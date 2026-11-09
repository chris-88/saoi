import { describe, expect, it } from 'vitest'
import type { DepositTerms, ProductView } from '../../contracts/market-tools.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { addMonths, annuityPayment, bestRung, simulateDeposit } from './simulate.ts'

const market = normaliseMarket(MARKET_FIXTURE)
const terms = (id: string): DepositTerms => {
  const product: ProductView | undefined = market.products.find((p) => p.id === id)
  if (product?.terms.kind !== 'deposit') throw new Error(`no deposit ${id}`)
  return product.terms
}

const flat = (aerPct: number, overrides: Partial<DepositTerms> = {}): DepositTerms => ({
  kind: 'deposit',
  access: 'instant',
  noticeDays: 0,
  aerPct,
  basis: 'variable',
  bands: [{ fromEur: 0, toEur: null, aerPct }],
  lumpSumAerPct: null,
  introductory: null,
  ladder: [],
  takesMonthly: true,
  takesLumpSum: true,
  minMonthlyEur: null,
  maxMonthlyEur: null,
  minLumpSumEur: null,
  maxLumpSumEur: null,
  dirtApplies: true,
  bonus: null,
  ...overrides,
})

describe('simulateDeposit', () => {
  it('earns exactly the AER on a lump sum over a year, less DIRT at 33%', () => {
    const { figures } = simulateDeposit(flat(2), { lumpSum: 10_000, monthly: 0, horizonMonths: 12 })
    expect(figures.grossInterest).toBeCloseTo(200, 2)
    expect(figures.dirt).toBeCloseTo(66, 2)
    expect(figures.netInterest).toBeCloseTo(134, 2)
    expect(figures.endBalance).toBeCloseTo(10_134, 2)
    expect(figures.netRatePct).toBeCloseTo(1.34, 2)
    expect(figures.stop).toBeNull()
  })

  it('pays no DIRT where none applies', () => {
    const { figures } = simulateDeposit(flat(2, { dirtApplies: false }), {
      lumpSum: 10_000,
      monthly: 0,
      horizonMonths: 12,
    })
    expect(figures.netInterest).toBeCloseTo(200, 2)
  })

  it('honours a monthly cap and says what it could not take', () => {
    const { figures } = simulateDeposit(terms('boi:savings.supersaver'), {
      lumpSum: 5_000,
      monthly: 3_000,
      horizonMonths: 12,
    })
    expect(figures.paidIn).toBe(2_500 * 12)
    expect(figures.notPlaced).toEqual({ lumpSum: 5_000, monthly: 500 })
  })

  it('pays a tier’s rate only within the tier', () => {
    // AIB Online Saver: 3% to €12,000, 0.25% above. €1,000 a month for 24 months.
    const banded = simulateDeposit(terms('aib:savings.c396'), {
      lumpSum: 0,
      monthly: 1_000,
      horizonMonths: 24,
    }).figures
    const flatThree = simulateDeposit(flat(3), {
      lumpSum: 0,
      monthly: 1_000,
      horizonMonths: 24,
    }).figures
    expect(banded.netInterest).toBeLessThan(flatThree.netInterest)
    expect(banded.netInterest).toBeGreaterThan(0)
  })

  it('moves to the stated reversion rate after an introductory period', () => {
    const supersaver = terms('boi:savings.supersaver')
    const two = simulateDeposit(supersaver, { lumpSum: 0, monthly: 800, horizonMonths: 24 }).figures
    expect(two.knownMonths).toBe(24)
    expect(two.stop).toBeNull()
    // Slower in year two (2%) than a flat 3% would be.
    const flatThree = simulateDeposit(flat(3), {
      lumpSum: 0,
      monthly: 800,
      horizonMonths: 24,
    }).figures
    expect(two.netInterest).toBeLessThan(flatThree.netInterest)
  })

  it('stops at the end of an introductory period whose reversion is unknown, and says so', () => {
    const { figures, months } = simulateDeposit(terms('raisin_bank:deposit.c8504'), {
      lumpSum: 10_000,
      monthly: 0,
      horizonMonths: 12,
    })
    expect(figures.knownMonths).toBe(3)
    expect(months).toHaveLength(3)
    expect(figures.stop?.afterMonths).toBe(3)
    expect(figures.stop?.reason).toMatch(/not stated/)
  })

  it('stops at the end of a fixed term shorter than the horizon', () => {
    const { figures } = simulateDeposit(terms('nordax:deposit.c7830'), {
      lumpSum: 10_000,
      monthly: 0,
      horizonMonths: 36,
    })
    expect(figures.termMonths).toBe(24)
    expect(figures.knownMonths).toBe(24)
    expect(figures.stop?.reason).toMatch(/term ends/)
  })

  it('places no lump sum where taking one is not known', () => {
    const { figures } = simulateDeposit(terms('aib:savings.c396'), {
      lumpSum: 25_000,
      monthly: 0,
      horizonMonths: 12,
    })
    expect(figures.notPlaced.lumpSum).toBe(25_000)
    expect(figures.paidIn).toBe(0)
  })

  it('refuses a lump sum below the minimum', () => {
    const { figures } = simulateDeposit(terms('aib:deposit.ladder_personal_fixed_term_deposit'), {
      lumpSum: 1_000,
      monthly: 0,
      horizonMonths: 12,
    })
    expect(figures.notPlaced.lumpSum).toBe(1_000)
  })
})

describe('bestRung', () => {
  it('takes the longest term that ends by the horizon', () => {
    const ladder = terms('aib:deposit.ladder_personal_fixed_term_deposit').ladder
    expect(bestRung(ladder, 24)?.months).toBe(24)
    expect(bestRung(ladder, 18)?.months).toBe(12)
    expect(bestRung(ladder, 5)).toBeNull()
  })
})

describe('helpers', () => {
  it('adds months to a date', () => {
    expect(addMonths('2026-11-09', 1)).toBe('2026-12')
    expect(addMonths('2026-11-09', 24)).toBe('2028-11')
  })

  it('works out an annuity payment', () => {
    expect(annuityPayment(10_000, 0, 10)).toBeCloseTo(1_000, 6)
    // €300,000 over 30 years at 4% nominal: €1,432.25 a month.
    expect(annuityPayment(300_000, 4 / 1200, 360)).toBeCloseTo(1432.25, 1)
  })
})
