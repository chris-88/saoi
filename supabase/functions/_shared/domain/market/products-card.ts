import {
  PRODUCTS_CARD_MAX_ROWS,
  type MarketProductsCard,
  type ProductsArrangement,
} from '../../contracts/cards.ts'
import type { Holding } from '../../contracts/holdings.ts'
import type { MarketPlan } from '../../contracts/market-plan.ts'
import type {
  DepositTerms,
  HomeSort,
  ProductView,
  SavingsFigures,
  SearchResult,
} from '../../contracts/market-tools.ts'
import { MORTGAGE_WARNINGS, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { LINKED_SAVERS } from '../../market/mortgage-incentives.ts'
import { CURRENT_ACCOUNT_LABEL, withHeldRates } from './held-rates.ts'
import { accountOf } from './allocate.ts'
import { displayName, euro, oldestCheck } from './figures.ts'
import { monthName, shortMonth } from './home-arithmetic.ts'
import { homePathways, HORIZON_YEARS, SORT_WORDS } from './pathways.ts'
import { pct } from './product.ts'
import { SAVINGS_ASSUMPTIONS, search, UNCONFIRMED_RATE } from './search.ts'
import {
  addMonths,
  DIRT_RATE,
  monthsUntil,
  NO_DATE_HORIZON,
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

export type ProductsResult =
  | { readonly kind: 'card'; readonly card: MarketProductsCard }
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

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** "bonus until 1 Jan": the next reset of a threshold bonus (bunq) after `asOf`. */
function bonusUntil(terms: DepositTerms, asOf: AsOf): string | null {
  const bonus = terms.thresholdBonus
  if (bonus === null || bonus.resetMonths.length === 0) return null
  for (let ahead = 1; ahead <= 12; ahead += 1) {
    const month = Number(addMonths(asOf, ahead).slice(5, 7))
    if (bonus.resetMonths.includes(month)) {
      return `bonus rate until 1 ${MONTH_SHORT[month - 1] ?? ''}`
    }
  }
  return null
}

/** The one flag a row carries, most important first. */
function savingsNote(product: ProductView, figures: SavingsFigures, asOf: AsOf): string | null {
  const terms = product.terms
  if (terms.kind !== 'deposit') return null
  if (!product.rateConfirmed) return 'rate from CCPC only'
  const bonus = bonusUntil(terms, asOf)
  if (bonus !== null) return bonus
  if (figures.stop !== null) {
    return `interest to ${shortMonth(addMonths(asOf, figures.stop.afterMonths))} only: the rate after is not stated`
  }
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

type Row = MarketProductsCard['rows'][number]

type MarketRow = {
  readonly row: Row
  readonly rate: number
  readonly money: number
}

function marketRow(result: SearchResult, horizon: Horizon, asOf: AsOf): MarketRow | null {
  const { product, figures } = result
  if (product.terms.kind !== 'deposit' || figures.kind !== 'savings') return null
  const rate = headlineRate(product.terms, figures.termMonths)
  if (rate === null) return null
  return {
    rate,
    money: figures.netInterest,
    row: {
      id: product.id,
      lead: displayName(product),
      kind: accessKind(product.terms, figures.termMonths),
      value: pct(rate),
      figure: `${whole(figures.netInterest)} ${byWhen(horizon, figures.knownMonths, asOf)}`,
      note: savingsNote(product, figures, asOf),
      held: false,
      confirmed: product.rateConfirmed,
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
      const row = marketRow(result, options.horizon, options.asOf)
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
  const baseline: Row[] = held.map(({ account, rate }, index) => ({
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
        line: 'Arranged by rate, your own account first. Ask for them by access, or by the date, instead.',
      },
      rows: [...baseline.slice(0, PRODUCTS_CARD_MAX_ROWS), ...shown.map((item) => item.row)],
      more: Math.max(0, found.matched - shown.length),
      basis: {
        figures: savingsFiguresUsed(figures, amount, horizon),
        objective:
          'By AER, highest first, with your own account on top as the baseline. The money column is interest after DIRT on the sum held, ' +
          (horizon.dated
            ? `to ${monthName(horizon.by)}.`
            : `over ${String(NO_DATE_HORIZON)} months.`) +
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
  }
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
  const common = { category: request.category, amount, monthly: 0, horizon, asOf }
  const instant = searchSavings(market, { ...common, access: 'instant' })
  const fixed = searchSavings(market, { ...common, access: 'fixed_term' })
  const half = PRODUCTS_CARD_MAX_ROWS / 2
  const instantRows = [...instant.rows].sort(byRate)
  const fixedRows = [...fixed.rows].sort(byRate)
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
  const matched = instant.matched + fixed.matched
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.by_access(figures.keysMonth),
      arrangement: {
        kind: 'by_access',
        title: 'Instant access against fixed term',
        line:
          `Instant access beside fixed terms that end by ${horizon.dated ? monthName(horizon.by) : `${String(horizon.months)} months`}, each by rate.` +
          priceLine +
          ' Ask for them against your own account, or by the date, instead.',
      },
      rows: [...instantShown, ...fixedShown].map((item) => item.row),
      more: Math.max(0, matched - instantShown.length - fixedShown.length),
      basis: {
        figures: savingsFiguresUsed(figures, amount, horizon),
        objective:
          'Instant access first, then fixed term; each by AER, highest first. The money column is interest after DIRT on the sum held, to the end of the term or the date, whichever comes first.',
        assumptions: [...new Set([...instant.assumptions, ...fixed.assumptions])],
        coverage: coverageLine(
          matched,
          products,
          [...instant.excluded, ...fixed.excluded],
          'instant-access and fixed-term accounts',
        ),
        warnings: warningsOf(
          [...instantShown, ...fixedShown].map((item) => item.row),
          products,
        ),
      },
      statement: RESULT_STATEMENT,
    },
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

/** The six-month rule: more than six months to the keys shows the six-month terms. */
export const FITS_DATE_TERM_MONTHS = 6

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
  // The term that fits: six months when the keys are further away than that, else the longest
  // term that ends by them.
  const termFor = (terms: DepositTerms): number | null => {
    if (horizon.months > FITS_DATE_TERM_MONTHS) {
      return terms.ladder.some((rung) => rung.months === FITS_DATE_TERM_MONTHS)
        ? FITS_DATE_TERM_MONTHS
        : null
    }
    const fits = terms.ladder.filter((rung) => rung.months <= horizon.months)
    return fits.length === 0 ? null : Math.max(...fits.map((rung) => rung.months))
  }
  const categories =
    request.category === 'savings'
      ? new Set(['savings'])
      : request.category === 'deposits'
        ? new Set(['deposit'])
        : new Set(['savings', 'deposit'])
  const excluded = new Map<string, number>()
  const exclude = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1)
  type Fit = MarketRow & { readonly fixed: boolean; readonly product: ProductView }
  const seen = new Set<string>()
  const fits: Fit[] = market.products.flatMap((product): Fit[] => {
    const terms = product.terms
    if (terms.kind !== 'deposit' || !categories.has(product.category)) return []
    if (/child|kid|junior|teen|student|third level/i.test(product.name)) return []
    let termMonths: number | null = null
    if (terms.access === 'fixed_term') {
      termMonths = termFor(terms)
      if (termMonths === null) {
        exclude(
          horizon.months > FITS_DATE_TERM_MONTHS
            ? 'No six-month term'
            : `No term that ends by ${monthName(horizon.by)}`,
        )
        return []
      }
    } else if (terms.access === 'notice' && (terms.noticeDays ?? 0) > horizon.months * 30) {
      exclude(`Notice longer than the time to ${monthName(horizon.by)}`)
      return []
    }
    const simulation = simulateDeposit(terms, {
      lumpSum: saved,
      monthly,
      horizonMonths: horizon.months,
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
    const timing = statedBonus > 0 ? bonusTiming(product, terms, horizon.months) : null
    const bonus = timing === 'by_keys' ? statedBonus : 0
    const total = round2(result.netInterest + bonus)
    const note =
      timing === 'by_keys'
        ? `includes a ${whole(bonus)} bonus${terms.dirtApplies ? ' after DIRT' : ''}, on its conditions`
        : timing === 'after_drawdown'
          ? 'bonus paid after drawdown, not counted'
          : timing === 'not_stated'
            ? `${whole(statedBonus)} bonus, not counted: when it is paid is not stated`
            : result.notPlaced.monthly > 0 && result.notPlaced.monthly >= monthly && monthly > 0
              ? 'the sum held only, not the monthly saving'
              : savingsNote(product, result, asOf)
    return [
      {
        product,
        fixed: terms.access === 'fixed_term',
        rate,
        money: total,
        row: {
          id: product.id,
          lead: displayName(product),
          kind: accessKind(terms, termMonths),
          value: pct(rate),
          figure: `${whole(total)} ${byWhen(horizon, result.knownMonths, asOf)}`,
          note: note ?? (product.rateConfirmed ? null : 'rate from CCPC only'),
          held: false,
          confirmed: product.rateConfirmed,
        },
      },
    ]
  })
  const fixed = fits.filter((fit) => fit.fixed).sort(byRate)
  const open = fits.filter((fit) => !fit.fixed).sort((a, b) => b.money - a.money || b.rate - a.rate)
  const half = PRODUCTS_CARD_MAX_ROWS / 2
  const fixedShown = fixed.slice(
    0,
    Math.max(half, PRODUCTS_CARD_MAX_ROWS - Math.min(half, open.length)),
  )
  const openShown = open.slice(0, PRODUCTS_CARD_MAX_ROWS - fixedShown.length)
  const shown = [...fixedShown, ...openShown]
  const products = fits.map((fit) => fit.product)
  const termWords =
    horizon.months > FITS_DATE_TERM_MONTHS
      ? 'six-month fixed terms first'
      : 'fixed terms that end by then first'
  return {
    kind: 'card',
    card: {
      type: 'market_products',
      question: QUESTIONS.fits_date(horizon.by),
      arrangement: {
        kind: 'fits_date',
        title: `Accounts that fit ${monthName(horizon.by)}`,
        line: `Arranged by the term that fits ${monthName(horizon.by)}: ${termWords}, then accounts you can take the money from, each by what it adds by then. Ask for them by access, or against your own account, instead.`,
      },
      rows: shown.map((fit) => fit.row),
      more: Math.max(0, fits.length - shown.length),
      basis: {
        figures: [
          ...savingsFiguresUsed(figures, saved, horizon).filter(
            (line) => !line.endsWith('compared as a lump sum'),
          ),
          `${whole(saved)} held and ${whole(monthly)} a month, placed where each account takes them`,
        ],
        objective:
          `By the term that fits ${monthName(horizon.by)}, then by interest after DIRT plus any bonus by then. ` +
          (horizon.months > FITS_DATE_TERM_MONTHS
            ? `The keys are ${String(horizon.months)} months away, so fixed terms are shown at six months; a six-month term's interest stops at its end, as the rate after it is not stated.`
            : 'A fixed term is shown at the longest term that ends by then.'),
        assumptions: [
          ...SAVINGS_ASSUMPTIONS.filter((line) => !line.startsWith('Bonuses')),
          'A bonus is counted in the total by the date only when it is paid by then; one paid after the mortgage is drawn down, or whose payment date is not stated, is noted and not counted.',
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
        line: `Arranged by ${SORT_WORDS[sortBy]}${request.sortBy === undefined && figures.sortBy !== null ? ', the order you chose' : ''}. Ask for them by ${otherSorts.join(', or by ')}, instead${home.filters.length > 0 ? '; filters are in the basis' : ''}.`,
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
    ...card.rows.flatMap((row) => [row.lead, row.kind, row.value, row.figure, row.note ?? '']),
    ...card.basis.figures,
    card.basis.objective,
    ...card.basis.assumptions,
    card.basis.coverage,
    ...card.basis.warnings,
    card.statement,
  ].join('\n')
}
