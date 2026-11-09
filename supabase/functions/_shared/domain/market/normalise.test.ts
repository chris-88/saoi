import { describe, expect, it } from 'vitest'
import type { ProductView } from '../../contracts/market-tools.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import type { MarketRecord } from './types.ts'

const market = normaliseMarket(MARKET_FIXTURE)
/** With Raisin's platform banks, which the comparison leaves out: for the tests about them. */
const withPlatforms = normaliseMarket(MARKET_FIXTURE, { includePlatforms: true })
const view = (id: string): ProductView => {
  const found = [...market.products, ...withPlatforms.products].find((product) => product.id === id)
  if (found === undefined) throw new Error(`no view ${id}`)
  return found
}
const deposit = (id: string) => {
  const terms = view(id).terms
  if (terms.kind !== 'deposit') throw new Error(`${id} is not a deposit`)
  return terms
}

describe('normaliseMarket', () => {
  it('folds CCPC’s one-row-per-term fixed deposits into a ladder per product', () => {
    const aib = deposit('aib:deposit.ladder_personal_fixed_term_deposit')
    expect(aib.access).toBe('fixed_term')
    expect(aib.ladder.map((rung) => [rung.months, rung.aerPct, rung.productId])).toEqual([
      [6, 1.5, 'deposit.c5063'],
      [12, 2, 'deposit.c3743'],
      [24, 2.26, 'deposit.c5065'],
    ])
    expect(view('aib:deposit.ladder_personal_fixed_term_deposit').provenance.rows).toHaveLength(3)
    // The rows themselves are not also listed on their own.
    expect(market.products.some((product) => product.id === 'aib:deposit.c3743')).toBe(false)
    expect(market.viewOfRow.get('aib:deposit.c3743')).toBe(
      'aib:deposit.ladder_personal_fixed_term_deposit',
    )
  })

  it('keeps a single fixed term as a ladder of one', () => {
    const nordax = deposit('nordax:deposit.c7830')
    expect(nordax.access).toBe('fixed_term')
    expect(nordax.ladder).toEqual([{ months: 24, aerPct: 3.45, productId: 'deposit.c7830' }])
  })

  it('prefers the bank’s own row over CCPC’s for the same Bank of Ireland product, and says so', () => {
    const supersaver = view('boi:savings.supersaver')
    expect(supersaver.provenance.source).toBe('bank')
    expect(supersaver.provenance.preferredOver).toEqual([
      { source: 'ccpc', productId: 'savings.c5047', providerProductName: 'SuperSaver Account' },
    ])
    expect(market.products.some((product) => product.id === 'boi:savings.c5047')).toBe(false)
    expect(market.viewOfRow.get('boi:savings.c5047')).toBe('boi:savings.supersaver')

    const advantage = view('boi:savings.advantage_fixed')
    expect(advantage.provenance.preferredOver.map((row) => row.productId).sort()).toEqual([
      'deposit.c4161',
      'deposit.c5330',
      'deposit.c5596',
    ])
    // A different product with a similar name is not paired.
    expect(view('boi:deposit.c505').name).toBe('31 Day Set Notice Account')
  })

  it('reads the bank row’s reversion: SuperSaver is 3% for 12 months, then 2%', () => {
    const terms = deposit('boi:savings.supersaver')
    expect(terms.introductory).toEqual({ months: 12, thenAerPct: 2 })
    expect(terms.bands).toEqual([
      { fromEur: 0, toEur: 30000, aerPct: 3 },
      { fromEur: 30000, toEur: null, aerPct: 0.5 },
    ])
    expect(terms.maxMonthlyEur).toBe(2500)
  })

  it('flags Raisin-platform products and the home country’s deposit guarantee', () => {
    const nordax = view('nordax:deposit.c8901')
    expect(nordax.platform?.name).toBe('Raisin')
    expect(nordax.providerName).toBe('Nordax Bank')
    expect(nordax.depositGuarantee).toMatchObject({
      country: 'Sweden',
      coverEur: 100000,
      basis: 'stated_by_source',
    })
    expect(nordax.checks.some((check) => /Raisin/.test(check))).toBe(true)

    // Named in lower case, and on a ladder.
    expect(view('creditplus:deposit.ladder_fixed_term_deposit').depositGuarantee?.country).toBe(
      'Germany',
    )
    // Raisin Bank itself is reached through the platform too.
    expect(view('raisin_bank:deposit.c8504').platform?.name).toBe('Raisin')
    // A foreign bank that is not on the platform: guarantee, no platform.
    const bunq = view('bunq:deposit.bunq_savings')
    expect(bunq.platform).toBeNull()
    expect(bunq.depositGuarantee?.country).toBe('Netherlands')
    // An Irish bank: recorded by Saoi, not stated by CCPC.
    expect(view('aib:savings.c396').depositGuarantee).toMatchObject({
      country: 'Ireland',
      basis: 'recorded_by_saoi',
    })
  })

  it('treats an introductory rate with no stated reversion as a period that ends, not a rate that holds', () => {
    const raisin = deposit('raisin_bank:deposit.c8504')
    expect(raisin.access).toBe('instant')
    expect(raisin.introductory).toEqual({ months: 3, thenAerPct: null })
    expect(view('raisin_bank:deposit.c8504').unknowns.map((u) => u.field)).toContain(
      'rates.thenAerPct',
    )
  })

  it('knows State Savings is DIRT-free and State-guaranteed', () => {
    const bonds = view('state_savings:deposit.c120')
    expect(bonds.terms.kind === 'deposit' && bonds.terms.dirtApplies).toBe(false)
    expect(bonds.depositGuarantee?.basis).toBe('recorded_by_saoi')
    expect(deposit('aib:savings.c396').dirtApplies).toBe(true)
  })

  it('carries unknowns, never filling them in', () => {
    const saver = view('aib:savings.c396')
    const terms = deposit('aib:savings.c396')
    expect(saver.unknowns.map((u) => u.field)).toEqual(
      expect.arrayContaining(['rates.basis', 'conditions.takesLumpSum']),
    )
    expect(terms.basis).toBeNull()
    expect(terms.takesLumpSum).toBeNull()
    expect(terms.bands).toEqual([
      { fromEur: 0, toEur: 12000, aerPct: 3 },
      { fromEur: 12000, toEur: null, aerPct: 0.25 },
    ])
  })

  it('reads a loan’s maximum term in the unit CCPC states, and not at all without one', () => {
    // CCPC says "10 Years"; the stored `maxTermMonths` is 10. The words win.
    const aib = view('aib:loan.c174')
    expect(aib.terms.kind === 'loan' && aib.terms.maxTermMonths).toBe(120)
    const boi = view('boi:loan.c584')
    expect(boi.terms.kind === 'loan' && boi.terms.maxTermMonths).toBe(60)
    // "7", no unit: not read.
    const anPost = view('an_post_money:loan.c1520')
    expect(anPost.terms.kind === 'loan' && anPost.terms.maxTermMonths).toBeNull()
    expect(anPost.unknowns.map((u) => u.field)).toContain('rates.maxTermMonths')
  })

  it('carries provenance: checked, last changed, attribution', () => {
    const saver = view('aib:savings.c396')
    expect(saver.provenance.source).toBe('ccpc')
    expect(saver.provenance.attribution).toMatch(/Competition and Consumer Protection Commission/)
    expect(saver.provenance.lastChangedAt).toBeNull()

    const older: MarketRecord[] = MARKET_FIXTURE.filter(
      (record) => record.product.productId === 'savings.c396',
    ).map((record) => ({
      product: { ...record.product, providerProductName: 'Online Saver (old)' },
      firstSeenAt: '2026-10-01T00:00:00.000Z',
      supersededAt: '2026-11-02T00:00:00.000Z',
    }))
    const current = MARKET_FIXTURE.map((record) =>
      record.product.productId === 'savings.c396'
        ? { ...record, firstSeenAt: '2026-11-02T00:00:00.000Z' }
        : record,
    )
    const withHistory = normaliseMarket([...older, ...current])
    const changed = withHistory.products.find((product) => product.id === 'aib:savings.c396')
    expect(changed?.provenance.lastChangedAt).toBe('2026-11-02T00:00:00.000Z')
    expect(changed?.provenance.firstRecordedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(withHistory.recordsOf.get('aib:savings.c396')).toHaveLength(2)
  })

  it('reads a mortgage’s BER from its name where CCPC leaves the field empty', () => {
    const boiBer = market.products.find(
      (product) =>
        product.provider === 'boi' &&
        product.terms.kind === 'mortgage' &&
        / BER [A-G]/.test(product.name),
    )
    expect(boiBer?.terms.kind === 'mortgage' && boiBer.terms.berFromName).toBe(true)
  })

  it('reads bunq from its own page: a bonus that gives way to base rates at each reset', () => {
    const bunq = view('bunq:deposit.bunq_savings')
    expect(bunq.provenance.source).toBe('bank')
    expect(bunq.provenance.preferredOver.map((row) => row.productId)).toEqual(['deposit.c3147'])
    expect(market.viewOfRow.get('bunq:deposit.c3147')).toBe('bunq:deposit.bunq_savings')
    expect(view('bunq:savings.bunq_savings').provenance.source).toBe('bank')
    expect(bunq.terms.kind === 'deposit' && bunq.terms.thresholdBonus).toMatchObject({
      bonusAerPct: 3.11,
      resetMonths: [1, 7],
      lookbackMonths: 6,
    })
    expect(bunq.depositGuarantee?.country).toBe('Netherlands')
    expect(bunq.checks.join(' ')).toMatch(/may not take DIRT at source/)
    expect(view('aib:savings.c396').checks.join(' ')).not.toMatch(/DIRT at source/)
  })

  it('reads MoCo from its own pages: the rate confirmed, who can open it stated', () => {
    const moco = view('moco:deposit.moco_easysaver')
    expect(moco.provenance.source).toBe('bank')
    expect(moco.provenance.preferredOver.map((row) => row.productId)).toEqual(['deposit.c8548'])
    expect(market.viewOfRow.get('moco:deposit.c8548')).toBe('moco:deposit.moco_easysaver')
    expect(moco.rateConfirmed).toBe(true)
    expect(moco.eligibility).toEqual({
      minAge: 18,
      residentIn: 'Ireland',
      notForUsCitizens: true,
      individualsOnly: true,
      jointAccounts: false,
      needsAccountWithProvider: null,
    })
    expect(moco.terms.kind === 'deposit' && moco.terms.interestPaid).toBe('daily')
    expect(moco.terms.kind === 'deposit' && moco.terms.rateForNewAccounts).toBe(true)
    const checks = moco.checks.join(' ')
    expect(checks).toMatch(/aged 18 or over, resident in Ireland, not a US citizen/)
    expect(checks).toMatch(/rate for new accounts/)
    expect(checks).not.toMatch(/who can open it is not recorded|CCPC does not record/)
    for (const check of moco.checks) expect(check.length).toBeLessThanOrEqual(200)
    expect(view('aib:savings.c396').eligibility).toBeNull()
  })

  it('marks a rate resting on CCPC’s one figure as not confirmed', () => {
    expect(view('aib:savings.c396').rateConfirmed).toBe(false)
    expect(view('banca_cf:deposit.c7028').rateConfirmed).toBe(false)
    expect(view('bunq:savings.bunq_savings').rateConfirmed).toBe(true)
    expect(view('boi:savings.supersaver').rateConfirmed).toBe(true)
    expect(view('nordax:deposit.c7830').rateConfirmed).toBe(true)
    expect(view('aib:loan.c174').rateConfirmed).toBe(true)
  })

  it('compares only providers that operate in Ireland: Raisin’s platform banks are left out', () => {
    const providers = new Set(market.products.map((product) => product.provider))
    for (const raisin of [
      'nordax',
      'banca_cf',
      'creditplus',
      'ibl_banca',
      'aareal',
      'raisin_bank',
    ]) {
      expect(providers.has(raisin), raisin).toBe(false)
    }
    for (const irish of ['boi', 'aib', 'bunq', 'avant_money', 'moco', 'state_savings']) {
      expect(providers.has(irish), irish).toBe(true)
    }
    expect(market.products.every((product) => product.platform === null)).toBe(true)
    expect(market.viewOfRow.has('nordax:deposit.c7830')).toBe(false)
    expect(withPlatforms.products.some((product) => product.provider === 'nordax')).toBe(true)
  })

  it('flags eligibility it cannot confirm on every product', () => {
    for (const product of market.products) {
      expect(product.checks.length, product.id).toBeGreaterThan(0)
    }
  })
})

describe('deposit guarantees, from primary pages', () => {
  it('records MoCo under the Austrian scheme, with its source and date', () => {
    const moco = view('moco:deposit.moco_easysaver')
    expect(moco.depositGuarantee).toMatchObject({
      country: 'Austria',
      coverEur: 100_000,
      basis: 'recorded_by_saoi',
      checkedOn: '2026-11-09',
    })
    expect(moco.depositGuarantee?.sourceUrl).toMatch(/^https:\/\/www\.moco\.ie\//)
    expect(moco.depositGuarantee?.note).toMatch(/BAWAG/)
    expect(moco.unknowns.map((u) => u.field)).not.toContain('depositGuarantee')
  })

  it('records every Irish deposit-taker it compares, each with a source', () => {
    for (const id of ['aib:savings.c396', 'boi:savings.supersaver', 'state_savings:deposit.c120']) {
      const guarantee = view(id).depositGuarantee
      expect(guarantee?.basis).toBe('recorded_by_saoi')
      expect(guarantee?.sourceUrl).toMatch(/^https:\/\//)
    }
    expect(view('state_savings:deposit.c120').depositGuarantee?.coverEur).toBeNull()
  })

  it('leaves an unrecorded provider unknown, and names it', () => {
    const records: MarketRecord[] = MARKET_FIXTURE.filter(
      (record) => record.product.provider === 'moco' && record.product.source === 'ccpc',
    ).map((record) => ({ ...record, product: { ...record.product, provider: 'newbank' } }))
    const unknown = normaliseMarket(records).products[0]
    expect(unknown?.depositGuarantee?.basis).toBe('unknown')
    expect(unknown?.depositGuarantee?.scheme).toBeNull()
    expect(unknown?.unknowns.map((u) => u.field)).toContain('depositGuarantee')
  })
})

describe('mortgage cashback in CCPC prose', () => {
  it('reads "1 percent at drawdown" when the cashback field states no yes or no', () => {
    const base = MARKET_FIXTURE.find((record) => record.product.category === 'mortgage')
    if (base === undefined) throw new Error('no mortgage in the fixture')
    const rates = base.product.rates
    if (rates.kind !== 'mortgage') throw new Error('not a mortgage')
    const avant: MarketRecord = {
      ...base,
      product: {
        ...base.product,
        provider: 'avant_money',
        productId: 'mortgage.c9999',
        rates: { ...rates, cashback: null },
        conditions: {
          details: { Cashback: '1%', 'Cashback description': '1 percent at drawdown' },
        },
      },
    }
    const terms = normaliseMarket([avant]).products[0]?.terms
    expect(terms?.kind === 'mortgage' && terms.cashback).toEqual({
      offered: true,
      pct: 1,
      stated: '1 percent at drawdown',
    })
  })
})
