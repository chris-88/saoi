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

export type ShowProductsRequest = {
  readonly arrangement: ProductsArrangement
  readonly category?: ProductsCategory | undefined
  readonly sortBy?: HomeSort | undefined
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

type SavingsSearch = {
  readonly rows: MarketRow[]
  readonly matched: number
  readonly assumptions: string[]
  readonly excluded: { reason: string; count: number }[]
  readonly products: ProductView[]
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
  let partial = 0
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
      // An account that takes under half of the money compared is not set against the rest.
      if (
        result.figures.kind === 'savings' &&
        options.amount > 0 &&
        result.figures.notPlaced.lumpSum > options.amount / 2
      ) {
        partial += 1
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
  if (partial > 0) excluded.set('Takes under half of the sum held', partial)
  return {
    rows,
    matched: Math.max(
      rows.length,
      responses.reduce((sum, response) => sum + response.matched, 0) - duplicates - partial,
    ),
    assumptions: [...new Set(responses.flatMap((response) => response.assumptions))].filter(
      (line) => !line.startsWith('No horizon given') && !line.startsWith('No amount given'),
    ),
    excluded: [...excluded].map(([reason, count]) => ({ reason, count })),
    products,
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

function coverageLine(
  matched: number,
  products: readonly ProductView[],
  excluded: readonly { reason: string; count: number }[],
  what: string,
): string {
  const checked = oldestCheck(products)
  const left = excluded.reduce((sum, item) => sum + item.count, 0)
  const top = [...excluded].sort((a, b) => b.count - a.count)[0]
  return (
    `${String(matched)} ${what} on the Irish market take this money, from CCPC's comparison tables and the providers' own pages` +
    (checked === null ? '' : `, the oldest figure checked ${checked.slice(0, 10)}`) +
    (left === 0 || top === undefined
      ? '.'
      : `; ${String(left)} left out (the most for: ${top.reason.toLowerCase()}).`)
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
  const found = searchSavings(market, {
    category: request.category,
    amount,
    monthly: 0,
    horizon,
    asOf,
  })
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
  const shown = ranked.slice(0, room)
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
      more: Math.max(0, found.matched - shown.length),
      basis: {
        figures: savingsFiguresUsed(figures, amount, horizon),
        objective:
          'By AER, highest first, with your own account on top as the baseline. ' +
          moneyColumnLine(horizon) +
          (top === undefined || ownRate === null
            ? ''
            : ` The highest shown is ${pct(top.rate)} against ${pct(ownRate)} on your own account.`),
        assumptions: [...resolved.basis, ...found.assumptions],
        coverage: coverageLine(
          found.matched,
          found.products,
          found.excluded,
          'savings and deposit accounts',
        ),
        warnings: warningsOf(
          shown.map((item) => item.row),
          found.products,
        ),
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: [
      ...heldBasis.slice(0, PRODUCTS_CARD_MAX_ROWS),
      ...shown.map((item) => ({
        id: item.row.id,
        lead: item.row.lead,
        value: item.row.value,
        line: item.figureBasis,
      })),
    ],
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

/** A fixed term judged against the keys: the term that fits, and the longer ones that do not. */
type Clamped = {
  readonly item: MarketRow
  readonly product: ProductView
  readonly fit: JudgedTerm | null
  readonly pushedOut: readonly JudgedTerm[]
}

/**
 * A fixed-term row of `by_access` judged again by the term-fit rule (`term-fit.ts`): the term
 * the search used is replaced by the longest that ends at least the buffer before the keys month
 * its own interest gives, worked out on the same sum; null when no term does.
 */
function clampFixedRow(
  item: MarketRow,
  product: ProductView,
  run: KeysRun,
  horizon: Horizon,
  asOf: AsOf,
  amount: number,
  factsMonthly: number,
): Clamped | null {
  if (product.terms.kind !== 'deposit') return null
  const judged = termThatFits(product.terms, run)
  if (judged.fit === null) return null
  const months = judged.fit.months
  const { figures } = simulateDeposit(product.terms, {
    lumpSum: amount,
    monthly: 0,
    horizonMonths: Math.max(horizon.months, months),
    termMonths: months,
    asOf,
  })
  const row = marketRow(product, figures, horizon, asOf, amount, 0, factsMonthly) ?? item
  const figureBasis = [row.figureBasis, fitLine(judged.fit), ...judged.pushedOut.map(pushedOutLine)]
    .filter((line) => line.length > 0)
    .join(' ')
  return {
    item: {
      ...row,
      figureBasis,
      // The detail's money sentence carries the term against the keys, as the model's does.
      row: {
        ...row.row,
        detail: (row.row.detail ?? []).map((line) =>
          line === row.figureBasis ? figureBasis : line,
        ),
      },
    },
    product,
    fit: judged.fit,
    pushedOut: judged.pushedOut,
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
  const common = {
    category: request.category,
    amount,
    monthly: 0,
    horizon,
    asOf,
    factsMonthly: figures.monthlySavingEur ?? 0,
  }
  const instant = searchSavings(market, { ...common, access: 'instant' })
  const fixed = searchSavings(market, { ...common, access: 'fixed_term' })
  // With a keys month, each fixed term is judged again against the keys its own interest brings.
  const run = keysRunOf(figures, amount, horizon, asOf)
  const clamped: Clamped[] = []
  let noTerm = 0
  for (const item of fixed.rows) {
    const product = fixed.products.find((candidate) => candidate.id === item.row.id)
    if (product === undefined) continue
    if (!horizon.dated) {
      clamped.push({ item, product, fit: null, pushedOut: [] })
      continue
    }
    const judged = clampFixedRow(item, product, run, horizon, asOf, amount, run.monthlyEur)
    if (judged === null) noTerm += 1
    else clamped.push(judged)
  }
  const half = PRODUCTS_CARD_MAX_ROWS / 2
  const instantRows = [...instant.rows].sort(byRate)
  const fixedRows = clamped.map((entry) => entry.item).sort(byRate)
  const instantShown = instantRows.slice(
    0,
    Math.max(half, PRODUCTS_CARD_MAX_ROWS - Math.min(half, fixedRows.length)),
  )
  const fixedShown = fixedRows.slice(0, PRODUCTS_CARD_MAX_ROWS - instantShown.length)
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
  const products = [...instant.products, ...fixed.products]
  const matched = instant.matched + fixed.matched - noTerm
  const fixedExcluded =
    noTerm === 0
      ? fixed.excluded
      : [...fixed.excluded, { reason: 'No term that ends a month before the keys', count: noTerm }]
  const shown = [...instantShown, ...fixedShown]
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.by_access(figures.keysMonth),
      arrangement: {
        kind: 'by_access',
        title: 'Instant access against fixed term',
        line: `Instant access beside fixed terms that end in time for ${horizon.dated ? `the keys` : `${String(horizon.months)} months`}, each by rate; ask for them against your own account, or by the date, instead.`,
      },
      rows: shown.map((item) => item.row),
      more: Math.max(0, matched - shown.length),
      basis: {
        figures: savingsFiguresUsed(figures, amount, horizon),
        objective:
          `Instant access first, then fixed term; each by AER, highest first.${priceLine} ${moneyColumnLine(horizon)}` +
          (horizon.dated ? ` ${TERM_FIT_RULE}` : ''),
        assumptions: [
          ...new Set([...instant.assumptions, ...fixed.assumptions]),
          ...notFittingLines(clamped),
        ],
        coverage: coverageLine(
          matched,
          products,
          [...instant.excluded, ...fixedExcluded],
          'instant-access and fixed-term accounts',
        ),
        warnings: warningsOf(
          shown.map((item) => item.row),
          products,
        ),
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: shown.map((item) => ({
      id: item.row.id,
      lead: item.row.lead,
      value: item.row.value,
      line: item.figureBasis,
    })),
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
  const categories =
    request.category === 'savings'
      ? new Set(['savings'])
      : request.category === 'deposits'
        ? new Set(['deposit'])
        : new Set(['savings', 'deposit'])
  const excluded = new Map<string, number>()
  const exclude = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1)
  type Fit = MarketRow & {
    readonly fixed: boolean
    readonly product: ProductView
    /** YYYY-MM the keys come in with this account's own interest. */
    readonly keysOn: string
    readonly pushedOut: readonly JudgedTerm[]
  }
  const notFitting: { product: ProductView; pushedOut: readonly JudgedTerm[] }[] = []
  const seen = new Set<string>()
  const fits: Fit[] = market.products.flatMap((product): Fit[] => {
    const terms = product.terms
    if (terms.kind !== 'deposit' || !categories.has(product.category)) return []
    if (/child|kid|junior|teen|student|third level/i.test(product.name)) return []
    let termMonths: number | null = null
    let keysOn: string
    let fitWords = ''
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
      exclude('Takes under half of the sum held')
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
          }),
        },
      },
    ]
  })
  // Soonest keys first, then what it adds by them.
  const byKeys = (a: Fit, b: Fit): number =>
    a.keysOn.localeCompare(b.keysOn) || b.money - a.money || b.rate - a.rate
  const fixed = fits.filter((fit) => fit.fixed).sort(byKeys)
  const open = fits.filter((fit) => !fit.fixed).sort(byKeys)
  const half = PRODUCTS_CARD_MAX_ROWS / 2
  const fixedShown = fixed.slice(
    0,
    Math.max(half, PRODUCTS_CARD_MAX_ROWS - Math.min(half, open.length)),
  )
  const openShown = open.slice(0, PRODUCTS_CARD_MAX_ROWS - fixedShown.length)
  const shown = [...fixedShown, ...openShown]
  const products = fits.map((fit) => fit.product)
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.fits_date(horizon.by),
      arrangement: {
        kind: 'fits_date',
        title: `Accounts that fit ${monthName(horizon.by)}`,
        line: 'Fixed terms that end a month before the keys, then instant access and notice, each by its keys month; ask for them by access, or against your own account, instead.',
      },
      rows: shown.map((fit) => fit.row),
      more: Math.max(0, fits.length - shown.length),
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
        ),
        warnings: warningsOf(
          shown.map((fit) => fit.row),
          products,
        ),
      },
      statement: RESULT_STATEMENT,
    },
    figureBasis: shown.map((fit) => ({
      id: fit.row.id,
      lead: fit.row.lead,
      value: fit.row.value,
      line: fit.figureBasis,
    })),
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
      return heldVsMarket(market, figures, request, asOf)
    case 'by_access':
      return byAccess(market, figures, request, asOf)
    case 'fits_date':
      return fitsDate(market, figures, request, asOf)
  }
}

/** Every string a products card says, for `adviceWordsIn`. */
export function productsCardText(card: MarketProductsCard): string {
  return [
    card.question,
    card.arrangement.title,
    card.arrangement.line,
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
