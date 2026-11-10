/**
 * What each lender adds to a home purchase beyond its rate: cashback on drawdown, and savings
 * accounts whose bonus depends on taking that lender's mortgage. Recorded per lender with its
 * conditions, the page it was read from and the day; `confirmed` only when read from the
 * lender's own site. CCPC's prose is used where the lender's site refused automated reads
 * (avantmoney.ie, havenmortgages.ie, ptsb.ie, aib.ie, ebs.ie returned 403 on 2026-11-10; not
 * bypassed). Whether a product gets the cashback is decided by its own CCPC row: a row whose
 * Cashback field says "No" gets none.
 *
 * Checked 2026-11-10. The engine reads this in `domain/market/pathways.ts`.
 */

export type CashbackRule = {
  /** Paid at (or within weeks of) drawdown, as a percent of the loan. */
  readonly upfrontPct: number | null
  /** A flat amount at (or soon after) drawdown, in euro. */
  readonly flatEur: number | null
  /** The smallest loan the flat amount needs, where one is stated. */
  readonly minLoanEur: number | null
  /** A later payment, as a percent of the loan, if the mortgage is kept. */
  readonly laterPct: number | null
  readonly laterAfterYears: number | null
  /** Fixed rates only, where stated. */
  readonly fixedOnly: boolean
  readonly conditions: string
  readonly sourceUrl: string
  readonly confirmed: boolean
  readonly checkedOn: string
}

export type LinkedSaver = {
  /** The savings product, as `market_products.product_id` for the lender. */
  readonly productId: string
  readonly name: string
  readonly bonusEur: number
  readonly lessDirt: boolean
  readonly firstTimeBuyerOnly: boolean
  readonly minMonthlyEur: number
  readonly maxMonthlyEur: number
  readonly minMonths: number
  readonly minTotalEur: number
  /** The mortgage must be drawn down within this many months of opening the account. */
  readonly withinMonths: number
  /** `after_drawdown`: paid into the account once the mortgage is drawn, so it lowers the cost, not the deposit needed. */
  readonly paid: 'after_drawdown' | 'before_drawdown'
  readonly conditions: string
  readonly sourceUrl: string
  readonly confirmed: boolean
  readonly checkedOn: string
}

const CHECKED = '2026-11-10'
const CCPC = 'https://www.ccpc.ie/manage-your-money/buying-a-home/mortgage-comparison-tools'

export const CASHBACK: Readonly<Record<string, CashbackRule>> = {
  boi: {
    upfrontPct: 2,
    flatEur: null,
    minLoanEur: 15_000,
    laterPct: 1,
    laterAfterYears: 5,
    fixedOnly: true,
    conditions:
      '2% within 45 days of drawdown; 1% more after 5 years if every repayment is made in full and on time. Fixed rates only, not High Value Mortgage rates.',
    sourceUrl: 'https://personalbanking.bankofireland.com/borrow/mortgages/offers/cashback/',
    confirmed: true,
    checkedOn: CHECKED,
  },
  ebs: {
    upfrontPct: 2,
    flatEur: null,
    minLoanEur: null,
    laterPct: 1,
    laterAfterYears: 5,
    fixedOnly: false,
    conditions:
      '2% within 2 months of drawdown and 1% in five years if the mortgage account remains open (CCPC’s words; ebs.ie refused automated reads).',
    sourceUrl: CCPC,
    confirmed: false,
    checkedOn: CHECKED,
  },
  ptsb: {
    upfrontPct: 2,
    flatEur: null,
    minLoanEur: null,
    laterPct: null,
    laterAfterYears: null,
    fixedOnly: true,
    conditions:
      '2% at drawdown on fixed rates other than the 4-year fixed (CCPC’s words; ptsb.ie refused automated reads).',
    sourceUrl: CCPC,
    confirmed: false,
    checkedOn: CHECKED,
  },
  haven: {
    upfrontPct: null,
    flatEur: 5_000,
    minLoanEur: 250_000,
    laterPct: null,
    laterAfterYears: null,
    fixedOnly: true,
    conditions:
      '€5,000 when €250,000 or more is drawn down on a fixed rate, by December 2027 (CCPC’s words; havenmortgages.ie refused automated reads).',
    sourceUrl: CCPC,
    confirmed: false,
    checkedOn: CHECKED,
  },
  moco: {
    upfrontPct: null,
    flatEur: 1_500,
    minLoanEur: null,
    laterPct: null,
    laterAfterYears: null,
    fixedOnly: false,
    conditions: '€1,500 paid the month after the first monthly instalment; not repaid.',
    sourceUrl: 'https://www.moco.ie/moco/mortgages/faq-mortgages',
    confirmed: true,
    checkedOn: CHECKED,
  },
  avant_money: {
    // The percent is per product (1% or 2%), read from each CCPC row.
    upfrontPct: null,
    flatEur: null,
    minLoanEur: null,
    laterPct: null,
    laterAfterYears: null,
    fixedOnly: false,
    conditions:
      '1% or 2% at drawdown, by product (CCPC’s words; avantmoney.ie refused automated reads).',
    sourceUrl: CCPC,
    confirmed: false,
    checkedOn: CHECKED,
  },
}

export const LINKED_SAVERS: Readonly<Record<string, readonly LinkedSaver[]>> = {
  boi: [
    {
      productId: 'savings.mortgagesaver',
      name: 'MortgageSaver',
      bonusEur: 2_000,
      lessDirt: true,
      firstTimeBuyerOnly: true,
      minMonthlyEur: 200,
      maxMonthlyEur: 2_500,
      minMonths: 6,
      minTotalEur: 5_000,
      withinMonths: 30,
      paid: 'after_drawdown',
      conditions:
        '€2,000 less DIRT, paid into the account within 5 working days of a Bank of Ireland first-time-buyer mortgage being drawn down in full: €200 to €2,500 a month by direct debit for 6 months in a row, €5,000 or more saved and still held at drawdown, within 30 months of opening. One bonus per mortgage; one account per person; can be held alongside SuperSaver.',
      sourceUrl:
        'https://personalbanking.bankofireland.com/app/uploads/MortgageSaver-Brochure-April-2025-A.pdf',
      confirmed: true,
      checkedOn: CHECKED,
    },
  ],
}

/** Buying costs on top of the deposit, stated in every pathway's assumptions. */
export const BUYING_COSTS = {
  /** Stamp duty on a residential property up to €1,000,000. */
  stampDutyPct: 1,
  stampDutySourceUrl:
    'https://www.revenue.ie/en/property/stamp-duty/property/residential-property.aspx',
  /** Legal fees and a survey, an estimate. */
  legalAndSurveyEur: 3_000,
} as const
