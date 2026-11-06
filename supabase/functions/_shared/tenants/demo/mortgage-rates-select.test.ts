import { describe, expect, it } from 'vitest'
import { PUBLISHED_RATES, mortgageRatesSection, selectRates } from './mortgage-rates-select.ts'

const ftb = { customerType: 'first_time_buyer' as const, ber: 'A' as const }

describe('selectRates', () => {
  it('offers the High Value Mortgage only once the amount reaches its floor', () => {
    const under = selectRates({ ...ftb, amountEur: 240_000 })
    const over = selectRates({ ...ftb, amountEur: 650_000 })

    expect(under.options.some((o) => o.familyLabel === 'High Value Mortgage')).toBe(false)
    expect(over.options.some((o) => o.familyLabel === 'High Value Mortgage')).toBe(true)
  })

  /*
   * The comparison the supplied pack asks for by name: the lowest headline rate carries no
   * cashback, so a card showing only the lowest number is the one that misleads.
   */
  it('puts a cashback rate beside the cheapest rate, not instead of it', () => {
    const { options } = selectRates({ ...ftb, amountEur: 650_000 })

    expect(options.some((o) => o.cashbackEur !== null)).toBe(true)
    expect(options.some((o) => o.cashbackEur === null)).toBe(true)
  })

  it('quotes cashback as money once the amount is known', () => {
    const { options } = selectRates({ ...ftb, amountEur: 650_000 })
    const withCashback = options.find((o) => o.cashbackEur !== null)

    expect(withCashback?.cashbackEur).toBe(13_000)
  })

  it('works out a monthly repayment only when it has a term as well', () => {
    expect(selectRates({ ...ftb, amountEur: 400_000 }).options[0]?.monthlyEur).toBeNull()
    expect(
      selectRates({ ...ftb, amountEur: 400_000, termYears: 30 }).options[0]?.monthlyEur,
    ).toBeGreaterThan(0)
  })

  it('prices a worse BER higher', () => {
    const a = selectRates({ ...ftb, amountEur: 650_000 }).options[0]?.ratePct ?? 0
    const g =
      selectRates({ customerType: 'first_time_buyer', ber: 'G', amountEur: 650_000 }).options[0]
        ?.ratePct ?? 0

    expect(g).toBeGreaterThan(a)
  })

  it('refuses to price A0 rather than treating it as A', () => {
    const result = selectRates({ customerType: 'first_time_buyer', ber: 'A0', amountEur: 650_000 })

    expect(result.options).toHaveLength(0)
    expect(result.unavailable).toMatch(/A0/)
  })

  it('keeps buy-to-let rates away from an owner-occupier, and the reverse', () => {
    const owner = selectRates({ ...ftb, amountEur: 400_000 })
    const landlord = selectRates({ customerType: 'buy_to_let_new', ber: 'A', amountEur: 400_000 })

    expect(owner.options.every((o) => !o.familyLabel.startsWith('Buy to let'))).toBe(true)
    expect(landlord.options.every((o) => o.familyLabel.startsWith('Buy to let'))).toBe(true)
  })

  it('never offers more than four, and never the same rate twice', () => {
    const { options } = selectRates({ ...ftb, amountEur: 650_000, termYears: 30 })
    expect(options.length).toBeLessThanOrEqual(4)
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length)
  })

  it('carries the date the rate table claims, not today', () => {
    expect(selectRates({ ...ftb, amountEur: 400_000 }).asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

/**
 * The table is handed in, not imported (§51).
 *
 * A presenter can edit a rate in the console, and the turn then reads rows rather than the
 * published file. What `selectRates` returns, and the date the prompt says the figures carry,
 * both have to follow the table it was given.
 */
describe('an edited rate table', () => {
  it('quotes the table it is handed, with its own date', () => {
    const edited = {
      asOf: '2026-10-16',
      rates: PUBLISHED_RATES.rates.map((rate) =>
        rate.id === 'new.standard.2y.a' ? { ...rate, interest_rate_pct: 1.11 } : rate,
      ),
    }

    const published = selectRates({ ...ftb, amountEur: 240_000, termYears: 25 })
    const changed = selectRates({ ...ftb, amountEur: 240_000, termYears: 25 }, edited)

    expect(published.options.some((o) => o.ratePct === 1.11)).toBe(false)
    expect(changed.options.some((o) => o.ratePct === 1.11)).toBe(true)
    expect(changed.asOf).toBe('2026-10-16')
    expect(mortgageRatesSection(edited)).toContain('as at 2026-10-16')
    expect(mortgageRatesSection()).toContain(`as at ${PUBLISHED_RATES.asOf}`)
  })
})
