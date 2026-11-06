import { monthlyRepayment } from '../../domain/mortgage.ts'
import { demoMortgageRates } from './mortgage-rates.ts'
import type {
  BerBand,
  MortgageCustomerType,
  MortgageRate,
  RateFamily,
} from './mortgage-rate-types.ts'

/**
 * Picking the rates to put in front of somebody.
 *
 * A published rate is a function of four things at once — who the customer is, the property's
 * BER, the term, and how much they are borrowing — and 133 rows is far too many to hand a model
 * and hope. So the model gathers the four answers and this decides which rows they entitle
 * somebody to. The model never reads the table (Invariant 3).
 *
 * The comparison it builds is the one the supplied pack asks for by name: a High Value Mortgage
 * carries the lowest headline rate and no cashback, so putting it beside a cashback rate and
 * calling the lower number better is exactly the mistake to avoid. Both go on the card with
 * their actual figures, and Saoirse does the explaining.
 */

export type BerAnswer = BerBand | 'A0'

export type RateCriteria = {
  readonly customerType: MortgageCustomerType
  readonly ber: BerAnswer
  /** What they intend to borrow. Decides High Value eligibility, and the repayment figures. */
  readonly amountEur?: number
  /** The mortgage term, not the fixed period. Without it there is no monthly repayment. */
  readonly termYears?: number
}

export type RateOption = {
  readonly id: string
  /** "4 years fixed", "Variable". */
  readonly label: string
  readonly familyLabel: string
  readonly ratePct: number
  readonly aprcPct: number | null
  readonly fixedYears: number | null
  /** 2% of drawdown, in euro, when the rate carries it and the amount is known. */
  readonly cashbackEur: number | null
  readonly cashbackNote: string | null
  readonly monthlyEur: number | null
  readonly note: string | null
}

export type RateSelection = {
  readonly options: readonly RateOption[]
  /** The date the rate table itself claims. Every figure Saoirse states carries it. */
  readonly asOf: string
  /** Set when no rate can honestly be quoted, with the reason. Options is then empty. */
  readonly unavailable: string | null
}

const FAMILY_LABEL: Record<RateFamily, string> = {
  standard_fixed_cashback: 'Fixed, with Cashback Plus',
  high_value_fixed: 'High Value Mortgage',
  standard_variable: 'Variable',
  existing_fixed: 'Fixed',
  buy_to_let_fixed: 'Buy to let, fixed',
  buy_to_let_variable: 'Buy to let, variable',
}

const CASHBACK_RATE = 0.02

function labelFor(rate: MortgageRate): string {
  if (rate.term_years === null) return 'Variable'
  return `${String(rate.term_years)} year${rate.term_years === 1 ? '' : 's'} fixed`
}

/** Does this row apply to this customer, this property and this amount? */
function applies(rate: MortgageRate, criteria: RateCriteria): boolean {
  if (!rate.customer_types.includes(criteria.customerType)) return false
  if (rate.ber !== 'any' && rate.ber !== criteria.ber) return false

  /*
   * The High Value floor. A rate carrying a minimum is not a rate somebody borrowing less can
   * be shown at all — showing it and adding "if you borrowed more" is how a demo turns into a
   * complaint.
   */
  if (rate.minimum_mortgage_amount_eur !== null) {
    if (criteria.amountEur === undefined) return false
    if (criteria.amountEur < rate.minimum_mortgage_amount_eur) return false
  }

  return true
}

function toOption(rate: MortgageRate, criteria: RateCriteria): RateOption {
  const cashbackEur =
    rate.cashback.eligible && criteria.amountEur !== undefined
      ? Math.round(criteria.amountEur * CASHBACK_RATE)
      : null

  const monthlyEur =
    criteria.amountEur !== undefined && criteria.termYears !== undefined
      ? Math.round(monthlyRepayment(criteria.amountEur, rate.interest_rate_pct, criteria.termYears))
      : null

  return {
    id: rate.id,
    label: labelFor(rate),
    familyLabel: FAMILY_LABEL[rate.rate_family],
    ratePct: rate.interest_rate_pct,
    aprcPct: rate.aprc_pct,
    fixedYears: rate.term_years,
    cashbackEur,
    cashbackNote: rate.cashback.eligible ? (rate.cashback.structure ?? null) : null,
    monthlyEur,
    note: rate.notes.length > 0 ? (rate.notes[0] ?? null) : null,
  }
}

/**
 * Up to four rates, chosen to be worth comparing rather than to be the four cheapest.
 *
 * Four cheapest would be the same fixed rate at four adjacent terms, which tells a customer
 * nothing. These are the four decisions actually in front of them: the lowest rate on offer,
 * the best rate that still pays cashback, the longest certainty available, and the variable.
 */
/** The rows and the date they carry. The published table, unless a turn has loaded edited rows. */
export type RateTable = {
  readonly rates: readonly MortgageRate[]
  readonly asOf: string
}

export const PUBLISHED_RATES: RateTable = {
  rates: demoMortgageRates.rates,
  asOf: demoMortgageRates.metadata.public_rates_table_last_update.slice(0, 10),
}

export function selectRates(
  criteria: RateCriteria,
  table: RateTable = PUBLISHED_RATES,
): RateSelection {
  const asOf = table.asOf

  /*
   * §4 of the pack's own answering rules. Demo Bank added A0 to the BER scale in May 2026 and the
   * published rate table still stops at A, so there is no honest row to return — and guessing
   * that A0 means A is the kind of help that costs somebody money.
   */
  if (criteria.ber === 'A0') {
    return {
      options: [],
      asOf,
      unavailable:
        'The published table still runs A to G and does not yet price A0, so an A0 property needs a live rate check rather than a figure from here.',
    }
  }

  const eligible = table.rates.filter((rate) => applies(rate, criteria))
  if (eligible.length === 0) {
    return { options: [], asOf, unavailable: null }
  }

  const byRate = [...eligible].sort((a, b) => a.interest_rate_pct - b.interest_rate_pct)
  const fixed = byRate.filter((rate) => rate.term_years !== null)

  const picks: MortgageRate[] = []
  const add = (rate: MortgageRate | undefined): void => {
    if (rate && !picks.some((already) => already.id === rate.id)) picks.push(rate)
  }

  add(byRate[0])
  add(fixed.find((rate) => rate.cashback.eligible))
  add([...fixed].sort((a, b) => (b.term_years ?? 0) - (a.term_years ?? 0))[0])
  add(byRate.find((rate) => rate.term_years === null))

  return {
    options: picks.slice(0, 4).map((rate) => toOption(rate, criteria)),
    asOf,
    unavailable: null,
  }
}

/** The pack's guidance, composed into the prompt so Saoirse answers the way it asks. */
export const mortgageAnsweringRules: readonly string[] = demoMortgageRates.saoirse_answering_rules

/**
 * What Saoirse is told about rates, rendered from the pack rather than written out.
 *
 * Composed from the supplied answering rules so the two cannot drift: if the pack's guidance
 * changes, this changes with it and nobody has to remember to update a paragraph.
 */
export function mortgageRatesSection(table: RateTable = PUBLISHED_RATES): string {
  return [
    '# Mortgage rates',
    '',
    "You have Demo Bank's illustrative mortgage rate table and you can quote from it. Do not",
    'say you cannot give a rate, and do not send somebody to the website for a number you are',
    'holding. Use `show_mortgage_rates`; it returns the rates and the repayments and puts them',
    'on a card.',
    '',
    'The table prices four things separately, so it needs all four before it returns anything:',
    '',
    '- whether they are a first-time buyer, mover, switcher, an existing Demo Bank',
    '  mortgage customer, or buying to let',
    "- the property's BER",
    '- what they intend to borrow',
    '- over what term',
    '',
    'Ask for whichever you are missing, one at a time, the way you ask for anything else. If',
    'they do not know the BER yet, say what it changes — it is worth a letter or two of rate —',
    'and offer to go on with everything else meanwhile.',
    '',
    'Rules that come with the rates:',
    '',
    ...mortgageAnsweringRules.map((rule) => `- ${rule}`),
    '',
    `These are published rates as at ${table.asOf}, and`,
    'that date goes with any figure you state. A published rate is not an offer and never means',
    'approval: what somebody can actually borrow goes through a full assessment, and saying so',
    'once is honest rather than discouraging.',
  ].join('\n')
}
