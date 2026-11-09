/**
 * The rules a first home is bought under in Ireland, as data the engine reads, each with the
 * primary page it was read from and the day. Checked 2026-11-09.
 *
 * - Help to Buy: Revenue (revenue.ie). The cap rose to €35,000 for applications from
 *   7 October 2026 (it was €30,000 from 23 July 2020).
 * - The mortgage measures: the Central Bank of Ireland (centralbank.ie), framework reviewed
 *   October 2022, S.I. 546 of 2022 in force from 1 January 2023; principal-home bridging loans
 *   exempted from the income limit in 2026 (S.I. 141 of 2026).
 * - First Home shared equity: firsthome.ie did not resolve and gov.ie refused automated reads on
 *   2026-11-09, so nothing about it is recorded as fact. Its figures stay unknown.
 * - Green mortgages: no Central Bank or government rule sets rates by BER; lenders set their own.
 *   Green rates come from the market data.
 */

export type RuleSource = {
  readonly fact: string
  readonly url: string
  readonly checkedOn: string
}

const CHECKED = '2026-11-09'
const REVENUE = 'https://www.revenue.ie/en/property/help-to-buy-incentive'
const CBI =
  'https://www.centralbank.ie/financial-system/financial-stability/macro-prudential-policy/mortgage-measures'

export const HELP_TO_BUY = {
  /** The share of the price (or a self-build's approved valuation) that can be refunded. */
  shareOfPrice: 0.1,
  /** Per property, however many buyers, for applications from `capFrom`. */
  capEur: 35_000,
  capFrom: '2026-10-07',
  /** The most a property can cost (or be valued at, for a self-build) and qualify. */
  maxPriceEur: 500_000,
  /** The mortgage must be at least this share of the price or valuation. */
  minMortgagePct: 70,
  /** Years the buyer must live in it as their main home, or Revenue claws the refund back. */
  residenceYears: 5,
  /** Income Tax and DIRT paid over this many tax years before applying; USC and PRSI do not count. */
  taxYears: 4,
  /** A purchase or self-build must fall on or before this day. */
  endsOn: '2029-12-31',
  sources: [
    {
      fact: 'New builds (construction subject to VAT), self-builds and converted non-residential buildings; €500,000 or less',
      url: `${REVENUE}/what-type-of-property-qualifies.aspx`,
      checkedOn: CHECKED,
    },
    {
      fact: 'The lesser of €35,000 (applications from 7 October 2026), 10% of the price or valuation, and Income Tax and DIRT paid in the four years before applying; USC and PRSI not counted',
      url: `${REVENUE}/how-much-can-you-claim.aspx`,
      checkedOn: CHECKED,
    },
    {
      fact: 'A first-time buyer, living in it as their main home for five years; a mortgage of at least 70% of the price; bought or built by 31 December 2029',
      url: `${REVENUE}/who-can-claim-htb.aspx`,
      checkedOn: CHECKED,
    },
  ] satisfies readonly RuleSource[],
} as const

export const MORTGAGE_MEASURES = {
  first_time_buyer: { loanToIncome: 4, maxLtvPct: 90, allowancePct: 15 },
  second_and_subsequent: { loanToIncome: 3.5, maxLtvPct: 90, allowancePct: 15 },
  /** Switchers and arrears restructures are outside both limits; negative equity is outside LTV. */
  exemptions:
    'Switcher mortgages and arrears restructures are outside both limits; borrowers in negative equity are outside the loan-to-value limit; principal-home bridging loans are outside the income limit (2026).',
  allowance:
    'Each lender may lend above the limits for up to 15% of its first-time-buyer lending, and 15% of its second-and-subsequent-buyer lending, each year. Whether a buyer gets one is the lender’s decision; the figures here do not assume one.',
  source: {
    fact: 'Loan-to-income 4 times (first-time buyers) and 3.5 times (second and subsequent); loan-to-value 90%; allowances 15% of each; framework reviewed October 2022, S.I. 546 of 2022 from 1 January 2023',
    url: CBI,
    checkedOn: CHECKED,
  } satisfies RuleSource,
} as const

export const FIRST_HOME_SCHEME = {
  /** Not confirmed from a primary page: every figure about it stays unknown. */
  confirmed: false,
  note: 'The First Home shared equity scheme (the State takes a share of a new home’s price) could not be confirmed from a primary page on 2026-11-09: whether it is open, its share limits and its local price ceilings are not recorded. See firsthome.ie.',
  source: { fact: 'First Home scheme', url: 'https://www.firsthome.ie', checkedOn: CHECKED },
} as const

export const GREEN_MORTGAGES = {
  note: 'No Central Bank or government rule sets mortgage rates by BER: lenders set their own green rates. The green rates here are the lenders’ own, from the market data.',
} as const
