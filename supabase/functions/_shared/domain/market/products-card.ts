import {
  PRODUCTS_CARD_MAX_ROWS,
  PRODUCTS_ROW_MAX_DETAIL,
  PRODUCTS_ROW_MAX_MUST_KNOW,
  type MarketProductsCard,
  type ProductsArrangement,
} from '../../contracts/cards.ts'
import type { Holding } from '../../contracts/holdings.ts'
import type { MarketPlan } from '../../contracts/market-plan.ts'
import type {
  DepositTerms,
  HomePathways,
  HomeSort,
  ProductView,
  SavingsFigures,
  SearchResult,
} from '../../contracts/market-tools.ts'
import { adviceWordsIn, MORTGAGE_WARNINGS, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { LINKED_SAVERS } from '../../market/mortgage-incentives.ts'
import { brandOf } from '../../market/provider-brand.ts'
import { providerIdOf } from '../../market/provider-names.ts'
import { CURRENT_ACCOUNT_LABEL, withHeldRates } from './held-rates.ts'
import { accountOf } from './allocate.ts'
import { displayName, euro, oldestCheck } from './figures.ts'
import { monthName, shortMonth } from './home-arithmetic.ts'
import { sourceOf, statedConditions } from './lookup.ts'
import { homePathways, HORIZON_YEARS, SORT_WORDS } from './pathways.ts'
import { pct } from './product.ts'
import { ratePeriod, type RatePeriod } from './rate-period.ts'
import { SAVINGS_ASSUMPTIONS, search, UNCONFIRMED_RATE } from './search.ts'
import {
  fitLine,
  type JudgedTerm,
  keysMonthWith,
  type KeysRun,
  pushedOutLine,
  TERM_FIT_RULE,
  termThatFits,
} from './term-fit.ts'
import {
  addMonths,
  DIRT_RATE,
  monthsUntil,
  NO_DATE_HORIZON,
  placement,
  round2,
  simulateDeposit,
} from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * The product card that follows the question asked (the first-home experience, "4. The
 * conversation", 2026-11-12). The customer asks to see information; the card shows the key facts
 * of what they asked about, arranged by what the question implies:
 *
 * | Question                                            | Arrangement        |
 * | --------------------------------------------------- | ------------------ |
 * | What does my savings account earn against the market | `held_vs_market`   |
 * | How soon can I get at the money                     | `by_access`        |
 * | Where can the deposit sit until the keys            | `fits_date`        |
 * | What would the mortgage cost                        | `mortgage_by_sort` |
 *
 * Pure. Every figure is the engine's: `search` for the savings market, `simulateDeposit` for the
 * months to the keys, `homePathways` for the lenders, `withHeldRates` for a current account's
 * rate. Nothing is picked: each card names its arrangement and how to change it, and carries the
 * basis statement (duty of care 2.4). With too little to work on, the result is the questions
 * that would let it run, never a card on invented figures.
 */

export type ProductsCategory = 'savings' | 'deposits' | 'mortgages'

/**
 * What a savings card is about (Chris, 2026-11-13): `lump`, the sum held (the default), or
 * `monthly`, the monthly saving: "Accounts for your €1,000 a month", the regular savers first,
 * then the instant-access and notice accounts that take monthly payments, each judged on the
 * monthly saving alone; fixed terms take lump sums only and are left out.
 */
export type ProductsFocus = 'lump' | 'monthly'

export type ShowProductsRequest = {
  readonly arrangement: ProductsArrangement
  readonly category?: ProductsCategory | undefined
  readonly sortBy?: HomeSort | undefined
  /** `by_access` and `fits_date` only; `lump` by default. */
  readonly focus?: ProductsFocus | undefined
  readonly filters?:
    | {
        readonly stayWithBank?: boolean | undefined
        readonly rateType?: 'fixed' | 'variable' | 'either' | undefined
        readonly green?: boolean | undefined
      }
    | undefined
}

/** An account the customer holds, as they gave it or as the plan carried it. */
export type HeldAccount = {
  readonly label: string
  readonly provider: string | null
  readonly balance: number
  /** What it earns, as they said; null when not given. */
  readonly ratePct: number | null
  readonly kind: 'current' | 'savings' | 'deposit'
}

/** The customer's figures, read from the case: the plan they brought, holdings, facts. */
export type CaseFigures = {
  readonly held: readonly HeldAccount[]
  readonly monthlySavingEur: number | null
  /** `YYYY-MM`: the month the money for the keys is there, or the date they gave. */
  readonly keysMonth: string | null
  readonly keysFrom: 'plan' | 'date_given' | null
  /**
   * The cash needed at the keys (deposit, stamp duty, legal and survey, less Help to Buy counted),
   * from the plan; null when the case does not carry it. With it, a fixed term is judged against
   * the keys month the plan reaches with that product's own interest (`term-fit.ts`).
   */
  readonly neededAtKeysEur: number | null
  readonly priceEur: number | null
  readonly incomeEur: number | null
  readonly firstTimeBuyer: boolean | null
  readonly newBuild: boolean | null
  readonly taxPaidEur: number | null
  /** The bank their current account is with, for "stay with my bank". */
  readonly currentBank: string | null
  /** The sort they chose for the mortgage comparison in the plan. */
  readonly sortBy: HomeSort | null
}

/**
 * For the model beside a card, never on it: what one row's money figure counts, in a sentence it
 * can quote when asked whether a figure will be realised ("€581 counts 3.11% to 1 January, then
 * 1.51%."). Rows whose figure is not interest (a mortgage's cost) carry none.
 */
export type RowBasis = {
  readonly id: string
  readonly lead: string
  /** The row's value as the card shows it ("3.11% to 1 Jan"). */
  readonly value: string
  readonly line: string
}

export type ProductsResult =
  | {
      readonly kind: 'card'
      readonly card: MarketProductsCard
      readonly figureBasis: readonly RowBasis[]
    }
  | { readonly kind: 'questions'; readonly questions: readonly string[] }

const ASSET_KINDS = new Set(['current', 'savings', 'deposit'])

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * The figures a products card runs on, from the newest claimed plan, the holdings and the facts
 * held. Holdings win over the plan's savings (they are newer and the customer keeps them); facts
 * fill what neither carries. Nothing is estimated: a figure not given stays null.
 */
export function caseFigures(input: {
  readonly plan: MarketPlan | null
  readonly holdings: readonly Holding[]
  /** The newest current value of a fact key, or undefined. */
  readonly fact: (key: string) => unknown
}): CaseFigures {
  const { plan, holdings, fact } = input
  const situation = plan?.situation
  const heldAssets = holdings.filter((holding) => ASSET_KINDS.has(holding.kind))
  const fromPlan = (situation?.savings ?? []).map((item): HeldAccount => ({
    label: item.label,
    provider: item.provider ?? null,
    balance: item.balance,
    ratePct: item.aerPct ?? null,
    kind: CURRENT_ACCOUNT_LABEL.test(item.label)
      ? 'current'
      : /fixed|term|deposit/i.test(item.label)
        ? 'deposit'
        : 'savings',
  }))
  const savingsFact = asNumber(fact('assets.savingsBalance'))
  const held: HeldAccount[] =
    heldAssets.length > 0
      ? heldAssets.map((holding) => ({
          label: holding.label,
          provider: holding.provider,
          balance: holding.balance,
          ratePct: holding.ratePct,
          kind: holding.kind as HeldAccount['kind'],
        }))
      : fromPlan.length > 0
        ? fromPlan
        : savingsFact !== null && savingsFact > 0
          ? [
              {
                label: 'savings',
                provider: null,
                balance: savingsFact,
                ratePct: null,
                kind: 'savings',
              },
            ]
          : []

  const comparison = plan?.comparison
  const arrival = plan?.arrival
  const houseGoal = plan?.goals.find((goal) => goal.kind === 'house_deposit')
  const dateFact = fact('goals.targetDate')
  const planKeys = comparison?.keysOn ?? arrival?.keysOn ?? null
  const givenDate =
    houseGoal?.targetDate ?? (typeof dateFact === 'string' ? dateFact : undefined) ?? null
  const keysMonth = (planKeys ?? givenDate)?.slice(0, 7) ?? null

  const chips = arrival?.assumptions ?? []
  const has = (text: string) => chips.some((chip) => chip.startsWith(text))
  const ftbFact = fact('housing.firstTimeBuyer')
  const firstTimeBuyer = has('Bought before')
    ? false
    : has('First-time buyer') && !has('First-time buyer, assumed')
      ? true
      : typeof ftbFact === 'boolean'
        ? ftbFact
        : null
  const newBuild = has('New build') || has('Self-build') ? true : has('Second-hand') ? false : null

  const currentHolding = holdings.find((holding) => holding.kind === 'current')
  const currentInPlan = fromPlan.find((item) => item.kind === 'current' && item.provider !== null)

  return {
    held,
    monthlySavingEur: situation?.monthlySaving ?? asNumber(fact('goals.monthlySaving')),
    keysMonth,
    keysFrom: planKeys !== null ? 'plan' : givenDate !== null ? 'date_given' : null,
    neededAtKeysEur:
      comparison?.neededAtKeysEur ??
      arrival?.progress?.neededEur ??
      (planKeys !== null ? (houseGoal?.targetAmount ?? null) : null),
    priceEur:
      comparison?.priceEur ??
      asNumber(fact('housing.purchasePrice')) ??
      asNumber(fact('property.value')),
    incomeEur: situation?.income?.annualGross ?? asNumber(fact('income.annualBasic')),
    firstTimeBuyer,
    newBuild,
    taxPaidEur: null,
    currentBank: currentHolding?.provider ?? currentInPlan?.provider ?? null,
    sortBy: comparison?.sortBy ?? null,
  }
}

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------

const QUESTIONS: Readonly<Record<ProductsArrangement, (keys: string | null) => string>> = {
  held_vs_market: () => 'What does my savings account earn against the market?',
  by_access: () => 'How soon can I get at the money, and what does access cost?',
  fits_date: (keys) =>
    keys === null
      ? 'Where can the deposit sit until the keys?'
      : `Where can the deposit sit until the keys in ${monthName(keys)}?`,
  mortgage_by_sort: () => 'What would the mortgage cost?',
}

const whole = (value: number): string => euro(Math.round(value))

/** "6-month fixed", "1-year fixed", "3-year fixed", "31-day notice", "instant access". */
function accessKind(terms: DepositTerms, termMonths: number | null): string {
  if (terms.access === 'fixed_term') {
    const months = termMonths ?? terms.ladder[0]?.months ?? null
    if (months === null) return 'fixed term'
    return months % 12 === 0 ? `${String(months / 12)}-year fixed` : `${String(months)}-month fixed`
  }
  if (terms.access === 'notice') return `${String(terms.noticeDays ?? 0)}-day notice`
  return 'instant access'
}

/** The headline rate for the term used: the rung, else the AER, else the highest band. */
function headlineRate(terms: DepositTerms, termMonths: number | null): number | null {
  if (terms.access === 'fixed_term') {
    const rung = terms.ladder.find((item) => item.months === termMonths) ?? terms.ladder[0]
    return rung?.aerPct ?? terms.aerPct
  }
  if (terms.aerPct !== null) return terms.aerPct
  if (terms.thresholdBonus !== null) return terms.thresholdBonus.bonusAerPct
  const bands = terms.bands.map((band) => band.aerPct)
  return terms.lumpSumAerPct ?? (bands.length === 0 ? null : Math.max(...bands))
}

// ---------------------------------------------------------------------------------------------
// The savings market
// ---------------------------------------------------------------------------------------------

type Horizon = { readonly months: number; readonly by: string; readonly dated: boolean }

function horizonOf(figures: CaseFigures, asOf: AsOf): Horizon {
  const keys = figures.keysMonth
  if (keys !== null && keys > asOf.slice(0, 7)) {
    return { months: monthsUntil(asOf, keys), by: keys, dated: true }
  }
  return { months: NO_DATE_HORIZON, by: addMonths(asOf, NO_DATE_HORIZON), dated: false }
}

const byWhen = (horizon: Horizon, months: number, asOf: AsOf): string =>
  horizon.dated || months < horizon.months
    ? `by ${shortMonth(addMonths(asOf, months))}`
    : `in ${String(months)} months`

/** "to July 2028", or "over 12 months" when no date is known: the period a figure covers. */
const runsTo = (horizon: Horizon, months: number, asOf: AsOf): string =>
  horizon.dated || months < horizon.months
    ? `to ${monthName(addMonths(asOf, months))}`
    : `over ${String(months)} months`

/**
 * What the money column counts, once per savings card (2026-11-12: "Rate card projecting rates
 * that will never be realised"). One sentence.
 */
export function moneyColumnLine(
  horizon: Horizon,
  runs: 'horizon' | 'own_keys' = 'horizon',
): string {
  const to =
    runs === 'own_keys'
      ? 'to the keys month each account gives'
      : horizon.dated
        ? `to ${monthName(horizon.by)}`
        : `over ${String(NO_DATE_HORIZON)} months`
  return (
    `The money column is interest after DIRT ${to}, ` +
    'counting each rate for as long as the product states it and the rate after where stated; ' +
    'where the rate after is not stated the money stops there.'
  )
}

type Row = MarketProductsCard['rows'][number]

type MarketRow = {
  readonly row: Row
  readonly rate: number
  readonly money: number
  /** For the model, not the card: what the money figure counts, one sentence it can quote. */
  readonly figureBasis: string
}

/** A savings row's value, note and the sentence behind its money. */
type SavingsWords = {
  readonly value: string
  readonly note: string | null
  readonly figureBasis: string
  /** The rate is stated to end before the figures do, and `value` names the end. */
  readonly period: boolean
  /** The rate's stated period when it ends before the figures do, for the row's facts. */
  readonly ends: RatePeriod | null
}

/**
 * How a savings row states its rate: the headline with its period where the rate is stated to
 * end before the figures do ("3.11% to 1 Jan", then "then 1.51%; the money counts both"), a
 * rate whose duration is not stated says so, and a fixed term that ends early says the money
 * stops there. `figureBasis` is the same in a sentence the model can quote ("€581 counts 3.11%
 * to 1 January, then 1.51%."). The money is `simulateDeposit`'s, which already counts each
 * period; nothing here changes a figure.
 */
function savingsWords(
  product: ProductView,
  terms: DepositTerms,
  figures: SavingsFigures,
  input: {
    readonly rate: number
    readonly money: number
    readonly horizon: Horizon
    readonly asOf: AsOf
    readonly lump: number
    readonly monthly: number
  },
): SavingsWords {
  const { rate, money, horizon, asOf } = input
  const lumpIn = Math.max(0, input.lump - figures.notPlaced.lumpSum)
  const monthlyIn = Math.max(0, input.monthly - figures.notPlaced.monthly)
  const period = ratePeriod(
    terms,
    asOf,
    figures.horizonMonths,
    lumpIn + monthlyIn * Math.max(0, figures.horizonMonths - 1),
  )
  const amount = whole(money)
  const to = runsTo(horizon, figures.knownMonths, asOf)
  const banded =
    terms.access !== 'fixed_term' && terms.thresholdBonus === null && terms.bands.length > 1
  const rateWords = banded ? `its balance-band rates, up to ${pct(rate)},` : pct(rate)
  const notPlaced =
    figures.notPlaced.lumpSum > 0
      ? ` ${whole(figures.notPlaced.lumpSum)} of the sum is above what it takes and is not counted.`
      : ''

  if (period !== null) {
    const value = `${pct(rate)} to ${period.endsShort}`
    if (period.after === null) {
      return {
        value,
        period: true,
        ends: period,
        note: `then not stated; the money stops at ${period.endsShort}`,
        figureBasis:
          `${amount} counts ${pct(rate)} to ${period.endsLong}; the rate after is not stated, so the money stops there.` +
          notPlaced,
      }
    }
    const added =
      period.kind === 'bonus' && monthlyIn > 0 && terms.thresholdBonus !== null
        ? ` on what is held at each ${period.resets ?? 'reset'}, and ${pct(terms.thresholdBonus.bonusAerPct)} on money added after it`
        : ''
    return {
      value,
      period: true,
      ends: period,
      note: `then ${period.after}; the money counts both`,
      figureBasis:
        `${amount} counts ${pct(rate)} to ${period.endsLong}, then ${period.after}${added}.` +
        notPlaced,
    }
  }

  const value = pct(rate)
  if (figures.stop !== null && terms.access === 'fixed_term') {
    const end = addMonths(asOf, figures.stop.afterMonths)
    return {
      value,
      period: false,
      ends: null,
      note: `interest to ${shortMonth(end)} only: the rate after is not stated`,
      figureBasis:
        `${amount} counts ${pct(rate)} for the ${String(figures.termMonths ?? figures.stop.afterMonths)}-month term, to ${monthName(end)}; the rate after is not stated, so the money stops there.` +
        notPlaced,
    }
  }
  if (terms.access === 'fixed_term') {
    return {
      value,
      period: false,
      ends: null,
      note: otherNote(product, terms, figures),
      figureBasis:
        `${amount} counts ${pct(rate)} for the ${String(figures.termMonths ?? figures.knownMonths)}-month term, ${to}.` +
        notPlaced,
    }
  }
  if (terms.rateForNewAccounts) {
    return {
      value,
      period: false,
      ends: null,
      note: 'rate for new accounts; how long it holds is not stated',
      figureBasis:
        `${amount} counts ${pct(rate)}, the rate for new accounts, ${to}; how long it holds is not stated.` +
        notPlaced,
    }
  }
  if (!product.rateConfirmed) {
    return {
      value,
      period: false,
      ends: null,
      note: 'rate from CCPC only; how long it holds is not stated',
      figureBasis:
        `${amount} counts ${pct(rate)}, CCPC’s one figure, ${to}; how long it holds is not stated.` +
        notPlaced,
    }
  }
  return {
    value,
    period: false,
    ends: null,
    note: otherNote(product, terms, figures),
    figureBasis:
      `${amount} counts ${rateWords}${terms.basis === 'variable' && !banded ? ', a variable rate,' : ''} ${to}.` +
      notPlaced,
  }
}

/** The one flag a row carries when its rate has nothing stated against it. */
function otherNote(
  product: ProductView,
  terms: DepositTerms,
  figures: SavingsFigures,
): string | null {
  if (figures.notPlaced.lumpSum > 0) {
    return `${whole(figures.notPlaced.lumpSum)} of it is above what it takes`
  }
  if (product.platform !== null) return `opened through ${product.platform.name}`
  const guarantee = product.depositGuarantee
  if (guarantee !== null && guarantee.country !== null && guarantee.country !== 'Ireland') {
    return `${guarantee.country} deposit guarantee`
  }
  if (terms.basis === 'variable') return 'variable rate'
  return null
}

// ---------------------------------------------------------------------------------------------
// A row's key facts and detail (Chris, 2026-11-13: "very digestible, easy on the eye, drawing
// you to the right information … just the key facts; customers can ask more questions")
// ---------------------------------------------------------------------------------------------

/** What a row carries beside its closed line: the provider, the facts to know, the detail. */
type RowFacts = {
  readonly providerId?: string
  readonly brand: MarketProductsCard['rows'][number]['brand']
  readonly mustKnow: string[]
  readonly detail: string[]
}

/** A sentence that tells someone to do something is not a fact: it is left out of the detail. */
const SAYS_TO = /\b(check|ask|confirm|contact)\b/i

/** Facts and sentences free of advice and instruction, without repeats, within their limits. */
function keep(lines: readonly (string | null)[], max: number): string[] {
  const kept: string[] = []
  for (const line of lines) {
    if (line === null || line.length === 0) continue
    if (adviceWordsIn(line).length > 0 || SAYS_TO.test(line)) continue
    if (!kept.includes(line)) kept.push(line)
  }
  return kept.slice(0, max)
}

const sentence = (text: string): string => {
  const trimmed = text.trim()
  const upper = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(upper) ? upper : `${upper}.`
}

/** The provider's id and brand for a market product. */
const providerOf = (product: ProductView): Pick<RowFacts, 'providerId' | 'brand'> => ({
  providerId: product.provider,
  brand: brandOf(product.provider),
})

/** "From Bank of Ireland’s own page, checked 9 November 2026." */
const sourceLine = (product: ProductView): string => {
  const day = product.provenance.checkedAt.slice(0, 10)
  return `From ${sourceOf(product)}, checked ${String(Number(day.slice(8, 10)))} ${monthName(day.slice(0, 7))}.`
}

/** "Not stated: the rate after the term; …." */
const notStatedLine = (product: ProductView): string | null =>
  product.unknowns.length === 0
    ? null
    : `Not stated by the source: ${product.unknowns.map((unknown) => unknown.meaning).join('; ')}.`

/**
 * A savings or deposit row's facts. `mustKnow`, at most three, in this order: how long the money
 * is tied up, how long the rate holds and what follows, whose deposit guarantee, what it does not
 * take of their saving, a bonus that is not counted, who can open it. `detail`, at most six:
 * what the money counts, which states the rate's period and what follows (and, for a fixed term
 * judged against the keys, when it ends and when the keys come), the conditions as the source
 * states them, who can open it, the source and the day, what is not stated, the guarantee.
 */
function savingsFacts(input: {
  readonly product: ProductView
  readonly terms: DepositTerms
  readonly figures: SavingsFigures
  readonly words: SavingsWords
  readonly figureBasis: string
  readonly asOf: AsOf
  /** The monthly saving the case has, for "monthly saving not accepted". */
  readonly monthly: number
  readonly bonus?: 'by_keys' | 'after_drawdown' | 'not_stated' | null | undefined
  /** A fixed term whose own keys month is later than the plan's: why, in one line. */
  readonly keysLine?: string | null | undefined
  /** An account judged on the monthly saving alone: what it does with the sum held. */
  readonly lumpLine?: string | null | undefined
  /** An account judged on the monthly saving alone: what it takes a month ("Takes up to €2,500 a month."). */
  readonly capLine?: string | null | undefined
}): RowFacts {
  const { product, terms, figures, words, asOf } = input
  const termMonths = terms.access === 'fixed_term' ? figures.termMonths : null
  const termEnd = termMonths === null ? null : addMonths(asOf, termMonths)
  const ends = words.ends
  const guarantee = product.depositGuarantee
  const abroad =
    guarantee !== null && guarantee.country !== null && guarantee.country !== 'Ireland'
      ? guarantee.country
      : null
  // What it takes of the monthly saving the case has, whatever the comparison placed in it.
  const takesMonthly = placement(terms, 0, input.monthly).monthly
  const notMonthly = input.monthly > 0 && takesMonthly === 0 && terms.takesLumpSum === true
  const someMonthly = takesMonthly > 0 && takesMonthly < input.monthly
  const who = statedConditions(product).find((line) => line.startsWith('who can open it: '))

  const rateEnds =
    ends !== null
      ? ends.after === null
        ? `Rate ends ${ends.endsShort}; the rate after is not stated`
        : `Rate ends ${ends.endsShort}, then ${ends.after}`
      : terms.access !== 'fixed_term' && terms.rateForNewAccounts
        ? 'Rate for new accounts; how long it holds is not stated'
        : !product.rateConfirmed
          ? 'Rate from CCPC only; how long it holds is not stated'
          : null
  const mustKnow = keep(
    [
      termEnd === null ? null : `Money locked until ${monthName(termEnd)}`,
      terms.access === 'notice' && terms.noticeDays !== null
        ? `${String(terms.noticeDays)} days’ notice to take money out`
        : null,
      rateEnds,
      abroad === null ? null : `Deposit guarantee: ${abroad}, not Ireland`,
      product.platform === null ? null : `Opened through ${product.platform.name}`,
      notMonthly
        ? 'Monthly saving not accepted; lump sum only'
        : someMonthly
          ? `Takes ${whole(takesMonthly)} of the ${whole(input.monthly)} a month`
          : null,
      input.lumpLine ?? null,
      figures.notPlaced.lumpSum > 0
        ? `${whole(figures.notPlaced.lumpSum)} of the sum is above what it takes`
        : null,
      input.bonus === 'after_drawdown'
        ? 'Bonus paid after the mortgage is drawn down; not counted'
        : input.bonus === 'not_stated'
          ? 'Bonus not counted: when it is paid is not stated'
          : null,
      who === undefined ? null : sentence(who).slice(0, -1),
    ],
    PRODUCTS_ROW_MAX_MUST_KNOW,
  )

  const conditions = statedConditions(product).filter((line) => !line.startsWith('who can open'))
  const detail = keep(
    [
      input.figureBasis,
      input.keysLine ?? null,
      input.capLine ?? null,
      conditions.length === 0 ? null : sentence(conditions.join('; ')),
      who === undefined ? null : sentence(who),
      sourceLine(product),
      notStatedLine(product),
      // A bank abroad and DIRT: a fact about tax, from the view's checks.
      ...product.checks.filter((line) => line.startsWith('Tax: ')),
      guarantee?.scheme === null || guarantee?.scheme === undefined
        ? null
        : `Protected by the ${guarantee.scheme}${guarantee.coverEur === null ? '' : `, to ${whole(guarantee.coverEur)} a person`}.`,
    ],
    PRODUCTS_ROW_MAX_DETAIL,
  )
  return { ...providerOf(product), mustKnow, detail }
}

function marketRow(
  product: ProductView,
  figures: SearchResult['figures'],
  horizon: Horizon,
  asOf: AsOf,
  lump: number,
  monthly: number,
  /** The monthly saving the case has, for the row's facts (a comparison on the sum held passes 0 as `monthly`). */
  factsMonthly: number = monthly,
): MarketRow | null {
  if (product.terms.kind !== 'deposit' || figures.kind !== 'savings') return null
  const rate = headlineRate(product.terms, figures.termMonths)
  if (rate === null) return null
  const words = savingsWords(product, product.terms, figures, {
    rate,
    money: figures.netInterest,
    horizon,
    asOf,
    lump,
    monthly,
  })
  return {
    rate,
    money: figures.netInterest,
    figureBasis: words.figureBasis,
    row: {
      id: product.id,
      lead: displayName(product),
      kind: accessKind(product.terms, figures.termMonths),
      value: words.value,
      figure: `${whole(figures.netInterest)} ${byWhen(horizon, figures.knownMonths, asOf)}`,
      note: words.note,
      held: false,
      confirmed: product.rateConfirmed,
      ...savingsFacts({
        product,
        terms: product.terms,
        figures,
        words,
        figureBasis: words.figureBasis,
        asOf,
        monthly: factsMonthly,
      }),
    },
  }
}

/** The reason an account that takes under half of the sum held is left out. */
const UNDER_HALF = 'Takes under half of the sum held'

type SavingsSearch = {
  readonly rows: MarketRow[]
  readonly matched: number
  readonly assumptions: string[]
  readonly excluded: { reason: string; count: number }[]
  readonly products: ProductView[]
  /** The accounts that take under half of the sum, by name: left out, and named in the coverage. */
  readonly partial: string[]
}

/** The engine's search over savings and deposits for a lump sum (and monthly saving). */
function searchSavings(
  market: Market,
  options: {
    readonly category: ProductsCategory | undefined
    readonly amount: number
    readonly monthly: number
    readonly horizon: Horizon
    readonly access?: 'instant' | 'fixed_term' | undefined
    readonly asOf: AsOf
    /** The monthly saving the case has, for the rows' facts; `monthly` by default. */
    readonly factsMonthly?: number | undefined
    /** Accounts shown in a group of their own (the regular savers): not set against the sum. */
    readonly setAside?: ((product: ProductView) => boolean) | undefined
  },
): SavingsSearch {
  const categories =
    options.category === 'savings'
      ? (['savings'] as const)
      : options.category === 'deposits'
        ? (['deposit'] as const)
        : (['savings', 'deposit'] as const)
  const responses = categories.map((category) =>
    search(
      market,
      {
        category,
        ...(options.amount > 0 ? { amount: options.amount } : {}),
        ...(options.monthly > 0 ? { monthlyAmount: options.monthly } : {}),
        horizonMonths: options.horizon.months,
        ...(options.access === undefined ? {} : { access: options.access }),
        objective: 'highest_net_return',
        limit: 25,
      },
      options.asOf,
    ),
  )
  // One account can be listed in both categories (a savings account that takes a lump sum):
  // it is one row.
  const seen = new Set<string>()
  const rows: MarketRow[] = []
  const products: ProductView[] = []
  const excluded = new Map<string, number>()
  let duplicates = 0
  let setAside = 0
  const partial: string[] = []
  for (const response of responses) {
    for (const result of response.results) {
      const row = marketRow(
        result.product,
        result.figures,
        options.horizon,
        options.asOf,
        options.amount,
        options.monthly,
        options.factsMonthly ?? options.monthly,
      )
      if (row === null) continue
      const keys = [accountOf(result.product), `${row.row.lead}|${row.row.kind}|${row.row.value}`]
      if (keys.some((key) => seen.has(key))) {
        duplicates += 1
        continue
      }
      for (const key of keys) seen.add(key)
      if (options.setAside?.(result.product) === true) {
        setAside += 1
        continue
      }
      // An account that takes under half of the money compared is not set against the rest.
      if (
        result.figures.kind === 'savings' &&
        options.amount > 0 &&
        result.figures.notPlaced.lumpSum > options.amount / 2
      ) {
        partial.push(row.row.lead)
        continue
      }
      rows.push(row)
      products.push(result.product)
    }
  }
  for (const response of responses) {
    for (const item of response.excluded) {
      excluded.set(item.reason, (excluded.get(item.reason) ?? 0) + item.count)
    }
  }
  if (partial.length > 0) excluded.set(UNDER_HALF, partial.length)
  return {
    rows,
    matched: Math.max(
      rows.length,
      responses.reduce((sum, response) => sum + response.matched, 0) -
        duplicates -
        setAside -
        partial.length,
    ),
    assumptions: [...new Set(responses.flatMap((response) => response.assumptions))].filter(
      (line) => !line.startsWith('No horizon given') && !line.startsWith('No amount given'),
    ),
    excluded: [...excluded].map(([reason, count]) => ({ reason, count })),
    products,
    partial,
  }
}

const byRate = (a: MarketRow, b: MarketRow): number => b.rate - a.rate || b.money - a.money

/** Interest after DIRT on a balance at a rate, credited every twelve months, over `months`. */
function heldInterest(balance: number, ratePct: number, months: number): number {
  let held = balance
  let interest = 0
  let pending = 0
  for (let month = 1; month <= months; month += 1) {
    pending += (held * ratePct) / 100 / 12
    if (month % 12 === 0 || month === months) {
      const net = pending * (1 - DIRT_RATE)
      interest += net
      held += net
      pending = 0
    }
  }
  return round2(interest)
}

function heldKind(account: HeldAccount): string {
  return account.kind === 'current'
    ? 'current account'
    : account.kind === 'deposit'
      ? 'fixed term'
      : 'savings'
}

/** Words that start a label without naming anyone: lowercased after "Your". */
const GENERIC_FIRST_WORD =
  /^(current|savings?|deposit|fixed|regular|instant|notice|online|joint|credit|rainy|emergency|easy|demand|the)\b/i

/** "Your BoI savings", "Your current account": the customer's label, read after "Your". */
const ownLabel = (account: HeldAccount): string => {
  const label = account.label.trim()
  if (/^your\b/i.test(label)) return `Your${label.slice(4)}`
  const own = label.replace(/^(my|our)\s+/i, '')
  const read = GENERIC_FIRST_WORD.test(own) ? own.charAt(0).toLowerCase() + own.slice(1) : own
  return `Your ${read}`
}

/** "A, B and C", or "A, B, C and 2 more" past `max`. */
function namesInWords(names: readonly string[], max = 5): string {
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  const parts = rest > 0 ? [...shown, `${String(rest)} more`] : shown
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
}

/** What a card set aside, beyond the accounts it compares (Chris, 2026-11-13: "why did SuperSaver not make the cut"). */
type SetAside = {
  /** The regular savers in their own group, judged on the monthly saving alone. */
  readonly regular?: {
    readonly count: number
    readonly monthly: number
    /** False on a card that judges every account on the monthly saving: no need to say so. */
    readonly judged?: boolean
    /** Those in the group that the card has no room for, by name. */
    readonly notShown: readonly string[]
  }
  /** The accounts that take under half of the sum held, by name. */
  readonly partial?: { readonly names: readonly string[]; readonly amount: number }
  /** Fixed terms left out of a card on the monthly saving. */
  readonly lumpOnly?: number
}

/**
 * The card's coverage in plain words: how many accounts it compares, where the figures come
 * from, and what it set aside and why, by name where a customer could ask about one.
 */
function coverageLine(
  matched: number,
  products: readonly ProductView[],
  excluded: readonly { reason: string; count: number }[],
  what: string,
  setAside: SetAside = {},
  takes = 'take this money',
): string {
  const checked = oldestCheck(products)
  const { regular, partial, lumpOnly } = setAside
  const named = partial !== undefined && partial.names.length > 0
  const rest = excluded.filter((item) => !(named && item.reason === UNDER_HALF))
  const left = rest.reduce((sum, item) => sum + item.count, 0)
  const top = [...rest].sort((a, b) => b.count - a.count)[0]
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)
  const parts = [
    regular === undefined || regular.count === 0
      ? null
      : `${String(regular.count)} ${plural(regular.count, 'regular saver is', 'regular savers are')}${regular.judged === false ? '' : ` judged on the ${whole(regular.monthly)} a month alone and`} shown in ${plural(regular.count, 'its', 'their')} own group` +
        (regular.notShown.length === 0
          ? ''
          : `, ${String(regular.notShown.length)} of them not on the card for room: ${namesInWords(regular.notShown, 8)}`),
    lumpOnly === undefined || lumpOnly === 0
      ? null
      : `${String(lumpOnly)} fixed ${plural(lumpOnly, 'term takes a lump sum only and is', 'terms take lump sums only and are')} left out`,
    !named || partial === undefined
      ? null
      : `${String(partial.names.length)} ${plural(partial.names.length, 'account takes', 'accounts take')} under half of the ${whole(partial.amount)} and ${plural(partial.names.length, 'is', 'are')} left out: ${namesInWords(partial.names)}`,
    left === 0 || top === undefined
      ? null
      : `${String(left)} ${named || regular !== undefined || lumpOnly !== undefined ? 'more ' : ''}left out (the most for: ${top.reason.toLowerCase()})`,
  ].filter((part): part is string => part !== null)
  return (
    `${String(matched)} ${what} on the Irish market ${takes}, from CCPC's comparison tables and the providers' own pages` +
    (checked === null ? '' : `, the oldest figure checked ${checked.slice(0, 10)}`) +
    (parts.length === 0 ? '.' : `; ${parts.join('; ')}.`)
  )
}

function savingsFiguresUsed(figures: CaseFigures, amount: number, horizon: Horizon): string[] {
  return [
    ...figures.held.map(
      (account) =>
        `${account.label}${account.provider === null ? '' : ` (${account.provider})`}: ${whole(account.balance)}` +
        (account.ratePct === null ? '' : ` at ${pct(account.ratePct)}`),
    ),
    `${whole(amount)} compared as a lump sum`,
    ...(figures.monthlySavingEur === null
      ? []
      : [`${whole(figures.monthlySavingEur)} a month saved`]),
    horizon.dated
      ? `${monthName(horizon.by)}, ${figures.keysFrom === 'plan' ? 'the month the money for the keys is there in your plan' : 'the date you gave'}`
      : `${String(NO_DATE_HORIZON)} months, as no date is known`,
  ]
}

/** Their own account's facts: the provider where it is one the market knows, what its money counts. */
function heldFacts(account: HeldAccount, line: string): RowFacts {
  const providerId = providerIdOf(account.provider)
  return {
    ...(providerId === null ? {} : { providerId }),
    brand: providerId === null ? null : brandOf(providerId),
    mustKnow: [],
    detail: keep([line], PRODUCTS_ROW_MAX_DETAIL),
  }
}

/**
 * Whether an account they hold is a regular saver: named one ("regular saver"), or named as a
 * regular saver the market holds from that provider ("BoI SuperSaver"). Pure.
 */
export function heldIsRegularSaver(market: Market, account: HeldAccount): boolean {
  if (account.kind !== 'savings') return false
  const label = account.label.toLowerCase()
  if (/\bregular\b/.test(label)) return true
  const provider = providerIdOf(account.provider)
  return market.products.some((product) => {
    if (!isRegularSaver(product)) return false
    if (provider !== null && product.provider !== provider) return false
    const name = product.name
      .toLowerCase()
      .replace(/\(.*?\)|\baccount\b/g, '')
      .trim()
    return name.length >= 6 && label.includes(name)
  })
}

function heldVsMarket(
  market: Market,
  figures: CaseFigures,
  request: ShowProductsRequest,
  asOf: AsOf,
): ProductsResult {
  if (figures.held.length === 0) {
    return {
      kind: 'questions',
      questions: [
        'Which account is the money in now, how much is in it, and what rate does it pay?',
      ],
    }
  }
  const horizon = horizonOf(figures, asOf)
  // A current account with no rate given earns what CCPC's current-account table states.
  const resolved = withHeldRates(market, {
    savings: figures.held.map((account) => ({
      label: account.label,
      balance: account.balance,
      ...(account.provider === null ? {} : { provider: account.provider }),
      ...(account.ratePct === null ? {} : { aerPct: account.ratePct }),
      ...(account.kind === 'current' ? { access: 'current_account' as const } : {}),
    })),
    debts: [],
  })
  const held = figures.held.map((account, index) => {
    const rate = resolved.situation.savings[index]?.aerPct ?? account.ratePct
    return { account, rate }
  })
  const amount = figures.held.reduce((sum, account) => sum + account.balance, 0)
  // Their own account is a regular saver and they save each month: the market's regular savers
  // are judged on the monthly saving alone, in a group of their own (2026-11-13).
  const monthly = figures.monthlySavingEur ?? 0
  const withRegular =
    monthly > 0 &&
    request.category !== 'deposits' &&
    figures.held.some((account) => heldIsRegularSaver(market, account))
  const found = searchSavings(market, {
    category: request.category,
    amount,
    monthly: 0,
    horizon,
    asOf,
    setAside: withRegular ? isRegularSaver : undefined,
  })
  const regular = withRegular
    ? monthlyRows(market, {
        which: 'regular',
        categories: categoriesOf(request.category),
        monthly,
        held: amount,
        horizon,
        asOf,
        style: 'by',
      })
    : { rows: [], excluded: new Map<string, number>() }
  const ranked = [...found.rows].sort(byRate)
  const heldLine = ({ account, rate }: (typeof held)[number]): string =>
    rate === null
      ? 'No money figure: the rate was not given.'
      : `${whole(heldInterest(account.balance, rate, horizon.months))} counts ${pct(rate)}, ` +
        (account.ratePct === null
          ? 'the rate in CCPC’s current-account table'
          : 'the rate given for it') +
        `, on ${whole(account.balance)} ${runsTo(horizon, horizon.months, asOf)}.`
  const baseline: Row[] = held.map((item, index) => {
    const { account, rate } = item
    return {
      id: `held:${String(index + 1)}`,
      lead: ownLabel(account),
      kind: heldKind(account),
      value: rate === null ? 'rate not given' : pct(rate),
      figure:
        rate === null
          ? `${whole(account.balance)} held`
          : `${whole(heldInterest(account.balance, rate, horizon.months))} ${byWhen(horizon, horizon.months, asOf)}`,
      note:
        rate === null
          ? 'its rate would let it be set against the market'
          : account.ratePct === null
            ? 'rate from CCPC’s current-account table'
            : null,
      held: true,
      confirmed: true,
      ...heldFacts(account, heldLine(item)),
    }
  })
  const heldBasis: RowBasis[] = held.map((item, index) => ({
    id: `held:${String(index + 1)}`,
    lead: ownLabel(item.account),
    value: item.rate === null ? 'rate not given' : pct(item.rate),
    line: heldLine(item),
  }))
  const room = Math.max(0, PRODUCTS_CARD_MAX_ROWS - baseline.length)
  const [marketShown = [], regularShown = []] = share<MarketRow>([ranked, regular.rows], room)
  const shown = [...regularShown, ...marketShown]
  const top = ranked[0]
  const ownRate = held.find((item) => item.rate !== null)?.rate ?? null
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.held_vs_market(figures.keysMonth),
      arrangement: {
        kind: 'held_vs_market',
        title: 'Your account against the market',
        line: 'By rate, your own account first; ask for them by access, or by the date, instead.',
      },
      rows: [...baseline.slice(0, PRODUCTS_CARD_MAX_ROWS), ...shown.map((item) => item.row)],
      more: Math.max(0, found.matched + regular.rows.length - shown.length),
      basis: {
        figures: savingsFiguresUsed(figures, amount, horizon),
        objective:
          'By AER, highest first, with your own account on top as the baseline. ' +
          moneyColumnLine(horizon) +
          (top === undefined || ownRate === null
            ? ''
            : ` The highest shown is ${pct(top.rate)} against ${pct(ownRate)} on your own account.`) +
          (regular.rows.length === 0
            ? ''
            : ` Regular savers by interest after DIRT on the ${whole(monthly)} a month alone, highest first.`),
        assumptions: [...resolved.basis, ...found.assumptions],
        coverage: coverageLine(
          found.matched,
          [...found.products, ...regular.rows.map((item) => item.product)],
          found.excluded,
          'savings and deposit accounts',
          {
            ...(withRegular
              ? {
                  regular: {
                    count: regular.rows.length,
                    monthly,
                    notShown: notShownOf(regular.rows, regularShown),
                  },
                }
              : {}),
            partial: { names: found.partial, amount },
          },
        ),
        warnings: warningsOf(
          shown.map((item) => item.row),
          [...found.products, ...regular.rows.map((item) => item.product)],
        ),
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: [...heldBasis.slice(0, PRODUCTS_CARD_MAX_ROWS), ...basisOf(shown)],
  }
}

/** What a keys month is worked out on: the case's saving towards the cash needed at the keys. */
function keysRunOf(figures: CaseFigures, saved: number, horizon: Horizon, asOf: AsOf): KeysRun {
  return {
    savedEur: saved,
    monthlyEur: figures.monthlySavingEur ?? 0,
    neededEur: figures.neededAtKeysEur,
    keysMonth: horizon.by,
    asOf,
  }
}

/** "Bank of Ireland Advantage Fixed Term Deposit Account at 18 months does not fit: …". */
const notFittingLines = (
  clamped: readonly { product: ProductView; pushedOut: readonly JudgedTerm[] }[],
) =>
  clamped.flatMap(({ product, pushedOut }) =>
    pushedOut.map(
      (term) =>
        `${displayName(product)} at ${String(term.months)} months does not fit: ${pushedOutLine(term)}`,
    ),
  )

/** An account judged against the keys month its own interest gives. */
type Fit = MarketRow & {
  readonly fixed: boolean
  readonly product: ProductView
  /** YYYY-MM the keys come in with this account's own interest. */
  readonly keysOn: string
  readonly pushedOut: readonly JudgedTerm[]
}

/** The categories a savings card reads: `savings` for regular saving, `deposits` for lump sums. */
const categoriesOf = (category: ProductsCategory | undefined): ReadonlySet<string> =>
  category === 'savings'
    ? new Set(['savings'])
    : category === 'deposits'
      ? new Set(['deposit'])
      : new Set(['savings', 'deposit'])

/** Accounts for children or students: not compared for a home. */
const CHILD = /child|kid|junior|teen|student|third level/i

/** Soonest keys first, then what it adds by them. */
const byKeys = (a: Fit, b: Fit): number =>
  a.keysOn.localeCompare(b.keysOn) || b.money - a.money || b.rate - a.rate

/**
 * "Interest stops at Nov 2027, the end of the term; the keys then come in August 2028, a month
 * after the plan's.": a fixed term whose own keys month is later than the plan's, because the
 * money stops earning at the term's end (the rate after it is not stated). Null otherwise.
 */
function keysLaterLine(term: JudgedTerm, planKeys: string): string | null {
  if (term.keysOn <= planKeys) return null
  const later = monthsUntil(`${planKeys}-01`, term.keysOn)
  return (
    `Interest stops at ${shortMonth(term.endsOn)}, the end of the term; the keys then come in ` +
    `${monthName(term.keysOn)}, ${later === 1 ? 'a month' : `${String(later)} months`} after the plan's.`
  )
}

/**
 * Every savings and deposit account judged against the keys (`term-fit.ts`): a fixed term at the
 * longest rung that ends at least the buffer before the keys month its own interest gives, any
 * other account to the keys month it gives; the money runs to that month, on what is held and
 * the monthly saving where it takes them. `fits_date` shows all of it; `by_access` takes the
 * fixed terms (`fixedOnly`), so the two show the same fixed-term rows with the same figures.
 */
function savingsFits(
  market: Market,
  options: {
    readonly categories: ReadonlySet<string>
    readonly saved: number
    readonly monthly: number
    readonly run: KeysRun
    readonly horizon: Horizon
    readonly asOf: AsOf
    readonly fixedOnly: boolean
    /** Accounts shown in a group of their own (the regular savers): left out here. */
    readonly setAside?: ((product: ProductView) => boolean) | undefined
  },
): {
  readonly fits: Fit[]
  readonly excluded: ReadonlyMap<string, number>
  readonly notFitting: { product: ProductView; pushedOut: readonly JudgedTerm[] }[]
  /** The accounts that take under half of the sum, by name. */
  readonly partial: readonly string[]
} {
  const { categories, saved, monthly, run, horizon, asOf, fixedOnly } = options
  const excluded = new Map<string, number>()
  const exclude = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1)
  const partial: string[] = []
  const notFitting: { product: ProductView; pushedOut: readonly JudgedTerm[] }[] = []
  const seen = new Set<string>()
  const fits: Fit[] = market.products.flatMap((product): Fit[] => {
    const terms = product.terms
    if (terms.kind !== 'deposit' || !categories.has(product.category)) return []
    if (fixedOnly && terms.access !== 'fixed_term') return []
    if (CHILD.test(product.name)) return []
    if (options.setAside?.(product) === true) return []
    let termMonths: number | null = null
    let keysOn: string
    let fitWords = ''
    let laterLine: string | null = null
    let pushedOut: readonly JudgedTerm[] = []
    if (terms.access === 'fixed_term') {
      const judged = termThatFits(terms, run)
      if (judged.pushedOut.length > 0) notFitting.push({ product, pushedOut: judged.pushedOut })
      if (judged.fit === null) {
        exclude(
          judged.pushedOut.length > 0
            ? 'Its interest brings the keys inside every term'
            : 'No term that ends a month before the keys',
        )
        return []
      }
      termMonths = judged.fit.months
      keysOn = judged.fit.keysOn
      pushedOut = judged.pushedOut
      fitWords = [fitLine(judged.fit), ...pushedOut.map(pushedOutLine)].join(' ')
      laterLine = keysLaterLine(judged.fit, horizon.by)
    } else {
      keysOn = keysMonthWith(terms, run, null) ?? horizon.by
      if (terms.access === 'notice' && (terms.noticeDays ?? 0) > monthsUntil(asOf, keysOn) * 30) {
        exclude(`Notice longer than the time to ${monthName(keysOn)}`)
        return []
      }
    }
    // The money runs to this account's own keys month.
    const own: Horizon = { months: monthsUntil(asOf, keysOn), by: keysOn, dated: true }
    const simulation = simulateDeposit(terms, {
      lumpSum: saved,
      monthly,
      horizonMonths: own.months,
      termMonths: termMonths ?? undefined,
      asOf,
    })
    const result = simulation.figures
    if (result.paidIn === 0) {
      exclude('Does not take this saving')
      return []
    }
    const rate = headlineRate(terms, termMonths)
    if (rate === null) return []
    const key = `${accountOf(product)}|${String(termMonths)}`
    const named = `${displayName(product)}|${String(termMonths)}|${String(rate)}`
    if (seen.has(key) || seen.has(named)) return []
    seen.add(key)
    seen.add(named)
    if (saved > 0 && result.notPlaced.lumpSum > saved / 2 && result.notPlaced.monthly >= monthly) {
      exclude(UNDER_HALF)
      partial.push(displayName(product))
      return []
    }
    // A bonus is not interest. It counts in the total by the date only when it is paid by then
    // (decision 2026-11-10: the MortgageSaver bonus is paid after drawdown, so it lowers the
    // mortgage's cost, never the money by the keys); a bonus whose payment date is not stated
    // is not assumed to arrive in time. After DIRT where DIRT applies.
    const statedBonus = round2(
      (terms.bonus?.amountEur ?? 0) * (terms.dirtApplies ? 1 - DIRT_RATE : 1),
    )
    const timing = statedBonus > 0 ? bonusTiming(product, terms, own.months) : null
    const bonus = timing === 'by_keys' ? statedBonus : 0
    const total = round2(result.netInterest + bonus)
    const words = savingsWords(product, terms, result, {
      rate,
      money: total,
      horizon: own,
      asOf,
      lump: saved,
      monthly,
    })
    const heldOnly =
      result.notPlaced.monthly > 0 && result.notPlaced.monthly >= monthly && monthly > 0
    const bonusNote =
      timing === 'by_keys'
        ? `includes a ${whole(bonus)} bonus${terms.dirtApplies ? ' after DIRT' : ''}, on its conditions`
        : timing === 'after_drawdown'
          ? 'bonus paid after drawdown, not counted'
          : timing === 'not_stated'
            ? `${whole(statedBonus)} bonus, not counted: when it is paid is not stated`
            : null
    // The rate's period first: the value names its end, and the note says what follows it.
    const note = words.period
      ? words.note
      : (bonusNote ?? (heldOnly ? 'the sum held only, not the monthly saving' : words.note))
    const bonusBasis =
      timing === 'by_keys'
        ? ` It includes a ${whole(bonus)} bonus${terms.dirtApplies ? ' after DIRT' : ''}, on its conditions.`
        : timing === 'after_drawdown'
          ? ` The ${whole(statedBonus)} bonus is paid after drawdown and is not counted.`
          : timing === 'not_stated'
            ? ` The ${whole(statedBonus)} bonus is not counted: when it is paid is not stated.`
            : ''
    const figureBasis =
      words.figureBasis +
      bonusBasis +
      (heldOnly ? ' It counts the sum held only, as it does not take the monthly saving.' : '') +
      (fitWords === '' ? '' : ` ${fitWords}`)
    return [
      {
        product,
        fixed: terms.access === 'fixed_term',
        keysOn,
        pushedOut,
        rate,
        money: total,
        figureBasis,
        row: {
          id: product.id,
          lead: displayName(product),
          kind: accessKind(terms, termMonths),
          value: words.value,
          figure: `keys ${shortMonth(keysOn)}, ${whole(total)}`,
          note,
          held: false,
          confirmed: product.rateConfirmed,
          ...savingsFacts({
            product,
            terms,
            figures: result,
            words,
            figureBasis,
            asOf,
            monthly,
            bonus: timing,
            keysLine: laterLine,
          }),
        },
      },
    ]
  })
  return { fits, excluded, notFitting, partial }
}

// ---------------------------------------------------------------------------------------------
// Regular savers (Chris, 2026-11-13: "why did SuperSaver and MortgageSaver not make the cut")
// ---------------------------------------------------------------------------------------------

/**
 * An account built for monthly saving: a savings account (CCPC's regular savings table, a
 * bank's regular-savings pages), not a fixed term, that takes monthly payments and either takes
 * no lump sum or caps what goes in each month. bunq's and MoCo's accounts take any lump sum with
 * no monthly cap, so they are not. Pure.
 */
export function isRegularSaver(product: ProductView): boolean {
  const terms = product.terms
  return (
    terms.kind === 'deposit' &&
    product.category === 'savings' &&
    terms.access !== 'fixed_term' &&
    terms.takesMonthly === true &&
    (terms.takesLumpSum !== true || terms.maxMonthlyEur !== null)
  )
}

/** A regular saver's kind on the card; its group is "Regular saver". */
export const REGULAR_SAVER_KIND = 'regular saver'

/** A row judged on the monthly saving alone, with its product. */
type MonthlyRow = MarketRow & { readonly product: ProductView }

/** Most money first, then the higher rate. */
const byMoney = (a: MarketRow, b: MarketRow): number => b.money - a.money || b.rate - a.rate

/**
 * Accounts judged on the monthly saving alone: `regular`, the regular savers; `open`, the other
 * instant-access and notice accounts that take monthly payments. The money is interest after
 * DIRT on the monthly payments to the horizon (`simulateDeposit`, the card's money rule: each
 * rate for as long as it is stated, the rate after where stated), within the account's monthly
 * cap, plus a bonus only when it is paid by then (`bonusTiming`). `style` is the figure's form:
 * "€279 by Jul 2028" (`by`) or "keys Jul 2028, €279" (`keys`).
 */
function monthlyRows(
  market: Market,
  options: {
    readonly which: 'regular' | 'open'
    readonly categories: ReadonlySet<string>
    readonly monthly: number
    /** The sum held, for what a regular saver does with it. */
    readonly held: number
    readonly horizon: Horizon
    readonly asOf: AsOf
    readonly style: 'by' | 'keys'
  },
): { readonly rows: MonthlyRow[]; readonly excluded: ReadonlyMap<string, number> } {
  const { which, categories, monthly, held, horizon, asOf, style } = options
  const excluded = new Map<string, number>()
  const exclude = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1)
  const seen = new Set<string>()
  const rows = market.products.flatMap((product): MonthlyRow[] => {
    const terms = product.terms
    if (terms.kind !== 'deposit' || !categories.has(product.category)) return []
    if (terms.access === 'fixed_term' || terms.takesMonthly !== true) return []
    if (isRegularSaver(product) !== (which === 'regular')) return []
    if (CHILD.test(product.name)) {
      exclude('For children or students')
      return []
    }
    if (
      terms.access === 'notice' &&
      horizon.dated &&
      (terms.noticeDays ?? 0) > monthsUntil(asOf, horizon.by) * 30
    ) {
      exclude(`Notice longer than the time to ${monthName(horizon.by)}`)
      return []
    }
    const rate = headlineRate(terms, null)
    if (rate === null) return []
    const key = accountOf(product)
    const named = `${displayName(product)}|${String(rate)}`
    if (seen.has(key) || seen.has(named)) return []
    seen.add(key)
    seen.add(named)
    const result = simulateDeposit(terms, {
      lumpSum: 0,
      monthly,
      horizonMonths: horizon.months,
      asOf,
    }).figures
    if (result.paidIn === 0) {
      exclude('Does not take this monthly saving')
      return []
    }
    const statedBonus = round2(
      (terms.bonus?.amountEur ?? 0) * (terms.dirtApplies ? 1 - DIRT_RATE : 1),
    )
    const timing = statedBonus > 0 ? bonusTiming(product, terms, horizon.months) : null
    const bonus = timing === 'by_keys' ? statedBonus : 0
    const total = round2(result.netInterest + bonus)
    const words = savingsWords(product, terms, result, {
      rate,
      money: total,
      horizon,
      asOf,
      lump: 0,
      monthly,
    })
    const taken = placement(terms, 0, monthly).monthly
    const bonusNote =
      timing === 'by_keys'
        ? `includes a ${whole(bonus)} bonus${terms.dirtApplies ? ' after DIRT' : ''}, on its conditions`
        : timing === 'after_drawdown'
          ? 'bonus paid after drawdown, not counted'
          : timing === 'not_stated'
            ? `${whole(statedBonus)} bonus, not counted: when it is paid is not stated`
            : null
    const bonusBasis =
      timing === 'by_keys'
        ? ` It includes a ${whole(bonus)} bonus${terms.dirtApplies ? ' after DIRT' : ''}, on its conditions.`
        : timing === 'after_drawdown'
          ? ` The ${whole(statedBonus)} bonus is paid after drawdown and is not counted.`
          : timing === 'not_stated'
            ? ` The ${whole(statedBonus)} bonus is not counted: when it is paid is not stated.`
            : ''
    const figureBasis =
      words.figureBasis +
      bonusBasis +
      ` It counts the ${whole(taken)} a month alone` +
      (taken < monthly ? `, all it takes of the ${whole(monthly)}` : '') +
      (held > 0 ? `, not the ${whole(held)} held.` : '.')
    // What a regular saver does with the sum held: nothing, or a capped part not counted here.
    const lumpLine =
      which !== 'regular'
        ? null
        : terms.takesLumpSum !== true
          ? held > 0
            ? `Monthly payments only; the ${whole(held)} needs another account`
            : 'Monthly payments only'
          : `Also takes ${terms.maxLumpSumEur === null ? 'a lump sum' : `up to ${whole(terms.maxLumpSumEur)} as a lump sum`}` +
            (terms.lumpSumAerPct === null ? '' : `, at ${pct(terms.lumpSumAerPct)}`)
    // The monthly cap in the detail, unless the source's conditions already state it.
    const capStated =
      terms.maxMonthlyEur !== null &&
      statedConditions(product).some((line) => line.includes(whole(terms.maxMonthlyEur ?? 0)))
    const capLine =
      terms.maxMonthlyEur === null || capStated
        ? null
        : `Takes up to ${whole(terms.maxMonthlyEur)} a month` +
          ((terms.minMonthlyEur ?? 0) > 1 ? `, at least ${whole(terms.minMonthlyEur ?? 0)}.` : '.')
    return [
      {
        product,
        rate,
        money: total,
        figureBasis,
        row: {
          id: product.id,
          lead: displayName(product),
          kind: which === 'regular' ? REGULAR_SAVER_KIND : accessKind(terms, null),
          value: words.value,
          figure:
            style === 'keys'
              ? `keys ${shortMonth(horizon.by)}, ${whole(total)}`
              : `${whole(total)} ${byWhen(horizon, result.knownMonths, asOf)}`,
          note: words.period ? words.note : (bonusNote ?? words.note),
          held: false,
          confirmed: product.rateConfirmed,
          ...savingsFacts({
            product,
            terms,
            figures: result,
            words,
            figureBasis,
            asOf,
            monthly,
            bonus: timing,
            lumpLine,
            capLine,
          }),
        },
      },
    ]
  })
  return { rows: rows.sort(byMoney), excluded }
}

/**
 * The card's rows shared between its groups: one at a time to each group that has more, in the
 * groups' order, until the card is full. Two full groups get four each; a short one gives its
 * room to the others.
 */
function share<T>(lists: readonly (readonly T[])[], max: number): T[][] {
  const taken = lists.map(() => 0)
  let total = 0
  let moved = true
  while (moved && total < max) {
    moved = false
    for (const [index, list] of lists.entries()) {
      const count = taken[index] ?? 0
      if (total < max && count < list.length) {
        taken[index] = count + 1
        total += 1
        moved = true
      }
    }
  }
  return lists.map((list, index) => list.slice(0, taken[index] ?? 0))
}

/** The figure basis of rows, for the model beside the card. */
const basisOf = (rows: readonly MarketRow[]): RowBasis[] =>
  rows.map((item) => ({
    id: item.row.id,
    lead: item.row.lead,
    value: item.row.value,
    line: item.figureBasis,
  }))

/** The rows of a group the card has no room for, by name. */
const notShownOf = (all: readonly MarketRow[], shown: readonly MarketRow[]): string[] =>
  all.filter((item) => !shown.includes(item)).map((item) => item.row.lead)

/** The map of reasons as the coverage takes them. */
const reasonsOf = (...maps: readonly ReadonlyMap<string, number>[]) => {
  const merged = new Map<string, number>()
  for (const map of maps) {
    for (const [reason, count] of map) merged.set(reason, (merged.get(reason) ?? 0) + count)
  }
  return [...merged].map(([reason, count]) => ({ reason, count }))
}

function byAccess(
  market: Market,
  figures: CaseFigures,
  request: ShowProductsRequest,
  asOf: AsOf,
): ProductsResult {
  const amount = figures.held.reduce((sum, account) => sum + account.balance, 0)
  if (amount <= 0) {
    return { kind: 'questions', questions: ['How much is saved now, and where is it?'] }
  }
  const horizon = horizonOf(figures, asOf)
  const monthly = figures.monthlySavingEur ?? 0
  // With a monthly saving, the regular savers are judged on it alone, in a group of their own
  // (2026-11-13), and not set against the sum held: an account appears once.
  const withRegular = monthly > 0 && request.category !== 'deposits'
  const setAside = withRegular ? isRegularSaver : undefined
  const common = {
    category: request.category,
    amount,
    monthly: 0,
    horizon,
    asOf,
    factsMonthly: monthly,
    setAside,
  }
  const instant = searchSavings(market, { ...common, access: 'instant' })
  // With a keys month, the fixed terms are fits_date's own (`savingsFits`): the same rule, the
  // same rows, the same figures, in the same order. A fixed term is a lump-sum deposit, so a
  // card narrowed to regular saving still reads them on this side: without them it is not
  // instant access against fixed term.
  let fixedRows: MarketRow[]
  let fixedProducts: ProductView[]
  let fixedMatched: number
  let fixedExcluded: { reason: string; count: number }[]
  let fixedAssumptions: string[]
  let fixedPartial: readonly string[]
  if (horizon.dated) {
    const judged = savingsFits(market, {
      categories: categoriesOf(request.category === 'deposits' ? 'deposits' : undefined),
      saved: amount,
      monthly,
      run: keysRunOf(figures, amount, horizon, asOf),
      horizon,
      asOf,
      fixedOnly: true,
    })
    const fits = [...judged.fits].sort(byKeys)
    fixedRows = fits
    fixedProducts = fits.map((fit) => fit.product)
    fixedMatched = fits.length
    fixedExcluded = [...judged.excluded].map(([reason, count]) => ({ reason, count }))
    fixedAssumptions = notFittingLines(judged.notFitting)
    fixedPartial = judged.partial
  } else {
    const fixed = searchSavings(market, { ...common, access: 'fixed_term' })
    fixedRows = [...fixed.rows].sort(byRate)
    fixedProducts = fixed.products
    fixedMatched = fixed.matched
    fixedExcluded = fixed.excluded
    fixedAssumptions = fixed.assumptions
    fixedPartial = fixed.partial
  }
  const regular = withRegular
    ? monthlyRows(market, {
        which: 'regular',
        categories: categoriesOf(request.category),
        monthly,
        held: amount,
        horizon,
        asOf,
        style: 'by',
      })
    : { rows: [], excluded: new Map<string, number>() }
  const instantRows = [...instant.rows].sort(byRate)
  const [instantShown = [], fixedShown = [], regularShown = []] = share(
    [instantRows, fixedRows, regular.rows],
    PRODUCTS_CARD_MAX_ROWS,
  )
  // The price of access: what the fixed term that adds most adds over the instant-access
  // account that adds most, in euro on the sum held, with the two rates.
  const mostOf = (rows: readonly MarketRow[]) =>
    [...rows].sort((a, b) => b.money - a.money || b.rate - a.rate)[0]
  const topInstant = mostOf(instantRows)
  const topFixed = mostOf(fixedRows)
  const priceLine =
    topInstant === undefined || topFixed === undefined
      ? ''
      : topFixed.money - topInstant.money >= 1
        ? ` The fixed term that adds most (${topFixed.row.value}) adds ${whole(topFixed.money - topInstant.money)} more on ${whole(amount)} than the instant-access account that adds most (${topInstant.row.value}): that is the price of access.`
        : ` The instant-access account that adds most (${topInstant.row.value}) adds as much as any fixed term that ends in time, so access costs nothing here.`
  const regularLine =
    regular.rows.length === 0
      ? ''
      : ` Regular savers last, by interest after DIRT on the ${whole(monthly)} a month alone, highest first.`
  const products = [
    ...instant.products,
    ...fixedProducts,
    ...regular.rows.map((item) => item.product),
  ]
  const matched = instant.matched + fixedMatched
  const shown = [...instantShown, ...fixedShown, ...regularShown]
  const partial = [...instant.partial, ...fixedPartial]
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.by_access(figures.keysMonth),
      arrangement: {
        kind: 'by_access',
        title: 'Instant access against fixed term',
        line: horizon.dated
          ? 'Instant access by rate beside fixed terms that end in time for the keys, by their keys month; ask for them against your own account, or by the date, instead.'
          : `Instant access beside fixed terms that end in time for ${String(horizon.months)} months, each by rate; ask for them against your own account, or by the date, instead.`,
      },
      rows: shown.map((item) => item.row),
      more: Math.max(0, matched + regular.rows.length - shown.length),
      basis: {
        figures: savingsFiguresUsed(figures, amount, horizon),
        objective: horizon.dated
          ? `Instant access first, by AER, highest first; then fixed terms, by the keys month each gives with its own interest, soonest first, then by interest after DIRT.${regularLine}${priceLine} ` +
            `${moneyColumnLine(horizon)} A fixed term's money runs to the keys month that term gives, as it does by the date. ${TERM_FIT_RULE}`
          : `Instant access first, then fixed term; each by AER, highest first.${regularLine}${priceLine} ${moneyColumnLine(horizon)}`,
        assumptions: [...new Set([...instant.assumptions, ...fixedAssumptions])],
        coverage: coverageLine(
          matched,
          products,
          [...instant.excluded, ...fixedExcluded],
          'instant-access and fixed-term accounts',
          {
            ...(withRegular
              ? {
                  regular: {
                    count: regular.rows.length,
                    monthly,
                    notShown: notShownOf(regular.rows, regularShown),
                  },
                }
              : {}),
            partial: { names: partial, amount },
          },
        ),
        warnings: warningsOf(
          shown.map((item) => item.row),
          products,
        ),
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: basisOf(shown),
  }
}

/**
 * A card on the monthly saving (`focus: 'monthly'`, Chris 2026-11-13: "what product is best for
 * my monthly savings then?" answered in prose): the regular savers first, then the instant-access
 * and notice accounts that also take monthly payments, each judged on the monthly saving alone
 * to the keys month and sorted by money; fixed terms take lump sums only and are left out, and
 * the coverage says so. The same rows for `by_access` and `fits_date`, in each one's figure form.
 */
function monthlyCard(
  market: Market,
  figures: CaseFigures,
  request: ShowProductsRequest & { readonly arrangement: 'by_access' | 'fits_date' },
  asOf: AsOf,
): ProductsResult {
  const monthly = figures.monthlySavingEur ?? 0
  if (monthly <= 0) {
    return { kind: 'questions', questions: ['How much goes aside each month?'] }
  }
  if (request.arrangement === 'fits_date' && figures.keysMonth === null) {
    return {
      kind: 'questions',
      questions: ['When would you like to have the keys? The month is enough.'],
    }
  }
  const horizon = horizonOf(figures, asOf)
  const held = figures.held.reduce((sum, account) => sum + account.balance, 0)
  const categories = categoriesOf(request.category === 'deposits' ? undefined : request.category)
  const style = request.arrangement === 'fits_date' ? 'keys' : 'by'
  const common = { categories, monthly, held, horizon, asOf, style } as const
  const regular = monthlyRows(market, { ...common, which: 'regular' })
  const open = monthlyRows(market, { ...common, which: 'open' })
  const lumpOnly = new Set(
    market.products
      .filter(
        (product) =>
          product.terms.kind === 'deposit' &&
          product.terms.access === 'fixed_term' &&
          categories.has(product.category),
      )
      .map((product) => accountOf(product)),
  ).size
  const [regularShown = [], openShown = []] = share(
    [regular.rows, open.rows],
    PRODUCTS_CARD_MAX_ROWS,
  )
  const shown = [...regularShown, ...openShown]
  const all = [...regular.rows, ...open.rows]
  const products = all.map((item) => item.product)
  const to = horizon.dated
    ? `the keys in ${monthName(horizon.by)}`
    : `${String(horizon.months)} months`
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: horizon.dated
        ? `Where can the ${whole(monthly)} a month go until the keys in ${monthName(horizon.by)}?`
        : `Where can the ${whole(monthly)} a month go?`,
      arrangement: {
        kind: request.arrangement,
        title: `Accounts for your ${whole(monthly)} a month`,
        line: `By what each account earns on the ${whole(monthly)} a month to ${to}, regular savers first; ask about the sum held, by access or by the date, instead.`,
      },
      rows: shown.map((item) => item.row),
      more: Math.max(0, all.length - shown.length),
      basis: {
        figures: [
          `${whole(monthly)} a month saved, placed in each account up to what it takes`,
          ...(held > 0 ? [`${whole(held)} held, not counted on this card`] : []),
          horizon.dated
            ? `${monthName(horizon.by)}, ${figures.keysFrom === 'plan' ? 'the month the money for the keys is there in your plan' : 'the date you gave'}`
            : `${String(NO_DATE_HORIZON)} months, as no date is known`,
        ],
        objective:
          'Regular savers first, then instant access and notice; each by interest after DIRT on the monthly saving alone, highest first, plus any bonus paid by then. ' +
          moneyColumnLine(horizon),
        assumptions: [
          ...SAVINGS_ASSUMPTIONS.filter((line) => !line.startsWith('Bonuses')),
          'A bonus is counted in the total by the date only when it is paid by then; one paid after the mortgage is drawn down, or whose payment date is not stated, is noted and not counted.',
        ],
        coverage: coverageLine(
          all.length,
          products,
          reasonsOf(regular.excluded, open.excluded),
          'savings accounts',
          {
            regular: {
              count: regular.rows.length,
              monthly,
              judged: false,
              notShown: notShownOf(regular.rows, regularShown),
            },
            lumpOnly,
          },
          `take the ${whole(monthly)} a month`,
        ),
        warnings: warningsOf(
          shown.map((item) => item.row),
          products,
        ),
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: basisOf(shown),
  }
}

/**
 * When a deposit's bonus is paid, against the months to the keys: `after_drawdown` for a saver
 * whose bonus needs the lender's mortgage drawn down (`LINKED_SAVERS`, or conditions that say
 * so), `by_keys` for one recorded as paid before drawdown within the time, `not_stated` else.
 */
export function bonusTiming(
  product: ProductView,
  terms: DepositTerms,
  horizonMonths: number,
): 'by_keys' | 'after_drawdown' | 'not_stated' {
  const saver = (LINKED_SAVERS[product.provider] ?? []).find((item) =>
    product.id.endsWith(`:${item.productId}`),
  )
  if (saver !== undefined) {
    if (saver.paid === 'after_drawdown') return 'after_drawdown'
    return saver.minMonths <= horizonMonths ? 'by_keys' : 'not_stated'
  }
  if ((terms.bonus?.conditions ?? []).some((line) => /mortgage drawn down/i.test(line))) {
    return 'after_drawdown'
  }
  return 'not_stated'
}

function fitsDate(
  market: Market,
  figures: CaseFigures,
  request: ShowProductsRequest,
  asOf: AsOf,
): ProductsResult {
  if (figures.keysMonth === null) {
    return {
      kind: 'questions',
      questions: ['When would you like to have the keys? The month is enough.'],
    }
  }
  const saved = figures.held.reduce((sum, account) => sum + account.balance, 0)
  const monthly = figures.monthlySavingEur ?? 0
  if (saved <= 0 && monthly <= 0) {
    return {
      kind: 'questions',
      questions: ['How much is saved now, and how much goes aside each month?'],
    }
  }
  const horizon = horizonOf(figures, asOf)
  if (!horizon.dated) {
    return {
      kind: 'questions',
      questions: ['The keys month has passed: when would you like to have the keys now?'],
    }
  }
  // Each account's keys month is the one the plan reaches with its own interest; a fixed term
  // is the longest that ends at least the buffer before it (`term-fit.ts`).
  const run = keysRunOf(figures, saved, horizon, asOf)
  // With a monthly saving, the regular savers are judged on it alone, in a group of their own
  // (2026-11-13), and not set against the sum held: an account appears once.
  const withRegular = monthly > 0 && request.category !== 'deposits'
  const { fits, excluded, notFitting, partial } = savingsFits(market, {
    categories: categoriesOf(request.category),
    saved,
    monthly,
    run,
    horizon,
    asOf,
    fixedOnly: false,
    setAside: withRegular ? isRegularSaver : undefined,
  })
  const regular = withRegular
    ? monthlyRows(market, {
        which: 'regular',
        categories: categoriesOf(request.category),
        monthly,
        held: saved,
        horizon,
        asOf,
        style: 'keys',
      })
    : { rows: [], excluded: new Map<string, number>() }
  const fixed = fits.filter((fit) => fit.fixed).sort(byKeys)
  const open = fits.filter((fit) => !fit.fixed).sort(byKeys)
  const [fixedShown = [], regularShown = [], openShown = []] = share<MarketRow>(
    [fixed, regular.rows, open],
    PRODUCTS_CARD_MAX_ROWS,
  )
  const shown = [...fixedShown, ...regularShown, ...openShown]
  const products = [...fits.map((fit) => fit.product), ...regular.rows.map((item) => item.product)]
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.fits_date(horizon.by),
      arrangement: {
        kind: 'fits_date',
        title: `Accounts that fit ${monthName(horizon.by)}`,
        line:
          regular.rows.length === 0
            ? 'Fixed terms that end a month before the keys, then instant access and notice, each by its keys month; ask for them by access, or against your own account, instead.'
            : 'Fixed terms that end before the keys, then regular savers on the monthly saving, then instant access and notice; ask for them by access, or against your account, instead.',
      },
      rows: shown.map((fit) => fit.row),
      more: Math.max(0, fits.length + regular.rows.length - shown.length),
      basis: {
        figures: [
          ...savingsFiguresUsed(figures, saved, horizon).filter(
            (line) => !line.endsWith('compared as a lump sum'),
          ),
          `${whole(saved)} held and ${whole(monthly)} a month, placed where each account takes them`,
          ...(figures.neededAtKeysEur === null
            ? []
            : [`${whole(figures.neededAtKeysEur)} needed at the keys`]),
        ],
        objective:
          'By the keys month each account gives with its own interest, soonest first, then by interest after DIRT plus any bonus by then. ' +
          (regular.rows.length === 0
            ? ''
            : `Regular savers by interest after DIRT on the ${whole(monthly)} a month alone to ${monthName(horizon.by)}, highest first. `) +
          `${moneyColumnLine(horizon, 'own_keys')} ${TERM_FIT_RULE}`,
        assumptions: [
          ...SAVINGS_ASSUMPTIONS.filter((line) => !line.startsWith('Bonuses')),
          'A bonus is counted in the total by the date only when it is paid by then; one paid after the mortgage is drawn down, or whose payment date is not stated, is noted and not counted.',
          ...(figures.neededAtKeysEur === null
            ? [
                `The cash needed at the keys is not known, so every account is set against ${monthName(horizon.by)}.`,
              ]
            : []),
          ...notFittingLines(notFitting),
        ],
        coverage: coverageLine(
          fits.length,
          products,
          [...excluded].map(([reason, count]) => ({ reason, count })),
          'savings and deposit accounts',
          {
            ...(withRegular
              ? {
                  regular: {
                    count: regular.rows.length,
                    monthly,
                    notShown: notShownOf(regular.rows, regularShown),
                  },
                }
              : {}),
            partial: { names: partial, amount: saved },
          },
        ),
        warnings: warningsOf(
          shown.map((fit) => fit.row),
          products,
        ),
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: basisOf(shown),
  }
}

/** The warnings that attach to the rows shown: a rate on CCPC's figure alone, another country's guarantee. */
function warningsOf(rows: readonly Row[], products: readonly ProductView[]): string[] {
  const shown = new Set(rows.map((row) => row.id))
  const warnings = new Set<string>()
  for (const product of products) {
    if (!shown.has(product.id)) continue
    if (!product.rateConfirmed) warnings.add(UNCONFIRMED_RATE)
    const guarantee = product.depositGuarantee
    if (guarantee !== null && guarantee.country !== null && guarantee.country !== 'Ireland') {
      warnings.add(
        `${displayName(product)}: protected by the ${guarantee.scheme ?? 'deposit guarantee'} of ${guarantee.country}, not the Irish scheme.`,
      )
    }
    if (product.platform !== null) warnings.add(product.platform.note)
  }
  warnings.add('Rates change; the provider’s own terms are what count.')
  return [...warnings]
}

// ---------------------------------------------------------------------------------------------
// Mortgages
// ---------------------------------------------------------------------------------------------

/**
 * A mortgage option's facts. `mustKnow`: how long the rate is fixed and what follows, a minimum
 * loan, cashback counted and not counted, incentives on CCPC's word alone. `detail`: the option
 * in a sentence, its conditions, the 30-year figure, the green note, the sources.
 */
function mortgageFacts(
  pathway: HomePathways['pathways'][number],
  minLoan: string | null,
): RowFacts {
  const { mortgage } = pathway
  const fixed =
    mortgage.rateType === 'fixed' && mortgage.fixedYears !== null
      ? mortgage.followOnRatePct === null || pathway.followOnAssumed
        ? `Fixed for ${String(mortgage.fixedYears)} years; the rate after is not stated`
        : `Fixed for ${String(mortgage.fixedYears)} years, then ${pct(mortgage.followOnRatePct)} variable`
      : 'A variable rate: the lender can change it'
  return {
    providerId: pathway.lender,
    brand: brandOf(pathway.lender),
    mustKnow: keep(
      [
        fixed,
        minLoan !== null
          ? `For loans of ${minLoan} or more`
          : pathway.conditions.some((line) => line.includes('minimum loan is not stated'))
            ? 'A higher-value rate; the minimum loan is not stated'
            : null,
        pathway.cashbackEur > 0
          ? `${whole(pathway.cashbackEur)} cashback counted in the cost`
          : null,
        pathway.cashbackAfterEur > 0
          ? `${whole(pathway.cashbackAfterEur)} more cashback after ${String(HORIZON_YEARS)} years, not counted`
          : null,
        pathway.confirmed ? null : 'Incentives from CCPC only',
      ],
      PRODUCTS_ROW_MAX_MUST_KNOW,
    ),
    detail: keep(
      [
        pathway.line,
        ...pathway.conditions.map(sentence),
        pathway.thirtyYearNetEur === null
          ? null
          : `Over 30 years, ${whole(pathway.thirtyYearNetEur)} if today’s follow-on rates held.`,
        pathway.greenNote,
      ],
      PRODUCTS_ROW_MAX_DETAIL,
    ),
  }
}

function mortgageBySort(
  market: Market,
  figures: CaseFigures,
  request: ShowProductsRequest,
  asOf: AsOf,
): ProductsResult {
  if (figures.priceEur === null) {
    return { kind: 'questions', questions: ['What price of home are you looking at?'] }
  }
  const filters = request.filters ?? {}
  if (filters.stayWithBank === true && figures.currentBank === null) {
    return { kind: 'questions', questions: ['Which bank is your current account with?'] }
  }
  const sortBy: HomeSort = request.sortBy ?? figures.sortBy ?? 'five_year_cost'
  const keys = figures.keysMonth ?? addMonths(asOf, NO_DATE_HORIZON)
  const saved = figures.held.reduce((sum, account) => sum + account.balance, 0)
  const home = homePathways({
    market,
    firstTimeBuyer: figures.firstTimeBuyer ?? true,
    firstTimeBuyerStated: figures.firstTimeBuyer !== null,
    newBuild: figures.newBuild ?? false,
    annualGrossIncome: figures.incomeEur ?? undefined,
    homePrice: figures.priceEur,
    taxPaid: figures.taxPaidEur ?? undefined,
    // Unused with a price given: the price is not worked back from the savings.
    savedByGoal: saved,
    goalDate: keys,
    reachedOn: () => figures.keysMonth,
    monthlySaving: figures.monthlySavingEur ?? 0,
    monthName,
    savers: [],
    preferences: {
      sortBy,
      ...(filters.stayWithBank === true && figures.currentBank !== null
        ? { stayWithBank: true, currentBank: figures.currentBank }
        : {}),
      ...(filters.rateType === undefined ? {} : { rateType: filters.rateType }),
      ...(filters.green === undefined ? {} : { green: filters.green }),
    },
  })
  if (home === null || home.pathways.length === 0) {
    return {
      kind: 'questions',
      questions: [
        filters.stayWithBank === true || filters.rateType !== undefined
          ? 'No lender option fits with those filters: would you like them without the filter?'
          : 'What price of home are you looking at, and what do you both earn before tax?',
      ],
    }
  }
  const rows: Row[] = home.pathways.slice(0, PRODUCTS_CARD_MAX_ROWS).map((pathway) => {
    const term =
      pathway.mortgage.rateType === 'fixed' && pathway.mortgage.fixedYears !== null
        ? `${String(pathway.mortgage.fixedYears)}-year fixed`
        : 'variable'
    const cost = `${whole(pathway.netCostEur)} over ${String(HORIZON_YEARS)} years`
    const minLoan = /is for loans of (€[\d,]+) or more/.exec(pathway.conditions.join(' '))?.[1]
    const note =
      minLoan !== undefined
        ? `needs a ${minLoan} loan`
        : pathway.conditions.some((line) => line.includes('minimum loan is not stated'))
          ? 'minimum loan not stated'
          : pathway.followOnAssumed
            ? 'follow-on rate not stated'
            : !pathway.confirmed
              ? 'incentives from CCPC only'
              : pathway.cashbackEur > 0
                ? `${whole(pathway.cashbackEur)} cashback counted`
                : null
    return {
      id: pathway.mortgage.productId,
      lead: `${pathway.lenderName} ${pathway.mortgage.name}`.replace(
        `${pathway.lenderName} ${pathway.lenderName}`,
        pathway.lenderName,
      ),
      kind: `${term} at ${pct(pathway.mortgage.ratePct)}`,
      value: `${whole(pathway.mortgage.monthlyRepayment)}/mo`,
      figure:
        sortBy === 'keys_date'
          ? `keys ${pathway.keysOn === null ? 'not reached' : shortMonth(pathway.keysOn)}, ${cost}`
          : sortBy === 'monthly_repayment'
            ? `${cost}`
            : cost,
      note,
      held: false,
      confirmed: pathway.confirmed,
      ...mortgageFacts(pathway, minLoan ?? null),
    }
  })
  const lenders = new Set(home.pathways.map((pathway) => pathway.lender)).size
  const checked = oldestCheck(
    market.products.filter((product) =>
      home.pathways.some((pathway) => pathway.mortgage.productId === product.id),
    ),
  )
  const otherSorts = (Object.keys(SORT_WORDS) as HomeSort[])
    .filter((sort) => sort !== sortBy)
    .map((sort) =>
      sort === 'five_year_cost'
        ? 'cost over five years'
        : sort === 'keys_date'
          ? 'keys date'
          : 'monthly repayment',
    )
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.mortgage_by_sort(figures.keysMonth),
      arrangement: {
        kind: 'mortgage_by_sort',
        title: `Mortgage options at ${String(Math.round(home.ltvPct))}% loan-to-value`,
        line: `Arranged by ${SORT_WORDS[sortBy]}${request.sortBy === undefined && figures.sortBy !== null ? ', the order you chose' : ''}; ask for them by ${otherSorts.join(', or by ')}, instead${home.filters.length > 0 ? ' (filters are in the basis)' : ''}.`,
      },
      rows,
      more: Math.max(0, home.pathways.length - rows.length),
      basis: {
        figures: [
          `a ${whole(home.price)} home, ${whole(home.loan)} borrowed (${String(home.ltvPct)}% of the price)`,
          ...(figures.incomeEur === null ? [] : [`${whole(figures.incomeEur)} a year before tax`]),
          `${whole(saved)} saved${figures.monthlySavingEur === null ? '' : `, ${whole(figures.monthlySavingEur)} a month`}`,
          ...(figures.keysMonth === null ? [] : [`keys ${monthName(figures.keysMonth)}`]),
          ...home.filters,
        ],
        objective: `${home.sortedBy} Each option is a lender’s product per rate type and fixed period, its cost over the first ${String(HORIZON_YEARS)} years being interest and the valuation fee less cashback and any savings bonus.`,
        assumptions: [...home.assumptions],
        coverage:
          `${String(home.pathways.length)} options from ${String(lenders)} lender${lenders === 1 ? '' : 's'} that fit ${whole(home.loan)} at ${String(home.ltvPct)}% loan-to-value, from CCPC's mortgage tables and the lenders' own pages` +
          (checked === null ? '' : `, the oldest checked ${checked.slice(0, 10)}`) +
          (home.leftOut.length === 0 ? '.' : `; left out: ${home.leftOut.join(' ')}`) +
          ' The lender’s own assessment decides what is lent; the Central Bank limits are what the limits allow.',
        warnings: [...MORTGAGE_WARNINGS],
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: [],
  }
}

// ---------------------------------------------------------------------------------------------
// The entry
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Groups (Chris, 2026-11-13: instant access and fixed term in one undivided list)
// ---------------------------------------------------------------------------------------------

type Group = NonNullable<MarketProductsCard['arrangement']['groups']>[number]

/** "Instant access", "Notice", "Fixed term" or "Regular saver", from a savings row's kind. */
const accessGroup = (row: Row): string =>
  row.kind === REGULAR_SAVER_KIND
    ? 'Regular saver'
    : row.kind.endsWith('notice')
      ? 'Notice'
      : /fixed/.test(row.kind)
        ? 'Fixed term'
        : 'Instant access'

/**
 * How each arrangement divides its rows, and the order of the groups; null: one list (a
 * mortgage card's options are one comparison).
 */
const GROUPING: Readonly<
  Record<
    ProductsArrangement,
    { readonly labelOf: (row: Row) => string; readonly order: readonly string[] } | null
  >
> = {
  held_vs_market: {
    labelOf: (row) =>
      row.held ? 'Yours' : row.kind === REGULAR_SAVER_KIND ? 'Regular saver' : 'The market',
    order: ['Yours', 'Regular saver', 'The market'],
  },
  by_access: {
    labelOf: accessGroup,
    order: ['Instant access', 'Notice', 'Fixed term', 'Regular saver'],
  },
  fits_date: {
    labelOf: accessGroup,
    order: ['Fixed term', 'Regular saver', 'Instant access', 'Notice'],
  },
  mortgage_by_sort: null,
}

/** A card on the monthly saving: the regular savers first, then the accounts that also take it. */
const MONTHLY_GROUPING = {
  labelOf: accessGroup,
  order: ['Regular saver', 'Instant access', 'Notice'],
} as const

/**
 * The card's rows in groups: each group together, in the arrangement's order, the card's order
 * kept within it; a group with no rows is left out. The figure basis follows the rows' order.
 */
function withGroups(result: ProductsResult, focus: ProductsFocus = 'lump'): ProductsResult {
  if (result.kind !== 'card') return result
  const grouping = focus === 'monthly' ? MONTHLY_GROUPING : GROUPING[result.card.arrangement.kind]
  if (grouping === null) return result
  const rank = (row: Row): number => {
    const index = grouping.order.indexOf(grouping.labelOf(row))
    return index === -1 ? grouping.order.length : index
  }
  const rows = result.card.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row)
  const groups: Group[] = []
  for (const row of rows) {
    const label = grouping.labelOf(row)
    const group = groups.find((item) => item.label === label)
    if (group === undefined) groups.push({ label, rowIds: [row.id] })
    else group.rowIds.push(row.id)
  }
  const place = new Map(rows.map((row, index) => [row.id, index]))
  return {
    ...result,
    card: { ...result.card, arrangement: { ...result.card.arrangement, groups }, rows },
    figureBasis: [...result.figureBasis].sort(
      (a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0),
    ),
  }
}

/** "“Instant access” (4 rows) and “Fixed term” (4 rows)": the groups, for the model. */
export function groupsInWords(card: MarketProductsCard): string | null {
  const groups = card.arrangement.groups ?? []
  if (groups.length === 0) return null
  const parts = groups.map(
    (group) =>
      `“${group.label}” (${String(group.rowIds.length)} row${group.rowIds.length === 1 ? '' : 's'})`,
  )
  return parts.length === 1
    ? (parts[0] ?? null)
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
}

/** Whether the case has anything a products card could run on. */
export function hasFigures(figures: CaseFigures): boolean {
  return figures.held.length > 0 || figures.monthlySavingEur !== null || figures.priceEur !== null
}

/**
 * The products card for a question, or the questions that would let it run. `arrangement` is
 * the model's reading of the question; everything on the card is worked out here.
 */
export function productsCard(
  market: Market,
  figures: CaseFigures,
  request: ShowProductsRequest,
  asOf: AsOf,
): ProductsResult {
  if (!hasFigures(figures)) {
    return {
      kind: 'questions',
      questions: [
        'How much is saved now, and where is it?',
        'How much goes aside each month?',
        'When would you like to have the keys?',
      ],
    }
  }
  if (request.arrangement === 'mortgage_by_sort' || request.category === 'mortgages') {
    return mortgageBySort(market, figures, request, asOf)
  }
  switch (request.arrangement) {
    case 'held_vs_market':
      return withGroups(heldVsMarket(market, figures, request, asOf))
    case 'by_access':
    case 'fits_date':
      if (request.focus === 'monthly') {
        return withGroups(
          monthlyCard(market, figures, { ...request, arrangement: request.arrangement }, asOf),
          'monthly',
        )
      }
      return withGroups(
        request.arrangement === 'by_access'
          ? byAccess(market, figures, request, asOf)
          : fitsDate(market, figures, request, asOf),
      )
  }
}

/** Every string a products card says, for `adviceWordsIn`. */
export function productsCardText(card: MarketProductsCard): string {
  return [
    card.question,
    card.arrangement.title,
    card.arrangement.line,
    ...(card.arrangement.groups ?? []).map((group) => group.label),
    ...card.rows.flatMap((row) => [
      row.lead,
      row.kind,
      row.value,
      row.figure,
      row.note ?? '',
      ...(row.mustKnow ?? []),
      ...(row.detail ?? []),
    ]),
    ...card.basis.figures,
    card.basis.objective,
    ...card.basis.assumptions,
    card.basis.coverage,
    ...card.basis.warnings,
    card.statement,
  ].join('\n')
}
