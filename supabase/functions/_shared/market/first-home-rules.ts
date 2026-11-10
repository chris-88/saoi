/**
 * The rules a first home is bought under in Ireland, as data the engine reads, each with the
 * primary page it was read from and the day. Checked 2026-11-09.
 *
 * - Help to Buy: Revenue (revenue.ie). The cap rose to €35,000 for applications from
 *   7 October 2026 (it was €30,000 from 23 July 2020).
 * - The mortgage measures: the Central Bank of Ireland (centralbank.ie), framework reviewed
 *   October 2022, S.I. 546 of 2022 in force from 1 January 2023; principal-home bridging loans
 *   exempted from the income limit in 2026 (S.I. 141 of 2026).
 * - Green mortgages: no Central Bank or government rule sets rates by BER; lenders set their own.
 *   Green rates come from the market data.
 *
 * The other routes to a home (decision `2026-11-10-saoi-routes-card`), read 2026-11-10:
 *
 * - First Home Scheme: firsthomescheme.ie (the scheme's own site; firsthome.ie did not resolve on
 *   2026-11-09). Read: who (first-time buyers, first-time self-builders, Fresh Start), the three
 *   property types (new build in a private development, self-build, tenant purchase after a
 *   notice of termination), up to 30% equity or 20% with Help to Buy, at least 2.5% or €10,000,
 *   a 10% deposit, the most a participating lender will lend (up to 4 times income), mortgage
 *   approval with a participating lender, no household income limit, combinable with Help to Buy
 *   but not with the Local Authority Home Loan or affordable purchase, and the price ceilings per
 *   local authority (no effective date on the page; "regularly reviewed").
 * - Local Authority Home Loan: localauthorityhomeloan.ie (the scheme's own site). Read: gross
 *   income at most €80,000 single and €85,000 joint, proof of insufficient offers from two
 *   regulated lenders, first-time buyer (Fresh Start and inherited property excepted), age 18 to
 *   70, two years' employment for the main earner and one for a second, up to 90% of market value,
 *   and the maximum market value per county (€415,000 to €310,000; the page cites S.I. 701 of 2021
 *   "or later regulations" and the home page says limits rose from 1 April 2026, without dates on
 *   the figures). Interest rates and term were not read.
 * - Affordable purchase: gov.ie (403) and citizensinformation.ie (403) refused automated reads on
 *   2026-11-10. Read instead from newstarterhomes.ie, the Department of Housing and the Housing
 *   Agency's site (affordablehomes.ie redirects to it), where councils' affordable homes are
 *   listed as "Starter Home Purchase": the council sells below market value and keeps an equity
 *   share (at least 5%); gross household income times 4 at most 85.5% of the home's market value;
 *   first-time buyer or Fresh Start; Help to Buy can count; the First Home Scheme cannot; homes are
 *   advertised per development with their own opening and closing dates. Whether "Starter Home
 *   Purchase" is the Local Authority Affordable Purchase Scheme renamed is not stated on the page.
 * - Vacant Property Refurbishment Grant: gov.ie (403) and citizensinformation.ie (403) refused;
 *   read from two councils' own pages, which administer it: South Dublin County Council (up to
 *   €50,000, up to €20,000 more if derelict, vacant at least 2 years, paid on receipts after the
 *   works, works within 18 months, home or rental, may apply while negotiating to buy) and Limerick
 *   City and County Council (the same amounts and vacancy; "built prior to 2008"). South Dublin's
 *   page says "before 2007", so the build year stays unconfirmed.
 */

import type { LocalArea } from './areas.ts'

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

const ROUTES_CHECKED = '2026-11-10'

/** A price limit in an area: one figure, or a range where the area splits (city and county). */
export type AreaCeiling = {
  readonly lowEur: number
  readonly highEur: number
  /** Why it is a range: which part of the area takes which limit. */
  readonly split: string | null
}
const one = (eur: number): AreaCeiling => ({ lowEur: eur, highEur: eur, split: null })

const FHS = 'https://www.firsthomescheme.ie'

export const FIRST_HOME_SCHEME = {
  /** Read from the scheme's own site on 2026-11-10. */
  confirmed: true,
  /** Of the price (or a self-build's cost), without Help to Buy. */
  maxSharePct: 30,
  /** With Help to Buy. */
  maxShareWithHelpToBuyPct: 20,
  /** The smallest share: the larger of this percent and `minShareEur`. */
  minSharePct: 2.5,
  minShareEur: 10_000,
  minDepositPct: 10,
  /** The participating lender lends its most, up to this many times income. */
  loanToIncome: 4,
  kinds: ['new_build', 'self_build', 'tenant_purchase'] as const,
  /** Per local authority area, house or apartment or self-build; no effective date stated. */
  ceilings: {
    carlow: one(375_000),
    cavan: one(375_000),
    clare: one(400_000),
    cork: { lowEur: 450_000, highEur: 500_000, split: 'Cork City €500,000, Cork County €450,000' },
    donegal: one(400_000),
    dublin: one(500_000),
    galway: {
      lowEur: 450_000,
      highEur: 475_000,
      split: 'Galway City €475,000, Galway County €450,000',
    },
    kerry: one(425_000),
    kildare: one(475_000),
    kilkenny: one(400_000),
    laois: one(400_000),
    leitrim: one(400_000),
    limerick: one(450_000),
    longford: one(375_000),
    louth: one(425_000),
    mayo: one(425_000),
    meath: one(475_000),
    monaghan: one(375_000),
    offaly: one(375_000),
    roscommon: one(400_000),
    sligo: one(400_000),
    tipperary: one(375_000),
    waterford: {
      lowEur: 400_000,
      highEur: 450_000,
      split: 'Waterford €400,000 for a house or self-build, €450,000 for an apartment',
    },
    westmeath: one(400_000),
    wexford: one(400_000),
    wicklow: one(500_000),
    dublin_city: one(500_000),
    dun_laoghaire_rathdown: one(500_000),
    fingal: one(500_000),
    south_dublin: one(500_000),
  } satisfies Record<LocalArea, AreaCeiling>,
  note: 'The First Home Scheme (shared equity: the State and participating lenders take a share of a new home’s price) as read from firsthomescheme.ie on 2026-11-10.',
  source: { fact: 'First Home Scheme', url: FHS, checkedOn: ROUTES_CHECKED },
  sources: [
    {
      fact: 'First-time buyers, first-time self-builders and Fresh Start applicants; a new build in a private development, a self-build, or a tenant purchase; up to 30% of the price or build cost, 20% with Help to Buy; combinable with Help to Buy, not with the Local Authority Home Loan or affordable purchase',
      url: `${FHS}/`,
      checkedOn: ROUTES_CHECKED,
    },
    {
      fact: 'Over 18; mortgage approval with a participating lender, borrowing the most it offers (up to 4 times income); a 10% deposit; the share at least 2.5% or €10,000; the principal private residence; no household income limit',
      url: `${FHS}/about-the-scheme/eligibility/`,
      checkedOn: ROUTES_CHECKED,
    },
    {
      fact: 'Price ceilings per local authority area, €375,000 to €500,000 (house, apartment, self-build); "regularly reviewed and may be subject to change"; no effective date on the page',
      url: `${FHS}/about-the-scheme/property-price-ceilings/`,
      checkedOn: ROUTES_CHECKED,
    },
  ] satisfies readonly RuleSource[],
} as const

const LAHL = 'https://localauthorityhomeloan.ie'

export const LOCAL_AUTHORITY_HOME_LOAN = {
  /** Read from the scheme's own site on 2026-11-10. */
  confirmed: true,
  /** Gross income a year, at most. */
  maxIncomeSingleEur: 80_000,
  maxIncomeJointEur: 85_000,
  /** Of the market value. */
  maxLtvPct: 90,
  /** Proof of insufficient mortgage offers from this many regulated lenders. */
  insufficientOffers: 2,
  minAge: 18,
  maxAge: 70,
  /** Maximum market value per county (S.I. 701 of 2021 or later regulations). */
  ceilings: {
    carlow: one(310_000),
    cavan: one(310_000),
    clare: one(345_000),
    cork: one(375_000),
    donegal: one(310_000),
    dublin: one(415_000),
    galway: {
      lowEur: 345_000,
      highEur: 375_000,
      split: 'Galway City €375,000, Galway County €345,000',
    },
    kerry: one(310_000),
    kildare: one(415_000),
    kilkenny: one(345_000),
    laois: one(310_000),
    leitrim: one(310_000),
    limerick: one(345_000),
    longford: one(310_000),
    louth: one(345_000),
    mayo: one(310_000),
    meath: one(375_000),
    monaghan: one(310_000),
    offaly: one(310_000),
    roscommon: one(310_000),
    sligo: one(310_000),
    tipperary: one(310_000),
    waterford: one(345_000),
    westmeath: one(345_000),
    wexford: one(345_000),
    wicklow: one(415_000),
    dublin_city: one(415_000),
    dun_laoghaire_rathdown: one(415_000),
    fingal: one(415_000),
    south_dublin: one(415_000),
  } satisfies Record<LocalArea, AreaCeiling>,
  sources: [
    {
      fact: 'Gross income at most €80,000 single, €85,000 joint; proof of insufficient offers from two regulated lenders; a first-time buyer (Fresh Start and inherited property excepted); aged 18 to 70; two years’ employment (main earner), one year (second earner)',
      url: `${LAHL}/eligibility/`,
      checkedOn: ROUTES_CHECKED,
    },
    {
      fact: 'Maximum market value: €415,000 Dublin, Kildare, Wicklow; €375,000 Cork, Galway City, Meath; €345,000 Clare, Galway County, Kilkenny, Limerick, Louth, Waterford, Westmeath, Wexford; €310,000 elsewhere (S.I. 701 of 2021 or later regulations; no effective date on the page)',
      url: `${LAHL}/information/eligibility/`,
      checkedOn: ROUTES_CHECKED,
    },
    {
      fact: 'Up to 90% of the market value; the maximum loan depends on where the property is; price and income limits raised from 1 April 2026',
      url: `${LAHL}/`,
      checkedOn: ROUTES_CHECKED,
    },
  ] satisfies readonly RuleSource[],
} as const

const STARTER = 'https://newstarterhomes.ie/starter-home-purchase'

export const AFFORDABLE_PURCHASE = {
  /**
   * Read from a state site (the Department of Housing and the Housing Agency's), as gov.ie's
   * own page refused automated reads. Re-read gov.ie when it can be reached.
   */
  confirmed: true,
  /** Gross household income times this ... */
  incomeMultiple: 4,
  /** ... at most this percent of the home's market value. */
  maxIncomeShareOfValuePct: 85.5,
  /** The council's equity share is at least this percent of market value. */
  minCouncilSharePct: 5,
  /** With Help to Buy, the mortgage and the council's share together at least this percent. */
  helpToBuyMinMortgageAndSharePct: 70,
  sources: [
    {
      fact: 'Secondary to gov.ie (refused automated reads on 2026-11-10): the Department of Housing and Housing Agency site lists council affordable homes as Starter Home Purchase; the council sells a new home below market value and keeps the difference as its equity share',
      url: `${STARTER}/about/`,
      checkedOn: ROUTES_CHECKED,
    },
    {
      fact: 'First-time buyer or Fresh Start; gross household income times 4 at most 85.5% of the market value; the council’s share at least 5%; Help to Buy can count (mortgage and share at least 70%); the First Home Scheme is not available for council homes; each home is advertised with its own opening and closing dates',
      url: `${STARTER}/faq/`,
      checkedOn: ROUTES_CHECKED,
    },
  ] satisfies readonly RuleSource[],
} as const

const SDCC = 'https://sdcc.ie/en/services/housing/vacant-homes/vacant-property-refurbishment-grant/'
const LIMERICK =
  'https://www.limerick.ie/council/services/housing/derelict-and-vacant-sites/vacant-property-refurbishment-grant'

export const VACANT_PROPERTY_GRANT = {
  /** The amounts and vacancy are read from two councils; the build year differs between them. */
  confirmed: false,
  maxGrantEur: 50_000,
  derelictTopUpEur: 20_000,
  minVacantYears: 2,
  /** Limerick's page; South Dublin's says before 2007. Unconfirmed. */
  builtBeforeYear: 2008,
  /** Works finished within this many months of approval (South Dublin). */
  worksWithinMonths: 18,
  sources: [
    {
      fact: 'Secondary to gov.ie (refused automated reads on 2026-11-10), from the council that administers it: up to €50,000, up to €20,000 more if derelict; vacant at least 2 years; built "before 2007"; paid on invoices and receipts after the approved works; works within 18 months; a home or a rental; may apply while negotiating to buy',
      url: SDCC,
      checkedOn: ROUTES_CHECKED,
    },
    {
      fact: 'Secondary to gov.ie, from the council: up to €50,000, up to €20,000 more if derelict; vacant at least two years; "built prior to 2008"; a permanent home or a rental',
      url: LIMERICK,
      checkedOn: ROUTES_CHECKED,
    },
  ] satisfies readonly RuleSource[],
} as const

export const GREEN_MORTGAGES = {
  note: 'No Central Bank or government rule sets mortgage rates by BER: lenders set their own green rates. The green rates here are the lenders’ own, from the market data.',
} as const
