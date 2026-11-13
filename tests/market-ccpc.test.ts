import { describe, expect, it } from 'vitest'
import {
  CCPC_ATTRIBUTION,
  type MarketProduct,
  marketProductSchema,
} from '../supabase/functions/_shared/market/schema.ts'
import {
  type Built,
  type CcpcItem,
  creditCard,
  currentAccount,
  loan,
  loanTermMonths,
  lumpSum,
  merge,
  mortgage,
  numberIn,
  regularFixedMonths,
  regularSaving,
} from '../scripts/market/ccpc.ts'
import { providerFor } from '../scripts/market/ccpc-providers.ts'

/**
 * CCPC items as compare.ccpc.ie served them on 2026-11-09, trimmed to the fields that matter.
 * The numbered keys are CCPC's own field ids; their labels are what the builders read.
 */

const f = (entries: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(entries).map(([name, value], i) => [
      String(100 + i),
      { Name: name, Value: value },
    ]),
  )

const SUPERSAVER: CcpcItem = {
  Id: 5047,
  ProductName: 'SuperSaver Account',
  ProviderName: 'Bank of Ireland',
  Website:
    'https://personalbanking.bankofireland.com/save-and-invest/savings/regular-savings-accounts/supersaver-account/features-and-benefits/',
  AdditionalInformation: '',
  FootNotes: [],
  Rate: 3,
  TierList: [
    { Id: 1, MinimumAmount: 0, MaximumAmount: 30000, Rate: 3, SecondRate: 0 },
    { Id: 2, MinimumAmount: 30001, MaximumAmount: 100000, Rate: 0.5, SecondRate: null },
  ],
  ...f({
    'Interest rate(AER):': '3.00',
    'Introductory offers:': 'Get a fixed regular savings rate for 12 months',
    'Minimum lodgement per month:': '€5',
    'Maximum lodgement per month:': '€2,500',
    'Withdrawal notice period:': 'Instant access',
  }),
}

const AIB_ONLINE_SAVER: CcpcItem = {
  Id: 396,
  ProductName: 'Online Saver',
  ProviderName: 'AIB',
  Website: 'personal.aib.ie/our-products/savings-and-deposits/online-saver',
  Rate: 3,
  TierList: [
    { Id: 1468, MinimumAmount: 10, MaximumAmount: 12000, Rate: 3, SecondRate: 0 },
    { Id: 1643, MinimumAmount: 12000.01, MaximumAmount: 1000000, Rate: 0.25, SecondRate: null },
  ],
  ...f({
    'Interest rate(AER):': '3.00',
    'Introductory offers:': 'None',
    'Minimum lodgement per month:': '€10',
    'Maximum lodgement per month:': 'No Max (Subject to Total maximum savings)',
  }),
}

const ADVANTAGE_12: CcpcItem = {
  Id: 4161,
  ProductName: 'Advantage 12 Month Fixed Term Account 25% Access',
  ProviderName: 'Bank of Ireland',
  Website:
    'https://personalbanking.bankofireland.com/save-and-invest/savings/fixed-term-savings-accounts/advantage-deposit-account/features-and-benefits/',
  Rate: 2.4,
  ...f({
    'Maximum lodgement:': 'No maximum amount',
    'Minimum lodgement:': '€5,000',
    'Additional lodgements:': 'No',
    'AER:': '2.40',
    'Introductory offers:': 'No',
    'Rate type:': 'Fixed Rate',
    'Term in months:': '12',
    'Notice period in days:': '0',
  }),
}

const RAISIN_FIXED: CcpcItem = {
  Id: 9001,
  ProductName: '6 month fixed term deposit',
  ProviderName: 'Creditplus Bank  via Raisin',
  Website: null,
  Rate: 2.92,
  ...f({
    'AER:': '2.92',
    'Rate type:': 'Fixed',
    'Minimum lodgement:': '1000',
    'Term in months:': '6',
  }),
}

const HVM: CcpcItem = {
  Id: 7642,
  ProductName: '1 Year HVM BER B',
  ProviderName: 'Bank of Ireland',
  Website: 'https://personalbanking.bankofireland.com/borrow/mortgages/',
  AdditionalInformation:
    '<p><strong>Application via broker -</strong>&nbsp;Available through selected brokers only</p>',
  SubProductType: '1 Year fixed',
  DiscountedRate: 3.35,
  DiscountedTerm: 1,
  FollowOnRate: 4.15,
  FullRate: 4.2,
  BER: 'B',
  ...f({ 'Minimum LTV:': '0', 'Maximum LTV:': '90', Cashback: 'No' }),
}

const LOAN: CcpcItem = {
  Id: 2239,
  ProductName: 'Green home improvement loan',
  ProviderName: 'Bank of Ireland',
  MaximumTerm: 10,
  MaximumAmount: 75000,
  Rate: 6.5,
  ...f({
    'Rate type:': 'Variable',
    'Maximum term:': '120 months',
    'Home improvements': '1',
    'Home energy upgrade loans (SCBI)': '1',
    'Personal loans': '0',
  }),
}

const CARD: CcpcItem = {
  Id: 1022,
  ProductName: 'Aer Credit Card',
  ProviderName: 'Bank of Ireland',
  LastEdited: '2026-04-14T09:01:31.857',
  ...f({
    'APR:': '22.7',
    'Annual (nominal) interest rate charged on purchases:': '14',
    'Annual (nominal) interest rate charged on cash withdrawals:': '21.36',
    'Introductory period on balances transferred (in months)': '7',
    'Introductory APR on balances transferred': '0',
  }),
}

const ACCOUNT: CcpcItem = {
  Id: 68,
  ProductName: 'Personal Current Account',
  ProviderName: 'Bank of Ireland',
  LastEdited: '2026-04-08T08:38:53.263',
  ...f({
    'Maintaining the account (quarterly fee):': '€18.00 **',
    'Interest earned on credit balance:': '0%',
    'Overdraft:': 'Yes',
  }),
}

const checked = (built: Built): MarketProduct =>
  marketProductSchema.parse({ ...built.product, checkedAt: '2026-11-09T12:00:00.000Z' })

describe('reading CCPC items', () => {
  it('reads a regular saver with every tier, and names what CCPC does not say', () => {
    const product = checked(regularSaving(SUPERSAVER))

    expect(product).toMatchObject({
      provider: 'boi',
      source: 'ccpc',
      productId: 'savings.c5047',
      sourceProductId: '5047',
      attribution: CCPC_ATTRIBUTION,
      rates: {
        kind: 'deposit',
        aerPct: 3,
        // "a fixed regular savings rate for 12 months": fixed, with what follows unknown.
        basis: 'fixed',
        fixedMonths: 12,
        tiers: [
          { minEur: 0, maxEur: 30000, aerPct: 3 },
          { minEur: 30001, maxEur: 100000, aerPct: 0.5 },
        ],
      },
      conditions: { takesMonthly: true, minMonthlyEur: 5, maxMonthlyEur: 2500 },
    })
    // The reversion rate, the minimum age and lump sums are not on CCPC: unknown, never zero.
    expect(product.unknown).toEqual(
      expect.arrayContaining([
        'rates.thenAerPct',
        'conditions.minAge',
        'conditions.takesLumpSum',
        'rates.lumpSumAerPct',
      ]),
    )
    expect(product.conditions.prose?.['Introductory offers']).toBe(
      'Get a fixed regular savings rate for 12 months',
    )
    expect(product.conditions.details?.['Withdrawal notice period:']).toBe('Instant access')
  })

  it('reads a regular saver named "(Fixed)" with a minimum savings period as fixed for it', () => {
    const fields = {
      'Minimum savings period (months):': '12 months',
      'Introductory offers:': 'None',
    }
    expect(regularFixedMonths('Family Savings Account (Fixed)', 'None', fields)).toBe(12)
    expect(regularFixedMonths('Online Regular Saver Account (Variable)', 'None', fields)).toBeNull()
    expect(
      regularFixedMonths('Family Savings Account (Fixed)', 'None', {
        'Minimum savings period (months):': 'No minimum',
      }),
    ).toBeNull()
  })

  it('treats "No Max" as no limit rather than an unknown, and adds the scheme to a bare link', () => {
    const product = checked(regularSaving(AIB_ONLINE_SAVER))

    expect(product.provider).toBe('aib')
    expect(product.conditions.maxMonthlyEur).toBeUndefined()
    expect(product.unknown).not.toContain('conditions.maxMonthlyEur')
    expect(product.unknown).not.toContain('rates.thenAerPct')
    expect(product.providerUrl).toBe(
      'https://personal.aib.ie/our-products/savings-and-deposits/online-saver',
    )
  })

  it('reads a fixed-term deposit as one term, and a platform bank as the bank', () => {
    expect(checked(lumpSum(ADVANTAGE_12))).toMatchObject({
      productId: 'deposit.c4161',
      rates: { aerPct: 2.4, basis: 'fixed', termMonths: 12, noticeDays: 0 },
      conditions: { takesLumpSum: true, takesMonthly: false, minLumpSumEur: 5000 },
    })
    const raisin = checked(lumpSum(RAISIN_FIXED))
    expect(raisin.provider).toBe('creditplus')
    expect(raisin.conditions.details?.['Platform']).toBe('Raisin')
    expect(raisin.unknown).toContain('conditions.takesMonthly')
  })

  it('reads a mortgage, leaving the APRC unknown', () => {
    const product = checked(mortgage(HVM, 'first_time_buyer'))
    expect(product.rates).toEqual({
      kind: 'mortgage',
      rateType: 'fixed',
      fixedYears: 1,
      initialRatePct: 3.35,
      followOnRatePct: 4.15,
      fullTermRatePct: 4.2,
      ltvMinPct: 0,
      ltvMaxPct: 90,
      ber: 'B',
      cashback: false,
      customerTypes: ['first_time_buyer'],
    })
    expect(product.unknown).toContain('rates.aprcPct')
    expect(product.conditions.prose?.['Additional information']).toBe(
      'Application via broker - Available through selected brokers only',
    )
  })

  it('reads a loan rate as the APR CCPC labels it, with its purposes', () => {
    expect(checked(loan(LOAN)).rates).toEqual({
      kind: 'loan',
      aprPct: 6.5,
      rateType: 'variable',
      maxAmountEur: 75000,
      maxTermMonths: 120,
      purposes: ['Home improvements', 'Home energy upgrade loans (SCBI)'],
    })
  })

  it('reads a loan’s longest term in the unit CCPC states, and no unit as unknown', () => {
    expect(loanTermMonths('60 months', 5)).toEqual({ months: 60, unknown: false })
    expect(loanTermMonths('10 Years', 10)).toEqual({ months: 120, unknown: false })
    expect(loanTermMonths('7 years', 7)).toEqual({ months: 84, unknown: false })
    expect(loanTermMonths('7', 7)).toEqual({ months: null, unknown: true })
    expect(loanTermMonths(undefined, 5)).toEqual({ months: 60, unknown: false })
    expect(loanTermMonths(undefined, null)).toEqual({ months: null, unknown: true })

    const withTerm = (term: string): CcpcItem => ({
      ...LOAN,
      ...f({ 'Rate type:': 'Variable', 'Maximum term:': term, 'Home improvements': '1' }),
    })
    const years = checked(loan(withTerm('10 Years')))
    expect(years.rates).toMatchObject({ maxTermMonths: 120 })
    const bare = checked(loan(withTerm('7')))
    expect(bare.rates).toMatchObject({ maxTermMonths: null })
    expect(bare.unknown).toContain('rates.maxTermMonths')
  })

  it('reads cards and current accounts with the date CCPC last edited them', () => {
    const card = checked(creditCard(CARD))
    expect(card.rates).toMatchObject({
      aprPct: 22.7,
      purchaseRatePct: 14,
      balanceTransferIntroMonths: 7,
    })
    expect(card.sourceUpdatedAt).toBe('2026-04-14T09:01:31.857Z')

    expect(checked(currentAccount(ACCOUNT)).rates).toEqual({
      kind: 'current_account',
      quarterlyFeeEur: 18,
      creditInterestPct: 0,
      overdraft: true,
    })
  })

  it('folds one mortgage found in several lists into one record', () => {
    const into = new Map<string, Built>()
    merge(into, mortgage(HVM, 'first_time_buyer'))
    merge(into, mortgage(HVM, 'switcher'))
    merge(into, mortgage(HVM, 'first_time_buyer'))

    expect(into.size).toBe(1)
    const only = [...into.values()][0]
    expect(only?.product.rates).toMatchObject({ customerTypes: ['first_time_buyer', 'switcher'] })
  })

  it('reads numbers out of CCPC prose', () => {
    expect(numberIn('€18.00 **')).toBe(18)
    expect(numberIn('2.52% up to €100000')).toBe(2.52)
    expect(numberIn('No maximum')).toBeNull()
  })
})

describe('provider names', () => {
  it('maps the names CCPC uses and generates an id for one it does not know', () => {
    expect(providerFor('Creditplus Bank  via Raisin')).toEqual({
      id: 'creditplus',
      platform: 'Raisin',
      generated: false,
    })
    expect(providerFor('Brand New Bank d.a.c via Raisin')).toEqual({
      id: 'brand_new_bank',
      platform: 'Raisin',
      generated: true,
    })
  })
})
