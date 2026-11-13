import { describe, expect, it } from 'vitest'
import { readProse, withProseRead } from './ccpc-prose.ts'
import { CCPC_ATTRIBUTION, type MarketProduct } from './schema.ts'

const row = (prose: Record<string, string>, rates?: MarketProduct['rates']): MarketProduct => ({
  provider: 'x',
  source: 'ccpc',
  productId: 'savings.c1',
  category: 'savings',
  providerProductName: 'Saver',
  rates: rates ?? { kind: 'deposit', aerPct: 3, basis: null },
  conditions: { prose, takesMonthly: true },
  sourceUrl: 'https://www.ccpc.ie/x',
  attribution: CCPC_ATTRIBUTION,
  unknown: ['rates.basis'],
  checkedAt: '2026-11-13T10:00:00.000Z',
  effectiveFrom: null,
})

describe('reading what CCPC’s own words state about a rate', () => {
  it('reads a fixed period: SuperSaver', () => {
    const read = readProse(
      row({ 'Introductory offers': 'Get a fixed regular savings rate for 12 months' }),
    )
    expect(read.fixedMonths).toBe(12)
    expect(read.conditional).toBeNull()
  })

  it('reads a rate for new customers that is a bonus rate: bunq', () => {
    const read = readProse(
      row({
        'Additional information':
          'Benefits:\n- 3.11% annual interest rate for new customers, paid weekly: After opening the account, the bonus rate applies up to a threshold based on your highest balance during the previous 6 months.',
      }),
    )
    expect(read.newAccountsOnly).toBe(true)
    expect(read.conditional).toMatch(/bonus rate applies up to a threshold/)
    expect(read.fixedMonths).toBeNull()
  })

  it('reads a bonus amount and its words, not a rate: MortgageSaver', () => {
    const read = readProse(
      row({
        'Introductory offers':
          '€2,000 top up on savings when customers draw down a BOI FTB mortgage',
        'Additional information':
          'Once the maximum threshold of €15,000 is reached, this total becomes a lump sum balance which earns 0.50% AER variable.',
      }),
    )
    expect(read.bonus).toEqual({
      amountEur: 2000,
      words: '€2,000 top up on savings when customers draw down a BOI FTB mortgage',
    })
    // A stated balance band is not a conditional rate.
    expect(read.conditional).toBeNull()
  })

  it('reads nothing into words that state nothing', () => {
    expect(
      readProse(
        row({ 'Additional information': 'Interest is subject to DIRT, where applicable.' }),
      ),
    ).toEqual({ fixedMonths: null, newAccountsOnly: false, bonus: null, conditional: null })
  })
})

describe('writing it into the fields CCPC left empty', () => {
  it('sets the fixed period with the rate after it unknown, and never overwrites a stated field', () => {
    const read = withProseRead(
      row({ 'Introductory offers': 'Get a fixed regular savings rate for 12 months' }),
    )
    expect(read.rates).toMatchObject({ basis: 'fixed', fixedMonths: 12 })
    expect(read.unknown).toEqual(['rates.thenAerPct'])

    const stated = withProseRead(
      row(
        { 'Introductory offers': 'Get a fixed regular savings rate for 12 months' },
        { kind: 'deposit', aerPct: 3, basis: 'fixed', termMonths: 12 },
      ),
    )
    expect(stated.rates).toEqual({ kind: 'deposit', aerPct: 3, basis: 'fixed', termMonths: 12 })
  })

  it('marks a rate for new customers', () => {
    expect(
      withProseRead(row({ x: 'A rate for new customers only.' })).conditions.rateForNewAccounts,
    ).toBe(true)
  })
})
