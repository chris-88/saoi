import { describe, expect, it } from 'vitest'
import { allocatable, allocate } from './allocate.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { project } from './projection.ts'
import { MarketInputError } from './search.ts'

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-09'

describe('allocate', () => {
  const pool = allocatable(market.products, {
    includePlatforms: true,
    horizonMonths: 24,
    lockAllowed: true,
  })
  const allocation = allocate(pool, {
    lumpSum: 25_000,
    monthly: 800,
    horizonMonths: 24,
    lockAllowed: true,
    maxAccounts: 5,
    asOf: AS_OF,
  })

  it('places all of €25,000 and €800 a month', () => {
    expect(allocation.unplaced).toEqual({ lumpSum: 0, monthly: 0 })
    expect(allocation.lines.reduce((sum, line) => sum + line.lumpSum, 0)).toBeCloseTo(25_000, 2)
    expect(allocation.lines.reduce((sum, line) => sum + line.monthly, 0)).toBeCloseTo(800, 2)
    expect(allocation.lines.length).toBeLessThanOrEqual(5)
  })

  it('stays within every monthly cap and minimum', () => {
    for (const line of allocation.lines) {
      if (line.product.terms.kind !== 'deposit') throw new Error('not a deposit')
      if (line.monthly > 0) {
        expect(line.monthly).toBeLessThanOrEqual(line.product.terms.maxMonthlyEur ?? Infinity)
        expect(line.monthly).toBeGreaterThanOrEqual(line.product.terms.minMonthlyEur ?? 0)
      }
      if (line.lumpSum > 0) {
        expect(line.lumpSum).toBeGreaterThanOrEqual(line.product.terms.minLumpSumEur ?? 0)
      }
    }
  })

  it('puts the lump sum in a term that ends by the horizon', () => {
    const lump = allocation.lines.find((line) => line.lumpSum > 0)
    expect(lump?.product.terms.kind === 'deposit' && lump.product.terms.access).toBe('fixed_term')
    expect(lump?.termMonths).toBe(24)
  })

  it('locks nothing away when the date is not known', () => {
    const open = allocatable(market.products, {
      includePlatforms: true,
      horizonMonths: 24,
      lockAllowed: false,
    })
    expect(
      open.every(
        (product) => product.terms.kind === 'deposit' && product.terms.access === 'instant',
      ),
    ).toBe(true)
  })

  it('keeps any one provider within the €100,000 guarantee', () => {
    const big = allocate(pool, {
      lumpSum: 400_000,
      monthly: 0,
      horizonMonths: 24,
      lockAllowed: true,
      maxAccounts: 8,
      asOf: AS_OF,
    })
    const byProvider = new Map<string, number>()
    for (const line of big.lines) {
      byProvider.set(
        line.product.provider,
        (byProvider.get(line.product.provider) ?? 0) + line.lumpSum,
      )
    }
    for (const total of byProvider.values()) expect(total).toBeLessThanOrEqual(100_000)
  })
})

describe('project', () => {
  it('projects named products month by month and reports when a goal is reached', () => {
    const result = project(
      market,
      {
        horizonMonths: 24,
        lines: [
          { productId: 'nordax:deposit.c7830', lumpSum: 25_000 },
          { productId: 'boi:savings.supersaver', monthly: 800 },
        ],
        targetAmount: 40_000,
      },
      AS_OF,
    )
    expect(result.totals.knownThroughMonth).toBe(24)
    expect(result.totals.months).toHaveLength(24)
    expect(result.totals.months[0]?.date).toBe('2026-12')
    expect(result.totals.paidIn).toBe(25_000 + 800 * 24)
    expect(result.goal?.reachedMonth).not.toBeNull()
    // €25,000 + €800 × 19 = €40,200 before interest: reached by month 19 at the latest.
    expect(result.goal?.reachedMonth ?? 99).toBeLessThanOrEqual(19)
  })

  it('stops the totals where a line’s rate runs out, and says so', () => {
    const result = project(
      market,
      {
        horizonMonths: 12,
        lines: [
          { productId: 'raisin_bank:deposit.c8504', lumpSum: 10_000 },
          { productId: 'aib:savings.c396', monthly: 500 },
        ],
      },
      AS_OF,
    )
    expect(result.totals.knownThroughMonth).toBe(3)
    expect(result.lines[1]?.months).toHaveLength(12)
    expect(result.assumptions.join(' ')).toMatch(/totals stop at month 3/)
    expect(result.lines[0]?.notes.join(' ')).toMatch(/not stated/)
  })

  it('accepts a row id folded into a ladder', () => {
    const result = project(
      market,
      { horizonMonths: 12, lines: [{ productId: 'aib:deposit.c3743', lumpSum: 10_000 }] },
      AS_OF,
    )
    expect(result.lines[0]?.product.id).toBe('aib:deposit.ladder_personal_fixed_term_deposit')
    expect(result.lines[0]?.termMonths).toBe(12)
  })

  it('finds the best available split when no products are named', () => {
    const result = project(market, { horizonMonths: 24, lumpSum: 25_000, monthly: 800 }, AS_OF)
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.basis).toMatch(/best available/)
  })

  it('refuses an unknown product', () => {
    expect(() =>
      project(market, { horizonMonths: 12, lines: [{ productId: 'x:y' }] }, AS_OF),
    ).toThrow(MarketInputError)
  })
})
