import {
  COMPARISON_MAX_COLUMNS,
  COMPARISON_MIN_COLUMNS,
  PRODUCTS_ROW_MAX_DETAIL,
  PRODUCTS_ROW_MAX_MUST_KNOW,
  type MarketProductsCard,
  type ProductComparisonCard,
  type ProductsArrangement,
} from '../../contracts/cards.ts'
import type { DepositTerms, ProductView } from '../../contracts/market-tools.ts'
import { adviceWordsIn, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { brandOf } from '../../market/provider-brand.ts'
import { providerIdOf } from '../../market/provider-names.ts'
import { displayName, euro, oldestCheck } from './figures.ts'
import { withHeldRates } from './held-rates.ts'
import { monthName, shortMonth } from './home-arithmetic.ts'
import { sourceOf, statedConditions } from './lookup.ts'
import { pct } from './product.ts'
import {
  bonusTiming,
  type CaseFigures,
  type HeldAccount,
  isRegularSaver,
  moneyColumnLine,
  productsCard,
  type ProductsCategory,
  REGULAR_SAVER_KIND,
} from './products-card.ts'
import { bandsInWords, ratePeriod, type RatePeriod } from './rate-period.ts'
import { SAVINGS_ASSUMPTIONS, UNCONFIRMED_RATE } from './search.ts'
import {
  addMonths,
  bestRung,
  DIRT_RATE,
  monthsUntil,
  NO_DATE_HORIZON,
  placement,
  round2,
  simulateDeposit,
} from './simulate.ts'
import { keysMonthWith, type KeysRun, TERM_FIT_RULE, termThatFits } from './term-fit.ts'
import type { AsOf, Market } from './types.ts'

/**
 * Two or three products the customer selected on the cards, set against each other (Chris,
 * 2026-11-13: "select products from any of the cards that are presented, then compare the two
 * that have been selected against each other and help the customer come to a choice").
 *
 * Each column is rebuilt from the case by the row id the card carried: a market product id (a
 * ladder's view id, or one of its rungs' row ids for that term), or `held:<n>` for their own
 * account. Every figure runs on the products card's money rules: what is held and saved each
 * month placed where each account takes them, interest after DIRT to the keys month (or twelve
 * months with no date), a rate counted for as long as the product states it and the rate after
 * where stated, a bonus only when it is paid by then, and a fixed term at the longest rung that
 * ends a month before the keys month its own interest gives (`term-fit.ts`). The facts to know
 * and the detail are the products card's own for that row (`productsCard`), with the money
 * sentence restated on the comparison's figures.
 *
 * Nothing is picked or ranked: the columns stay in the order selected, `differences` are facts
 * in their figures, and `decides` is the one question whose answer separates them for this
 * customer. Every string is held to `adviceWordsIn`. Pure.
 */

export type ComparisonResult =
  | {
      readonly kind: 'card'
      readonly card: ProductComparisonCard
      /** For the model, not the card: each column's money in a sentence it can quote. */
      readonly figureBasis: readonly { readonly rowId: string; readonly line: string }[]
    }
  /** Nothing to compare on: the reason, for the model to say in a line. */
  | { readonly kind: 'refused'; readonly reason: string }

/** The fixed labels of a comparison's rows, in order; the money row names the month. */
export const COMPARISON_LABELS = {
  rate: 'Rate',
  period: 'Rate period',
  money: (month: string) => `Money by ${monthName(month)}`,
  access: 'Access',
  monthly: 'Takes monthly payments',
  lump: 'Lump sum',
  caps: 'Caps',
  guarantee: 'Deposit guarantee',
  source: 'Source, checked',
} as const

type Horizon = { readonly months: number; readonly by: string; readonly dated: boolean }

/** What one selected row is, rebuilt from the case. */
type Column = {
  readonly rowId: string
  readonly lead: string
  readonly providerId: string | null
  readonly brand: ProductComparisonCard['columns'][number]['brand']
  readonly kind: string
  readonly product: ProductView | null
  readonly values: Readonly<Record<Exclude<keyof typeof COMPARISON_LABELS, never>, string>>
  /** Interest after DIRT by the horizon (plus a bonus paid by then); null: no rate to work on. */
  readonly money: number | null
  /** Interest after DIRT by the horizon on the sum held alone; null for their own account. */
  readonly lumpMoney: number | null
  readonly moneyLine: string
  readonly access: 'instant' | 'notice' | 'fixed_term' | 'held'
  readonly noticeDays: number | null
  /** YYYY-MM a fixed term ends. */
  readonly termEnd: string | null
  readonly termMonths: number | null
  /** What it takes of the case's saving, in words ("both the €25,000 held and €1,100 a month"). */
  readonly takes: string | null
  /** A rate stated to end before the horizon. */
  readonly period: RatePeriod | null
  readonly periodPhrase: string
  readonly guaranteeCountry: string | null
  /** YYYY-MM the keys come in with this account's own interest; null when not worked out. */
  readonly keysOn: string | null
  readonly mustKnow: string[]
  readonly detail: string[]
}

const whole = (value: number): string => euro(Math.round(value))

/** "6-month fixed", "1-year fixed", "31-day notice", "instant access": as the products card says it. */
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

function horizonOf(figures: CaseFigures, asOf: AsOf): Horizon {
  const keys = figures.keysMonth
  if (keys !== null && keys > asOf.slice(0, 7)) {
    return { months: monthsUntil(asOf, keys), by: keys, dated: true }
  }
  return { months: NO_DATE_HORIZON, by: addMonths(asOf, NO_DATE_HORIZON), dated: false }
}

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

/** "9 Nov 2026". */
const dayOf = (iso: string): string =>
  `${String(Number(iso.slice(8, 10)))} ${shortMonth(iso.slice(0, 7))}`

/** "9 November 2026". */
const longDayOf = (iso: string): string =>
  `${String(Number(iso.slice(8, 10)))} ${monthName(iso.slice(0, 7))}`

const sentence = (text: string): string => {
  const trimmed = text.trim()
  const upper = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(upper) ? upper : `${upper}.`
}

/** A sentence that tells someone to do something is not a fact. */
const SAYS_TO = /\b(check|ask|confirm|contact)\b/i

/** Facts free of advice and instruction, without repeats, within their limit. */
function keep(lines: readonly (string | null)[], max: number): string[] {
  const kept: string[] = []
  for (const line of lines) {
    if (line === null || line.length === 0) continue
    if (adviceWordsIn(line).length > 0 || SAYS_TO.test(line)) continue
    if (!kept.includes(line)) kept.push(line)
  }
  return kept.slice(0, max)
}

const listWords = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`

// ---------------------------------------------------------------------------------------------
// The products card's own rows, for their facts and detail
// ---------------------------------------------------------------------------------------------

type CardRow = {
  readonly row: MarketProductsCard['rows'][number]
  /** The row's own money sentence, which the comparison restates on its own figures. */
  readonly figureBasis: string | null
}

/**
 * The products card rows for these ids, read from the cards the customer could have selected
 * them on: the same arrangements `show_products` builds, until each id is found. A row not on
 * any card (the case has moved on) is simply not found.
 */
function cardRowsFor(
  market: Market,
  figures: CaseFigures,
  ids: readonly string[],
  dated: boolean,
  asOf: AsOf,
): Map<string, CardRow> {
  const found = new Map<string, CardRow>()
  const arrangements: ProductsArrangement[] = dated
    ? ['fits_date', 'by_access', 'held_vs_market']
    : ['by_access', 'held_vs_market']
  const categories: (ProductsCategory | undefined)[] = [undefined, 'savings', 'deposits']
  for (const arrangement of arrangements) {
    for (const category of categories) {
      if (ids.every((id) => found.has(id))) return found
      const result = productsCard(market, figures, { arrangement, category }, asOf)
      if (result.kind !== 'card') continue
      for (const row of result.card.rows) {
        if (!ids.includes(row.id) || found.has(row.id)) continue
        const basis = result.figureBasis.find((item) => item.id === row.id)
        found.set(row.id, { row, figureBasis: basis?.line ?? null })
      }
    }
  }
  return found
}

// ---------------------------------------------------------------------------------------------
// A market product's column
// ---------------------------------------------------------------------------------------------

/** The view a row id names, and the rung when it is one of a ladder's own rows. */
export function resolve(
  market: Market,
  rowId: string,
): { readonly product: ProductView; readonly rungMonths: number | null } | null {
  const direct = market.products.find((product) => product.id === rowId)
  if (direct !== undefined) return { product: direct, rungMonths: null }
  const viewId = market.viewOfRow.get(rowId)
  const product = market.products.find((candidate) => candidate.id === viewId)
  if (product === undefined) return null
  const rung =
    product.terms.kind === 'deposit'
      ? product.terms.ladder.find((item) => `${product.provider}:${item.productId}` === rowId)
      : undefined
  return { product, rungMonths: rung?.months ?? null }
}

/** "the €25,000 held and €1,100 a month", or what part of them it takes. */
function takesWords(lump: number, monthly: number, lumpIn: number, monthlyIn: number): string {
  const parts: string[] = []
  if (lumpIn > 0) {
    parts.push(
      lumpIn < lump ? `${whole(lumpIn)} of the ${whole(lump)} held` : `the ${whole(lump)} held`,
    )
  }
  if (monthlyIn > 0) {
    parts.push(
      monthlyIn < monthly
        ? `${whole(monthlyIn)} of the ${whole(monthly)} a month`
        : `${whole(monthly)} a month`,
    )
  }
  const not: string[] = []
  if (lump > 0 && lumpIn === 0) not.push(`not the ${whole(lump)} held`)
  if (monthly > 0 && monthlyIn === 0) not.push('not the monthly saving')
  if (parts.length === 0) return 'none of the money as given'
  return [parts.length === 2 ? `both ${parts.join(' and ')}` : listWords(parts), ...not].join(', ')
}

function marketColumn(input: {
  readonly rowId: string
  readonly product: ProductView
  readonly terms: DepositTerms
  readonly rungMonths: number | null
  readonly figures: CaseFigures
  readonly horizon: Horizon
  readonly asOf: AsOf
  readonly cardRow: CardRow | undefined
}): Column {
  const { rowId, product, terms, figures, horizon, asOf } = input
  const saved = figures.held.reduce((sum, account) => sum + account.balance, 0)
  const monthly = figures.monthlySavingEur ?? 0
  const run: KeysRun = {
    savedEur: saved,
    monthlyEur: monthly,
    neededEur: figures.neededAtKeysEur,
    keysMonth: horizon.by,
    asOf,
  }

  // The term: the rung named, else the clamp against the keys, else the longest by the horizon.
  let termMonths: number | null = null
  if (terms.access === 'fixed_term') {
    termMonths =
      input.rungMonths ??
      (horizon.dated ? termThatFits(terms, run).fit?.months : undefined) ??
      bestRung(terms.ladder, horizon.months)?.months ??
      terms.ladder[0]?.months ??
      null
  }
  const termEnd = termMonths === null ? null : addMonths(asOf, termMonths)

  const { figures: result } = simulateDeposit(terms, {
    lumpSum: saved,
    monthly,
    horizonMonths: horizon.months,
    termMonths: termMonths ?? undefined,
    asOf,
  })
  const placed = placement(terms, saved, monthly)
  const lumpIn = result.knownMonths === 0 ? 0 : placed.lump
  const monthlyIn = result.knownMonths === 0 ? 0 : placed.monthly

  // A bonus is not interest: counted only when it is paid by the date, after DIRT where it applies.
  const statedBonus = round2(
    (terms.bonus?.amountEur ?? 0) * (terms.dirtApplies ? 1 - DIRT_RATE : 1),
  )
  const timing = statedBonus > 0 ? bonusTiming(product, terms, horizon.months) : null
  const bonus = timing === 'by_keys' ? statedBonus : 0
  const money = round2(result.netInterest + bonus)
  // The sum held alone, for what locking it away adds against keeping it at hand.
  const lumpOnly =
    saved > 0
      ? simulateDeposit(terms, {
          lumpSum: saved,
          monthly: 0,
          horizonMonths: horizon.months,
          termMonths: termMonths ?? undefined,
          asOf,
        }).figures
      : null

  const rate = headlineRate(terms, termMonths)
  const period = ratePeriod(
    terms,
    asOf,
    result.horizonMonths,
    lumpIn + monthlyIn * Math.max(0, result.horizonMonths - 1),
  )
  const keysOn =
    figures.neededAtKeysEur === null || !horizon.dated
      ? null
      : keysMonthWith(terms, run, termMonths)

  // ---- The values -----------------------------------------------------------------------
  const rateValue =
    rate === null
      ? 'Not stated'
      : period === null
        ? pct(rate)
        : `${pct(rate)} to ${period.endsShort}`

  const stopsAt = result.stop === null ? null : addMonths(asOf, result.stop.afterMonths)
  let periodValue: string
  let periodPhrase: string
  if (terms.access === 'fixed_term') {
    periodValue =
      termMonths === null || termEnd === null
        ? 'Fixed term'
        : `Fixed for ${String(termMonths)} months, to ${shortMonth(termEnd)}`
    periodPhrase =
      termMonths === null
        ? 'the rate is fixed for the term'
        : `the rate is fixed for ${String(termMonths)} months`
  } else if (period !== null) {
    periodValue =
      period.after === null
        ? `To ${period.endsLong}; the rate after is not stated`
        : `To ${period.endsLong}, then ${period.after}`
    periodPhrase =
      period.after === null
        ? `the rate ends ${period.endsLong} and the rate after is not stated`
        : `the rate ends ${period.endsLong}, then ${period.after}`
  } else if (terms.introductory !== null) {
    periodValue = `${String(terms.introductory.months)} months, then ${terms.introductory.thenAerPct === null ? 'not stated' : pct(terms.introductory.thenAerPct)}`
    periodPhrase = `the rate holds ${String(terms.introductory.months)} months`
  } else if (terms.rateForNewAccounts) {
    periodValue = 'For new accounts; how long it holds is not stated'
    periodPhrase = 'the rate is for new accounts and how long it holds is not stated'
  } else if (!product.rateConfirmed) {
    periodValue = 'From CCPC only; how long it holds is not stated'
    periodPhrase = 'the rate is from CCPC only and how long it holds is not stated'
  } else if (terms.basis === 'variable') {
    periodValue = 'Variable; no end stated'
    periodPhrase = 'the rate is variable with no end stated'
  } else if (terms.basis === 'fixed') {
    periodValue = 'No end stated'
    periodPhrase = 'no end to the rate is stated'
  } else {
    periodValue = 'Not stated'
    periodPhrase = 'how long the rate holds is not stated'
  }

  const moneyValue =
    rate === null
      ? 'No figure: no rate stated'
      : result.paidIn === 0
        ? '€0: it takes none of this money'
        : stopsAt !== null
          ? `${whole(money)}; interest stops ${shortMonth(stopsAt)}`
          : whole(money)

  const accessValue =
    terms.access === 'fixed_term'
      ? termEnd === null
        ? 'Fixed term'
        : `Locked until ${shortMonth(termEnd)}`
      : terms.access === 'notice'
        ? `${String(terms.noticeDays ?? 0)} days’ notice`
        : 'Instant access'

  const range = (low: number | null, high: number | null, unit: string): string =>
    low !== null && high !== null
      ? `${whole(low)} to ${whole(high)}${unit}`
      : high !== null
        ? `up to ${whole(high)}${unit}`
        : low !== null
          ? `from ${whole(low)}${unit}`
          : ''
  const monthlyValue =
    terms.access === 'fixed_term' || terms.takesMonthly === false
      ? 'No'
      : terms.takesMonthly === null
        ? 'Not stated'
        : `Yes${terms.minMonthlyEur === null && terms.maxMonthlyEur === null ? '' : `, ${range(terms.minMonthlyEur, terms.maxMonthlyEur, ' a month')}`}`
  const lumpValue =
    terms.takesLumpSum === false
      ? 'No'
      : terms.takesLumpSum === null
        ? 'Not stated'
        : `Yes${terms.minLumpSumEur === null && terms.maxLumpSumEur === null ? '' : `, ${range(terms.minLumpSumEur, terms.maxLumpSumEur, '')}`}`
  const caps = [
    terms.maxMonthlyEur === null ? null : `${whole(terms.maxMonthlyEur)} a month`,
    terms.maxLumpSumEur === null ? null : `${whole(terms.maxLumpSumEur)} in one sum`,
    terms.thresholdBonus === null && terms.bands.length > 1
      ? bandsInWords(terms.bands, Number.POSITIVE_INFINITY)
      : null,
  ].filter((part): part is string => part !== null)
  const capsValue = caps.length === 0 ? 'None stated' : sentence(caps.join('; ')).slice(0, -1)

  const guarantee = product.depositGuarantee
  const guaranteeValue =
    guarantee === null || (guarantee.country === null && guarantee.scheme === null)
      ? 'Not recorded'
      : `${guarantee.country ?? guarantee.scheme ?? ''}${guarantee.coverEur === null ? '' : `, to ${whole(guarantee.coverEur)} a person`}`
  const sourceValue = `${sourceOf(product)}, ${dayOf(product.provenance.checkedAt)}`

  // ---- The money in a sentence -------------------------------------------------------------
  const takes = rate === null ? null : takesWords(saved, monthly, lumpIn, monthlyIn)
  const counts =
    rate === null
      ? 'No money figure: no rate is stated.'
      : terms.access === 'fixed_term'
        ? `${whole(money)} by ${monthName(horizon.by)} counts ${pct(rate)} for the ${String(termMonths ?? result.knownMonths)}-month term${termEnd === null ? '' : `, to ${monthName(termEnd)}`}, on ${takes ?? ''}` +
          (stopsAt === null ? '.' : '; the rate after it is not stated, so the money stops there.')
        : `${whole(money)} by ${monthName(horizon.by)} counts ` +
          (period === null
            ? pct(rate)
            : `${pct(rate)} to ${period.endsLong}, ${period.after === null ? 'then stops: the rate after is not stated' : `then ${period.after}`}`) +
          `, on ${takes ?? ''}.`
  const bonusWords =
    timing === 'by_keys'
      ? ` It includes a ${whole(bonus)} bonus${terms.dirtApplies ? ' after DIRT' : ''}, on its conditions.`
      : timing === 'after_drawdown'
        ? ` The ${whole(statedBonus)} bonus is paid after drawdown and is not counted.`
        : timing === 'not_stated'
          ? ` The ${whole(statedBonus)} bonus is not counted: when it is paid is not stated.`
          : ''
  const moneyLine = counts + bonusWords

  // ---- The facts to know and the detail: the products card's own, else worked out here -----
  const cardRow = input.cardRow
  // A regular saver's row is the same account at any access: its must-knows are the row's own.
  const sameTerm =
    cardRow !== undefined &&
    (cardRow.row.kind === accessKind(terms, termMonths) ||
      (cardRow.row.kind === REGULAR_SAVER_KIND && terms.access !== 'fixed_term'))
  const abroad =
    guarantee !== null && guarantee.country !== null && guarantee.country !== 'Ireland'
      ? guarantee.country
      : null
  const mustKnow =
    sameTerm && cardRow.row.mustKnow !== undefined
      ? keep(cardRow.row.mustKnow, PRODUCTS_ROW_MAX_MUST_KNOW)
      : keep(
          [
            termEnd === null ? null : `Money locked until ${monthName(termEnd)}`,
            terms.access === 'notice' && terms.noticeDays !== null
              ? `${String(terms.noticeDays)} days’ notice to take money out`
              : null,
            period === null
              ? null
              : period.after === null
                ? `Rate ends ${period.endsShort}; the rate after is not stated`
                : `Rate ends ${period.endsShort}, then ${period.after}`,
            abroad === null ? null : `Deposit guarantee: ${abroad}, not Ireland`,
            product.platform === null ? null : `Opened through ${product.platform.name}`,
            monthly > 0 && placed.monthly === 0 && terms.takesLumpSum === true
              ? 'Monthly saving not accepted; lump sum only'
              : null,
            isRegularSaver(product) && terms.takesLumpSum !== true
              ? saved > 0
                ? `Monthly payments only; the ${whole(saved)} needs another account`
                : 'Monthly payments only'
              : null,
          ],
          PRODUCTS_ROW_MAX_MUST_KNOW,
        )
  const conditions = statedConditions(product).filter((line) => !line.startsWith('who can open'))
  const detail =
    sameTerm && cardRow.row.detail !== undefined
      ? keep(
          [moneyLine, ...cardRow.row.detail.filter((line) => line !== cardRow.figureBasis)],
          PRODUCTS_ROW_MAX_DETAIL,
        )
      : keep(
          [
            moneyLine,
            conditions.length === 0 ? null : sentence(conditions.join('; ')),
            `From ${sourceOf(product)}, checked ${longDayOf(product.provenance.checkedAt)}.`,
            product.unknowns.length === 0
              ? null
              : `Not stated by the source: ${product.unknowns.map((unknown) => unknown.meaning).join('; ')}.`,
            ...product.checks.filter((line) => line.startsWith('Tax: ')),
            guarantee?.scheme === null || guarantee?.scheme === undefined
              ? null
              : `Protected by the ${guarantee.scheme}${guarantee.coverEur === null ? '' : `, to ${whole(guarantee.coverEur)} a person`}.`,
          ],
          PRODUCTS_ROW_MAX_DETAIL,
        )

  return {
    rowId,
    lead: displayName(product),
    providerId: product.provider,
    brand: brandOf(product.provider),
    kind: accessKind(terms, termMonths),
    product,
    values: {
      rate: rateValue,
      period: periodValue,
      money: moneyValue,
      access: accessValue,
      monthly: monthlyValue,
      lump: lumpValue,
      caps: capsValue,
      guarantee: guaranteeValue,
      source: sourceValue,
    },
    money: rate === null ? null : money,
    lumpMoney:
      rate === null || lumpOnly === null || lumpOnly.paidIn === 0 ? null : lumpOnly.netInterest,
    moneyLine,
    access: terms.access,
    noticeDays: terms.noticeDays,
    termEnd,
    termMonths,
    takes,
    period,
    periodPhrase,
    guaranteeCountry: guarantee?.country ?? null,
    keysOn,
    mustKnow,
    detail,
  }
}

// ---------------------------------------------------------------------------------------------
// Their own account's column
// ---------------------------------------------------------------------------------------------

/** "Your BoI savings", "Your current account": as the products card names it. */
const GENERIC_FIRST_WORD =
  /^(current|savings?|deposit|fixed|regular|instant|notice|online|joint|credit|rainy|emergency|easy|demand|the)\b/i
const ownLabel = (account: HeldAccount): string => {
  const label = account.label.trim()
  if (/^your\b/i.test(label)) return `Your${label.slice(4)}`
  const own = label.replace(/^(my|our)\s+/i, '')
  const read = GENERIC_FIRST_WORD.test(own) ? own.charAt(0).toLowerCase() + own.slice(1) : own
  return `Your ${read}`
}

function heldColumn(input: {
  readonly rowId: string
  readonly account: HeldAccount
  readonly rate: number | null
  readonly fromTable: boolean
  readonly horizon: Horizon
  readonly cardRow: CardRow | undefined
}): Column {
  const { rowId, account, rate, horizon } = input
  const money = rate === null ? null : heldInterest(account.balance, rate, horizon.months)
  const providerId = providerIdOf(account.provider)
  const moneyLine =
    money === null || rate === null
      ? 'No money figure: the rate was not given.'
      : `${whole(money)} by ${monthName(horizon.by)} counts ${pct(rate)}, ${input.fromTable ? 'the rate in CCPC’s current-account table' : 'the rate given for it'}, on the ${whole(account.balance)} it holds.`
  const kind =
    account.kind === 'current'
      ? 'current account'
      : account.kind === 'deposit'
        ? 'fixed term'
        : 'savings'
  return {
    rowId,
    lead: ownLabel(account),
    providerId,
    brand: providerId === null ? null : brandOf(providerId),
    kind,
    product: null,
    values: {
      rate: rate === null ? 'Not given' : pct(rate),
      period:
        rate === null ? 'Not given' : input.fromTable ? 'From CCPC’s table' : 'As you gave it',
      money:
        money === null
          ? 'No figure: rate not given'
          : `${whole(money)} on ${whole(account.balance)} held`,
      access: account.kind === 'deposit' ? 'Fixed term' : 'As you hold it',
      monthly: 'Not given',
      lump: 'Not given',
      caps: 'Not given',
      guarantee: 'Not given',
      source: 'Your own figures',
    },
    money,
    lumpMoney: null,
    moneyLine,
    access: 'held',
    noticeDays: null,
    termEnd: null,
    termMonths: null,
    takes: `the ${whole(account.balance)} it holds`,
    period: null,
    periodPhrase: rate === null ? 'the rate was not given' : 'the rate is as given',
    guaranteeCountry: null,
    keysOn: null,
    mustKnow: [],
    detail: keep(
      [
        moneyLine,
        ...(input.cardRow?.row.detail ?? []).filter((line) => line !== input.cardRow?.figureBasis),
      ],
      PRODUCTS_ROW_MAX_DETAIL,
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// What separates them, and the question that decides it
// ---------------------------------------------------------------------------------------------

const ROW_ORDER = [
  'rate',
  'period',
  'money',
  'access',
  'monthly',
  'lump',
  'caps',
  'guarantee',
  'source',
] as const

/** "the Netherlands", "Ireland": a country as a sentence names it. */
const countryWords = (country: string): string =>
  /^(Netherlands|United Kingdom|Czech Republic|United States)$/.test(country)
    ? `the ${country}`
    : country

/** "a month", "2 months". */
const monthsWords = (months: number): string =>
  months === 1 ? 'a month' : `${String(months)} months`

function differencesOf(columns: readonly Column[], horizon: Horizon, saved: number): string[] {
  const lines: string[] = []
  const keys = monthName(horizon.by)
  const fixed = columns.filter((column) => column.termEnd !== null)
  const open = columns.filter((column) => column.termEnd === null)

  // How long the money is tied up, against the keys.
  if (fixed.length > 0 && open.length > 0) {
    const [first] = fixed
    const [other] = open
    if (
      fixed.length === 1 &&
      open.length === 1 &&
      first !== undefined &&
      other !== undefined &&
      first.lumpMoney !== null &&
      other.lumpMoney !== null
    ) {
      const gap = first.lumpMoney - other.lumpMoney
      const verb =
        Math.abs(gap) < 1
          ? `earns the same as in ${other.lead}`
          : gap > 0
            ? `earns ${whole(gap)} more than in ${other.lead}`
            : `earns ${whole(-gap)} less than in ${other.lead}`
      lines.push(
        `Locking the ${whole(saved)} until ${monthName(first.termEnd ?? horizon.by)} in ${first.lead} ${verb} by ${keys}` +
          (other.access === 'notice'
            ? `, where it takes ${String(other.noticeDays ?? 0)} days’ notice to take out.`
            : ', where the money is at hand.'),
      )
    } else {
      lines.push(
        `${listWords(fixed.map((column) => `${column.lead} locks the money until ${monthName(column.termEnd ?? horizon.by)}`))}; ${listWords(open.map((column) => column.lead))} ${open.length === 1 ? 'has' : 'have'} no term.`,
      )
    }
  }
  // Each term's end against the keys: what decides between terms, and a term that runs past them.
  const distinctEnds = new Set(fixed.map((column) => column.termEnd)).size > 1
  const pastKeys = horizon.dated && fixed.some((column) => (column.termEnd ?? '') > horizon.by)
  if ((fixed.length >= 2 && distinctEnds) || pastKeys) {
    lines.push(
      sentence(
        fixed
          .map((column, index) => {
            const end = column.termEnd ?? horizon.by
            const them = index === 0 ? `the keys in ${keys}` : 'them'
            const against = !horizon.dated
              ? ''
              : end === horizon.by
                ? `, the month of ${them}`
                : end < horizon.by
                  ? `, ${monthsWords(monthsUntil(`${end}-01`, horizon.by))} before ${them}`
                  : `, ${monthsWords(monthsUntil(`${horizon.by}-01`, end))} after ${them}`
            return `the ${String(column.termMonths ?? 0)}-month term in ${column.lead} ends ${monthName(end)}${against}`
          })
          .join('; '),
      ),
    )
  }
  const notice = columns.filter((column) => column.access === 'notice')
  if (notice.length > 0 && notice.length < columns.length && fixed.length === 0) {
    lines.push(
      `${listWords(notice.map((column) => `${column.lead} takes ${String(column.noticeDays ?? 0)} days’ notice`))} to take money out; ${listWords(columns.filter((column) => column.access === 'instant').map((column) => column.lead))} is instant access.`.replace(
        /; is instant access\.$/,
        '.',
      ),
    )
  }

  // The money, in the order selected.
  const known = columns.filter((column) => column.money !== null)
  if (known.length === columns.length) {
    const amounts = known.map((column) => column.money ?? 0)
    const spread = Math.max(...amounts) - Math.min(...amounts)
    if (spread >= 1) {
      lines.push(
        `By ${keys} the interest after DIRT is ${listWords(known.map((column) => `${whole(column.money ?? 0)} in ${column.lead}`))}` +
          (known.length === 2 ? `, ${whole(spread)} apart.` : '.'),
      )
    }
  }

  // What each takes of their money.
  const takes = columns.map((column) => column.takes)
  if (new Set(takes).size > 1 && takes.every((item) => item !== null)) {
    lines.push(
      `${columns.map((column) => `${column.lead} takes ${column.takes ?? ''}`).join('; ')}.`,
    )
  }

  // How long each rate holds.
  if (
    new Set(columns.map((column) => column.values.period)).size > 1 &&
    columns.some((column) => column.period !== null)
  ) {
    lines.push(
      sentence(columns.map((column) => `in ${column.lead}, ${column.periodPhrase}`).join('; ')),
    )
  }

  // The keys month each gives with its own interest.
  const keysOn = columns.map((column) => column.keysOn)
  if (keysOn.every((month) => month !== null) && new Set(keysOn).size > 1) {
    lines.push(
      `With its own interest the keys come in ${listWords(columns.map((column) => `${monthName(column.keysOn ?? horizon.by)} in ${column.lead}`))}.`,
    )
  }

  // Whose deposit guarantee.
  const countries = columns.map((column) => column.guaranteeCountry)
  if (countries.every((country) => country !== null) && new Set(countries).size > 1) {
    lines.push(
      `The deposit guarantee is ${listWords(columns.map((column) => `from ${countryWords(column.guaranteeCountry ?? '')} in ${column.lead}`))}.`,
    )
  }
  return lines
}

function decidesOf(
  columns: readonly Column[],
  horizon: Horizon,
  saved: number,
  monthly: number,
): string {
  const fixed = columns.filter((column) => column.termEnd !== null)
  const ends = new Set(fixed.map((column) => column.termEnd))
  if (fixed.length > 0 && (fixed.length < columns.length || ends.size > 1)) {
    const latest = [...ends]
      .filter((end): end is string => end !== null)
      .sort()
      .at(-1)
    return `Will you need any of the ${whole(saved)} before ${monthName(latest ?? horizon.by)}?`
  }
  if (columns.some((column) => column.access === 'notice') && fixed.length === 0) {
    const notice = columns.find((column) => column.access === 'notice')
    return `Will you need any of it at less than ${String(notice?.noticeDays ?? 0)} days’ notice before ${monthName(horizon.by)}?`
  }
  if (new Set(columns.map((column) => column.takes)).size > 1) {
    const parts = [
      saved > 0 ? `the ${whole(saved)} already saved` : null,
      monthly > 0 ? `the ${whole(monthly)} a month from here` : null,
    ].filter((part): part is string => part !== null)
    if (parts.length === 2)
      return `Is this account for ${parts[0] ?? ''}, ${parts[1] ?? ''}, or both?`
  }
  const ending = columns
    .filter((column) => column.period !== null)
    .sort((a, b) => (a.period?.months ?? 0) - (b.period?.months ?? 0))[0]
  if (ending?.period !== undefined && ending.period !== null) {
    return `Will the money stay put past ${ending.period.endsLong}, when the rate in ${ending.lead} ends?`
  }
  const countries = columns.map((column) => column.guaranteeCountry)
  if (countries.every((country) => country !== null) && new Set(countries).size > 1) {
    return 'Does it matter to you which country’s deposit guarantee covers the money?'
  }
  const amounts = columns.flatMap((column) => (column.money === null ? [] : [column.money]))
  const spread = amounts.length < 2 ? 0 : Math.max(...amounts) - Math.min(...amounts)
  if (spread >= 1) {
    return `Is the ${whole(spread)} between them by ${monthName(horizon.by)} what matters most to you here?`
  }
  return 'With the figures this close, what else matters to you about where the money sits?'
}

/** The warnings that attach to the products compared. */
function warningsOf(products: readonly ProductView[]): string[] {
  const warnings = new Set<string>()
  for (const product of products) {
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

/** Every string a comparison card says, for `adviceWordsIn`. */
export function comparisonCardText(card: ProductComparisonCard): string {
  return [
    card.title,
    ...card.columns.flatMap((column) => [column.lead, column.kind]),
    ...card.rows.flatMap((row) => [row.label, ...row.values]),
    ...card.differences,
    card.decides,
    ...card.mustKnow.flatMap((item) => [...item.facts, ...(item.detail ?? [])]),
    ...card.basis.figures,
    ...card.basis.assumptions,
    card.basis.coverage,
    ...card.basis.warnings,
    card.statement,
  ].join('\n')
}

/**
 * The comparison of the rows selected, or why there is none: fewer than two or more than three
 * ids, the same one twice, an id the market does not hold, a product that is not a savings or
 * deposit account, or a case with nothing to work on.
 */
export function compareProducts(
  market: Market,
  figures: CaseFigures,
  rowIds: readonly string[],
  asOf: AsOf,
): ComparisonResult {
  if (rowIds.length < COMPARISON_MIN_COLUMNS || rowIds.length > COMPARISON_MAX_COLUMNS) {
    return {
      kind: 'refused',
      reason: `A comparison takes ${String(COMPARISON_MIN_COLUMNS)} or ${String(COMPARISON_MAX_COLUMNS)} products.`,
    }
  }
  if (new Set(rowIds).size !== rowIds.length) {
    return { kind: 'refused', reason: 'The same product was named twice.' }
  }
  const saved = figures.held.reduce((sum, account) => sum + account.balance, 0)
  const monthly = figures.monthlySavingEur ?? 0
  if (saved <= 0 && monthly <= 0) {
    return {
      kind: 'refused',
      reason:
        'No figures to compare on: how much is saved now, and how much goes aside each month?',
    }
  }
  const horizon = horizonOf(figures, asOf)

  // Their own accounts' rates, a current account's from CCPC's table where none was given.
  const resolvedHeld = withHeldRates(market, {
    savings: figures.held.map((account) => ({
      label: account.label,
      balance: account.balance,
      ...(account.provider === null ? {} : { provider: account.provider }),
      ...(account.ratePct === null ? {} : { aerPct: account.ratePct }),
      ...(account.kind === 'current' ? { access: 'current_account' as const } : {}),
    })),
    debts: [],
  })

  const cardIds = rowIds.map((rowId) => {
    const found = rowId.startsWith('held:') ? null : resolve(market, rowId)
    return found === null ? rowId : found.product.id
  })
  const cardRows = cardRowsFor(market, figures, cardIds, horizon.dated, asOf)

  const columns: Column[] = []
  for (const [index, rowId] of rowIds.entries()) {
    const cardRow = cardRows.get(cardIds[index] ?? rowId)
    const heldMatch = /^held:(\d+)$/.exec(rowId)
    if (heldMatch !== null) {
      const at = Number(heldMatch[1]) - 1
      const account = figures.held[at]
      if (account === undefined) {
        return { kind: 'refused', reason: `${rowId} is not one of their accounts on this case.` }
      }
      const rate = resolvedHeld.situation.savings[at]?.aerPct ?? account.ratePct
      columns.push(
        heldColumn({
          rowId,
          account,
          rate,
          fromTable: account.ratePct === null && rate !== null,
          horizon,
          cardRow,
        }),
      )
      continue
    }
    const found = resolve(market, rowId)
    if (found === null) {
      return { kind: 'refused', reason: `${rowId} is not in the market Saoi holds.` }
    }
    const terms = found.product.terms
    if (terms.kind !== 'deposit') {
      return {
        kind: 'refused',
        reason:
          `${displayName(found.product)} is not a savings or deposit account; the comparison ` +
          'sets savings and deposit accounts side by side, and the mortgage card already sets ' +
          'lenders side by side.',
      }
    }
    columns.push(
      marketColumn({
        rowId,
        product: found.product,
        terms,
        rungMonths: found.rungMonths,
        figures,
        horizon,
        asOf,
        cardRow,
      }),
    )
  }

  const values = (key: (typeof ROW_ORDER)[number]) => columns.map((column) => column.values[key])
  const rows = ROW_ORDER.map((key) => {
    const row = values(key)
    return {
      label: key === 'money' ? COMPARISON_LABELS.money(horizon.by) : COMPARISON_LABELS[key],
      values: row,
      differs: new Set(row).size > 1,
    }
  })

  const products = columns.flatMap((column) => (column.product === null ? [] : [column.product]))
  const checked = oldestCheck(products)
  const anyFixed = columns.some((column) => column.termEnd !== null)
  const named = columns.map((column) => column.lead)
  const card: ProductComparisonCard = {
    type: 'product_comparison',
    title:
      named.length === 2
        ? `${named[0] ?? ''} against ${named[1] ?? ''}`
        : `${listWords(named)}, side by side`,
    columns: columns.map((column) => ({
      rowId: column.rowId,
      lead: column.lead,
      ...(column.providerId === null ? {} : { providerId: column.providerId }),
      brand: column.brand,
      kind: column.kind,
    })),
    rows,
    differences: differencesOf(columns, horizon, saved),
    decides: decidesOf(columns, horizon, saved, monthly),
    mustKnow: columns.map((column) => ({
      rowId: column.rowId,
      facts: column.mustKnow,
      detail: column.detail,
    })),
    basis: {
      figures: [
        ...figures.held.map(
          (account) =>
            `${account.label}${account.provider === null ? '' : ` (${account.provider})`}: ${whole(account.balance)}` +
            (account.ratePct === null ? '' : ` at ${pct(account.ratePct)}`),
        ),
        `${whole(saved)} held and ${whole(monthly)} a month, placed where each account takes them; your own account on its own balance`,
        horizon.dated
          ? `${monthName(horizon.by)}, ${figures.keysFrom === 'plan' ? 'the month the money for the keys is there in your plan' : 'the date you gave'}`
          : `${String(NO_DATE_HORIZON)} months, as no date is known`,
        ...(figures.neededAtKeysEur === null
          ? []
          : [`${whole(figures.neededAtKeysEur)} needed at the keys`]),
      ],
      assumptions: [
        moneyColumnLine(horizon),
        ...SAVINGS_ASSUMPTIONS.filter((line) => !line.startsWith('Bonuses')),
        'A bonus is counted by the date only when it is paid by then; one paid after the mortgage is drawn down, or whose payment date is not stated, is noted and not counted.',
        ...(anyFixed && horizon.dated ? [TERM_FIT_RULE] : []),
      ],
      coverage:
        `The ${String(columns.length)} products you selected, in the order you selected them; ` +
        `no order of preference. Figures from ${listWords([...new Set(products.map(sourceOf))])}` +
        (checked === null ? '.' : `, the oldest checked ${checked.slice(0, 10)}.`),
      warnings: warningsOf(products),
    },
    statement: RESULT_STATEMENT,
  }
  return {
    kind: 'card',
    card,
    figureBasis: columns.map((column) => ({ rowId: column.rowId, line: column.moneyLine })),
  }
}

/** A savings row's key facts, rebuilt by id when it is on no card (`domain/market/choices.ts`). */
export type RowFacts = {
  readonly lead: string
  readonly providerId: string
  readonly kind: string
  readonly value: string
  readonly figure: string
}

/**
 * The key facts of a savings or deposit row the products card would show, worked out on the
 * comparison's money rules for a row that is on no card the case would build (the case moved on
 * since it was shown). Null for an id the market does not hold, or a product that is not a
 * savings or deposit account.
 */
export function rowFacts(
  market: Market,
  figures: CaseFigures,
  rowId: string,
  asOf: AsOf,
): RowFacts | null {
  const found = resolve(market, rowId)
  if (found === null || found.product.terms.kind !== 'deposit') return null
  const horizon = horizonOf(figures, asOf)
  const column = marketColumn({
    rowId,
    product: found.product,
    terms: found.product.terms,
    rungMonths: found.rungMonths,
    figures,
    horizon,
    asOf,
    cardRow: undefined,
  })
  return {
    lead: column.lead,
    providerId: found.product.provider,
    kind: column.kind,
    value: column.values.rate,
    figure:
      column.money === null
        ? column.values.money
        : `${whole(column.money)} by ${shortMonth(horizon.by)}`,
  }
}
