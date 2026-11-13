import type { DepositTerms, ProductView } from '../../contracts/market-tools.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { MARKET_CATEGORIES, type MarketCategory } from '../../market/schema.ts'
import { shortDate } from './alerts.ts'
import { euro } from './figures.ts'
import { pct } from './product.ts'
import { bandsInWords } from './rate-period.ts'
import type { Market } from './types.ts'

/**
 * A product, a provider or a rate the customer named, looked up in the market (2026-11-13: asked
 * about "BOI's 18m fix at 2.48%" and "AIB's 24m fix for 2.26%", Saoirse said she did not hold the
 * AIB figure, when both were in the market). Every provider and every source, through the
 * normalised views the comparison API and `show_products` use. Pure.
 *
 * Matching is by words, not ranking: a view matches when every word of the query that carries
 * meaning is in its provider, name, category or kind, and a term the query names ("18 months",
 * "2 year") is one the product offers. The order is the match, then category, provider and
 * name; never a rate, so nothing here reads as a pick.
 */

export const LOOKUP_DEFAULT_LIMIT = 5
export const LOOKUP_MAX_LIMIT = 8

export type LookupRequest = {
  /** The customer's words: a provider, a product name, or words such as "18 month fixed". */
  readonly query: string
  readonly category?: MarketCategory | undefined
  readonly limit?: number | undefined
}

/** One product as facts: everything a sentence about it may say, and nothing it may not. */
export type LookupFact = {
  readonly id: string
  readonly provider: string
  readonly product: string
  readonly category: MarketCategory
  /** The headline rate with its period, or the terms on offer. */
  readonly rate: string
  /** The term or the access to the money. */
  readonly access: string
  /** What the source states about it: limits, bonuses, who can open it, its own words. */
  readonly conditions: readonly string[]
  /** "CCPC" or "Bank of Ireland's own page". */
  readonly source: string
  readonly attribution: string | null
  /** YYYY-MM-DD: the day the figures were last read. */
  readonly checkedOn: string
  /** What the source does not give, in words. */
  readonly unknowns: readonly string[]
  /** `rateConfirmed` on the view. */
  readonly confirmed: boolean
}

export type LookupOutcome = {
  readonly query: string
  readonly category: MarketCategory | null
  readonly matches: readonly LookupFact[]
  /** Matches past the limit. */
  readonly more: number
  /** Words of the query no match carries (a partial match, or a miss). */
  readonly unmatched: readonly string[]
  /** A term the query named that none of the matches offers, in months. */
  readonly termNotListed: number | null
  /** True when not every word matched: the matches share the provider named and some words. */
  readonly partial: boolean
}

// -------------------------------------------------------------------------------------------
// Words
// -------------------------------------------------------------------------------------------

/** Words that say nothing about which product: dropped from the query before matching. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'about',
  'account',
  'accounts',
  'aer',
  'an',
  'and',
  'apr',
  'are',
  'around',
  'at',
  'bank',
  'banks',
  'best',
  'better',
  'cent',
  'cheapest',
  'compare',
  'deal',
  'deals',
  'do',
  'does',
  'for',
  'from',
  'has',
  'have',
  'highest',
  'how',
  'i',
  'in',
  'interest',
  'is',
  'it',
  'its',
  'me',
  'month',
  'months',
  'much',
  'my',
  'new',
  'of',
  'offer',
  'offers',
  'on',
  'or',
  'our',
  'pay',
  'paying',
  'pays',
  'per',
  'percent',
  'product',
  'products',
  'rate',
  'rates',
  's',
  'than',
  'that',
  'the',
  'their',
  'this',
  'to',
  'top',
  'versus',
  'vs',
  'what',
  'whats',
  'with',
  'worse',
  'year',
  'years',
  'your',
])

/** Words a customer says for a category or a kind, added to each view's own words. */
const CATEGORY_WORDS: Readonly<Record<MarketCategory, string>> = {
  savings: 'savings saving saver regular',
  deposit: 'deposit deposits savings saving saver',
  mortgage: 'mortgage mortgages home',
  loan: 'loan loans personal borrowing',
  credit_card: 'credit card cards',
  current_account: 'current',
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replaceAll('_', ' ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)

/** A query word matches a view word when they are equal, or the view word begins with it (3+). */
const wordMatches = (query: string, haystack: readonly string[]): boolean =>
  haystack.some((word) => word === query || (query.length >= 3 && word.startsWith(query)))

const TERM_MONTHS = /(\d+)\s*-?\s*(?:m|mo|mos|mth|mths|month|months)\b/gi
const TERM_YEARS = /(\d+)\s*-?\s*(?:y|yr|yrs|year|years)\b/gi
/** A rate the customer quotes ("2.48%", "2.26"): not a word to match a product by. */
const QUOTED_RATE = /\d+(?:\.\d+)?\s*%|\b\d+\.\d+\b/g

/** The query as words to match and a term in months, where it names one. */
export function parseQuery(query: string): {
  readonly words: string[]
  readonly term: number | null
} {
  const withoutRates = query.replace(QUOTED_RATE, ' ')
  const inMonths = new RegExp(TERM_MONTHS.source, 'i').exec(withoutRates)
  const inYears = new RegExp(TERM_YEARS.source, 'i').exec(withoutRates)
  const term =
    inMonths !== null ? Number(inMonths[1]) : inYears !== null ? Number(inYears[1]) * 12 : null
  const rest = withoutRates.replace(TERM_MONTHS, ' ').replace(TERM_YEARS, ' ')
  const unique = [...new Set(words(rest).filter((word) => !STOP_WORDS.has(word)))]
  return { words: unique, term: term === null || term <= 0 ? null : term }
}

function providerWords(view: ProductView): string[] {
  return words(`${view.provider} ${view.providerName}`)
}

function viewWords(view: ProductView): string[] {
  const terms = view.terms
  const kind: string[] = []
  switch (terms.kind) {
    case 'deposit':
      kind.push(
        terms.access === 'fixed_term'
          ? 'fixed term fix'
          : terms.access === 'notice'
            ? 'notice'
            : 'instant access demand easy',
        terms.basis ?? '',
      )
      break
    case 'mortgage':
      kind.push(terms.rateType ?? '', terms.rateType === 'fixed' ? 'fix' : '')
      break
    case 'loan':
      kind.push(terms.rateType ?? '')
      break
    case 'credit_card':
    case 'current_account':
      break
  }
  return words(
    [view.provider, view.providerName, view.name, CATEGORY_WORDS[view.category], ...kind].join(' '),
  )
}

/** The terms a product offers, in months: a ladder's rungs, an introductory period, a fix. */
function termsOffered(view: ProductView): number[] {
  const terms = view.terms
  if (terms.kind === 'deposit') {
    return [
      ...terms.ladder.map((rung) => rung.months),
      ...(terms.introductory === null ? [] : [terms.introductory.months]),
    ]
  }
  if (terms.kind === 'mortgage' && terms.fixedYears !== null) return [terms.fixedYears * 12]
  return []
}

// -------------------------------------------------------------------------------------------
// Lookup
// -------------------------------------------------------------------------------------------

const CATEGORY_ORDER = new Map(MARKET_CATEGORIES.map((category, index) => [category, index]))

const byPlace = (a: ProductView, b: ProductView): number =>
  (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0) ||
  a.providerName.localeCompare(b.providerName) ||
  a.name.localeCompare(b.name)

export function lookupProducts(market: Market, request: LookupRequest): LookupOutcome {
  const limit = Math.max(1, Math.min(LOOKUP_MAX_LIMIT, request.limit ?? LOOKUP_DEFAULT_LIMIT))
  const category = request.category ?? null
  const { words: wanted, term } = parseQuery(request.query)
  const pool = market.products.filter((view) => category === null || view.category === category)

  const scored = pool.map((view) => {
    const haystack = viewWords(view)
    const matched = wanted.filter((word) => wordMatches(word, haystack))
    return { view, matched, haystack }
  })

  // Every word matches. With no words (a bare term, or a category), every product does.
  let found = scored.filter((entry) => entry.matched.length === wanted.length)
  let partial = false

  if (found.length === 0 && wanted.length > 0) {
    // Not every word: the provider named, and at least one more word, or the provider alone.
    const named = wanted.filter((word) =>
      market.products.some((view) => wordMatches(word, providerWords(view))),
    )
    if (named.length > 0) {
      const ofProvider = scored.filter((entry) =>
        named.every((word) => wordMatches(word, providerWords(entry.view))),
      )
      const most = Math.max(0, ...ofProvider.map((entry) => entry.matched.length))
      found = ofProvider.filter(
        (entry) =>
          entry.matched.length === most && (most > named.length || wanted.length === named.length),
      )
      partial = found.length > 0
    }
  }

  // A term the query names: keep the products that offer it, when any do.
  let termNotListed: number | null = null
  if (term !== null && found.length > 0) {
    const withTerm = found.filter((entry) => termsOffered(entry.view).includes(term))
    if (withTerm.length > 0) found = withTerm
    else termNotListed = term
  }

  // One product CCPC lists in two tables (bunq, MoCo: savings and deposits) is one fact.
  const seen = new Set<string>()
  const ordered = [...found]
    .sort((a, b) => byPlace(a.view, b.view))
    .map((entry) => ({ entry, fact: factsOf(market, entry.view, term) }))
    .filter(({ fact }) => {
      const key = [fact.provider, fact.product, fact.rate, fact.access].join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  const shown = ordered.slice(0, limit)
  const carried = new Set(shown.flatMap(({ entry }) => entry.matched))

  return {
    query: request.query,
    category,
    matches: shown.map(({ fact }) => fact),
    more: Math.max(0, ordered.length - shown.length),
    unmatched: shown.length === 0 ? wanted : wanted.filter((word) => !carried.has(word)),
    termNotListed,
    partial,
  }
}

// -------------------------------------------------------------------------------------------
// Facts
// -------------------------------------------------------------------------------------------

/** The longest piece of a source's own words a lookup carries; the rest is "…". */
export const PROSE_LIMIT = 320

const trimmed = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= PROSE_LIMIT ? flat : `${flat.slice(0, PROSE_LIMIT - 1).trimEnd()}…`
}

const months = (count: number): string =>
  count % 12 === 0 && count >= 24
    ? `${String(count / 12)} years`
    : `${String(count)} month${count === 1 ? '' : 's'}`

function depositRate(terms: DepositTerms, term: number | null): string {
  if (terms.ladder.length > 0) {
    const rungs = terms.ladder.map((rung) => `${months(rung.months)} ${pct(rung.aerPct)} AER`)
    const asked = term === null ? undefined : terms.ladder.find((rung) => rung.months === term)
    const fixed = terms.basis === 'variable' ? '' : ', fixed for the term'
    if (asked !== undefined) {
      const others = terms.ladder.filter((rung) => rung !== asked)
      return (
        `${pct(asked.aerPct)} AER for ${months(asked.months)}${fixed}` +
        (others.length === 0
          ? ''
          : `; also ${others.map((rung) => `${months(rung.months)} ${pct(rung.aerPct)}`).join(', ')}`)
      )
    }
    return `${rungs.join(', ')}${fixed}`
  }
  if (terms.thresholdBonus !== null) {
    const bonus = terms.thresholdBonus
    const after = bandsInWords(bonus.baseBands, Number.POSITIVE_INFINITY) ?? 'not stated'
    return (
      `${pct(bonus.bonusAerPct)} AER on every euro until the first reset (the 1st of ` +
      `${bonus.resetMonths.map((month) => MONTH_NAMES[month - 1] ?? '').join(' and ')}); after ` +
      `that the balance up to the highest of the past ${String(bonus.lookbackMonths)} months ` +
      `earns ${after}, and only the part above it earns ${pct(bonus.bonusAerPct)}`
    )
  }
  const headline = terms.aerPct === null ? 'no headline rate stated' : `${pct(terms.aerPct)} AER`
  const bands =
    terms.bands.length > 1
      ? ` (${bandsInWords(terms.bands, Number.POSITIVE_INFINITY) ?? ''} by balance)`
      : ''
  const basis = terms.basis === null ? '' : ` ${terms.basis}`
  const intro =
    terms.introductory === null
      ? ''
      : `, for ${months(terms.introductory.months)}, then ${
          terms.introductory.thenAerPct === null
            ? 'a rate that is not stated'
            : pct(terms.introductory.thenAerPct)
        }`
  return `${headline}${basis}${bands}${intro}`
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** A view's rates in one line, as a lookup words them (every rung of a ladder). */
export const rateLineOf = (view: ProductView): string => rateOf(view, null)

function rateOf(view: ProductView, term: number | null): string {
  const terms = view.terms
  switch (terms.kind) {
    case 'deposit':
      return depositRate(terms, term)
    case 'mortgage': {
      const kind =
        terms.rateType === 'fixed' && terms.fixedYears !== null
          ? `fixed for ${months(terms.fixedYears * 12)}`
          : (terms.rateType ?? 'rate type not stated')
      const after =
        terms.rateType === 'fixed'
          ? terms.followOnRatePct === null
            ? ', the rate after it not stated'
            : `, then ${pct(terms.followOnRatePct)} as the lender states it`
          : ''
      return `${pct(terms.initialRatePct)} ${kind}${after}`
    }
    case 'loan':
      return `${pct(terms.aprPct)} APR${terms.rateType === null ? '' : `, ${terms.rateType}`}`
    case 'credit_card':
      return [
        terms.aprPct === null ? 'APR not stated' : `${pct(terms.aprPct)} APR`,
        ...(terms.purchaseRatePct === null ? [] : [`purchases ${pct(terms.purchaseRatePct)}`]),
        ...(terms.cashRatePct === null ? [] : [`cash ${pct(terms.cashRatePct)}`]),
        ...(terms.balanceTransfer === null
          ? []
          : [
              `balance transfers ${pct(terms.balanceTransfer.introPct)} for ${months(terms.balanceTransfer.introMonths)}`,
            ]),
      ].join(', ')
    case 'current_account':
      return [
        terms.quarterlyFeeEur === null
          ? 'fee not stated'
          : `${euro(terms.quarterlyFeeEur)} a quarter in fees`,
        terms.creditInterestPct === null
          ? 'credit interest not stated'
          : `${pct(terms.creditInterestPct)} credit interest`,
      ].join(', ')
  }
}

function accessOf(view: ProductView): string {
  const terms = view.terms
  switch (terms.kind) {
    case 'deposit':
      if (terms.access === 'fixed_term') {
        return `fixed term: ${terms.ladder.map((rung) => months(rung.months)).join(', ')}; the money is held for the term`
      }
      if (terms.access === 'notice') {
        return `${String(terms.noticeDays ?? 0)} days' notice to withdraw`
      }
      return 'instant access'
    case 'mortgage':
      return [
        terms.ltvMinPct === null && terms.ltvMaxPct === null
          ? 'loan-to-value not stated'
          : `loan-to-value ${terms.ltvMinPct === null ? 'up to' : `${String(terms.ltvMinPct)}% to`} ${String(terms.ltvMaxPct ?? 100)}%`,
        ...(terms.ber === null ? [] : [`BER ${terms.ber}`]),
        `for ${terms.buyerTypes.map((type) => type.replaceAll('_', ' ')).join(', ')}`,
      ].join(', ')
    case 'loan':
      return [
        terms.maxAmountEur === null ? null : `up to ${euro(terms.maxAmountEur)}`,
        terms.maxTermMonths === null
          ? terms.maxTermStated === null
            ? null
            : `longest term “${terms.maxTermStated}”`
          : `over up to ${months(terms.maxTermMonths)}`,
      ]
        .filter((part) => part !== null)
        .join(', ')
    case 'credit_card':
      return 'a credit card'
    case 'current_account':
      return terms.overdraft === true ? 'a current account with an overdraft' : 'a current account'
  }
}

/**
 * What the source states about a product, in Saoi's words: limits, the rate for new accounts, a
 * bonus with its conditions, DIRT, when interest is paid, cashback, fees and who can open it.
 */
export function statedConditions(view: ProductView): string[] {
  const lines: string[] = []
  const terms = view.terms
  if (terms.kind === 'deposit') {
    const range = (low: number | null, high: number | null, what: string) =>
      low === null && high === null
        ? null
        : `${what} ${low === null ? '' : `from ${euro(low)}`}${low !== null && high !== null ? ' ' : ''}${high === null ? '' : `up to ${euro(high)}`}`
    const monthly = range(terms.minMonthlyEur, terms.maxMonthlyEur, 'monthly saving')
    const lump = range(terms.minLumpSumEur, terms.maxLumpSumEur, 'lump sum')
    if (monthly !== null) lines.push(monthly)
    if (lump !== null) lines.push(lump)
    if (terms.rateForNewAccounts) {
      lines.push('the rate is for accounts opened now; an account already open may earn another')
    }
    if (terms.bonus !== null) {
      lines.push(`a ${euro(terms.bonus.amountEur)} bonus: ${terms.bonus.conditions.join(' ')}`)
    }
    if (!terms.dirtApplies) lines.push('DIRT-free')
    if (terms.interestPaid !== null)
      lines.push(`interest paid ${terms.interestPaid.replaceAll('_', ' ')}`)
  }
  if (terms.kind === 'mortgage' && terms.cashback.stated !== null) {
    lines.push(`cashback: ${trimmed(terms.cashback.stated)}`)
  }
  if (terms.kind === 'loan' && terms.setupFees !== null)
    lines.push(`set-up fees: ${terms.setupFees}`)
  const eligibility = view.eligibility
  if (eligibility !== null) {
    const who = [
      eligibility.minAge === null ? null : `aged ${String(eligibility.minAge)} or over`,
      eligibility.residentIn === null ? null : `resident in ${eligibility.residentIn}`,
      eligibility.notForUsCitizens === true ? 'not a US citizen' : null,
      eligibility.individualsOnly === true ? 'individuals only' : null,
      eligibility.jointAccounts === false ? 'no joint accounts' : null,
      eligibility.needsAccountWithProvider === null
        ? null
        : `needs ${eligibility.needsAccountWithProvider}`,
    ].filter((part) => part !== null)
    if (who.length > 0) lines.push(`who can open it: ${who.join(', ')}`)
  }
  return lines
}

function conditionsOf(market: Market, view: ProductView): string[] {
  const lines = statedConditions(view)
  // The source's own words, once each, from the current rows the view is built from.
  const rows = new Set(view.provenance.rows.map((row) => `${row.source}|${row.productId}`))
  const prose = new Set(
    (market.recordsOf.get(view.id) ?? [])
      .filter(
        (record) =>
          record.supersededAt === null &&
          rows.has(`${record.product.source}|${record.product.productId}`),
      )
      .flatMap((record) => Object.values(record.product.conditions.prose ?? {}))
      .map(trimmed)
      // A source's sentence that would read as advice in Saoirse's mouth is left out.
      .filter((text) => text.length > 0 && adviceWordsIn(text).length === 0),
  )
  const quoted = [...prose].filter((text) => !lines.some((line) => line.includes(text)))
  for (const text of quoted.slice(0, 2)) lines.push(`in the source’s words: “${text}”`)
  return lines
}

/** "CCPC" or "Bank of Ireland’s own page". */
export function sourceOf(view: ProductView): string {
  return view.provenance.source === 'ccpc' ? 'CCPC' : `${view.providerName}’s own page`
}

function factsOf(market: Market, view: ProductView, term: number | null): LookupFact {
  return {
    id: view.id,
    provider: view.providerName,
    product: view.name,
    category: view.category,
    rate: rateOf(view, term),
    access: accessOf(view),
    conditions: conditionsOf(market, view),
    source: sourceOf(view),
    attribution: view.provenance.attribution,
    checkedOn: view.provenance.checkedAt.slice(0, 10),
    unknowns: view.unknowns.map((unknown) => unknown.meaning),
    confirmed: view.rateConfirmed,
  }
}

// -------------------------------------------------------------------------------------------
// For the model
// -------------------------------------------------------------------------------------------

/** How Saoirse is told to use what a lookup returns: the same words with every result. */
export const LOOKUP_ANSWER_RULE =
  'Answer from these facts, each with its source and the day it was checked. A figure listed ' +
  'here is held: never say you do not hold it. When they ask whether one is better than another, ' +
  'set the facts side by side (the rate, how long it holds, the access to the money, what is ' +
  'not stated) and leave the choice with them: it is a comparison, never a pick. Do not tell ' +
  'them to check with the provider or the bank; what is not stated is the fact to relay.'

/** The miss: nothing in the market under these words. */
export const LOOKUP_MISS_RULE =
  'Nothing in the market Saoi holds matches these words. Look it up again with other words (the ' +
  'provider alone, or the kind of product) before saying it is not held; if that finds nothing ' +
  'either, say plainly that Saoi does not hold that product, and give no figure for it.'

function factLines(fact: LookupFact, index: number): string[] {
  return [
    `${String(index + 1)}. ${fact.provider}, ${fact.product} (${fact.category.replaceAll('_', ' ')}; id ${fact.id})`,
    `   Rate: ${fact.rate}.`,
    `   Term or access: ${fact.access}.`,
    ...(fact.conditions.length === 0
      ? []
      : [`   Conditions as the source states them: ${fact.conditions.join('; ')}.`]),
    ...(fact.unknowns.length === 0 ? [] : [`   Not stated: ${fact.unknowns.join('; ')}.`]),
    `   Source: ${fact.source}${fact.attribution === null ? '' : ` (${fact.attribution})`}, checked ${shortDate(fact.checkedOn)}.`,
    `   Confirmed: ${
      fact.confirmed
        ? 'yes'
        : 'no, the rate rests on CCPC’s one figure and nothing is stated about what follows it'
    }.`,
  ]
}

/** The tool result: the facts, then the rule for answering from them. */
export function lookupResultText(outcome: LookupOutcome): string {
  const asked = `“${outcome.query}”${outcome.category === null ? '' : ` in ${outcome.category.replaceAll('_', ' ')}`}`
  if (outcome.matches.length === 0) {
    return `lookup_products found nothing for ${asked}. ${LOOKUP_MISS_RULE}`
  }
  const head =
    `lookup_products found ${String(outcome.matches.length + outcome.more)} product` +
    `${outcome.matches.length + outcome.more === 1 ? '' : 's'} for ${asked}` +
    (outcome.more > 0 ? `; the first ${String(outcome.matches.length)} are listed` : '') +
    '.'
  const notes = [
    ...(outcome.partial || outcome.unmatched.length > 0
      ? [
          `No product matches every word: ${outcome.unmatched.map((word) => `“${word}”`).join(', ')} matched none of these.`,
        ]
      : []),
    ...(outcome.termNotListed === null
      ? []
      : [`None of these lists a ${String(outcome.termNotListed)}-month term.`]),
    ...(outcome.more > 0 ? ['Narrow the words, or pass a category, for the rest.'] : []),
  ]
  return [head, ...notes, ...outcome.matches.flatMap(factLines), LOOKUP_ANSWER_RULE].join('\n')
}

// -------------------------------------------------------------------------------------------
// The market in one paragraph, for the prompt
// -------------------------------------------------------------------------------------------

export type MarketSummary = {
  readonly total: number
  readonly byCategory: readonly { readonly category: MarketCategory; readonly count: number }[]
  readonly byProvider: readonly { readonly name: string; readonly count: number }[]
  /** YYYY-MM-DD: the most recent day any figure was read. Null with no products. */
  readonly checkedOn: string | null
}

/** Counts by category and provider, and the day last checked: no figure. Pure. */
export function marketSummary(market: Market): MarketSummary {
  const byProvider = new Map<string, number>()
  for (const view of market.products) {
    byProvider.set(view.providerName, (byProvider.get(view.providerName) ?? 0) + 1)
  }
  return {
    total: market.products.length,
    byCategory: MARKET_CATEGORIES.map((category) => ({
      category,
      count: market.products.filter((view) => view.category === category).length,
    })).filter((entry) => entry.count > 0),
    byProvider: [...byProvider.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    checkedOn:
      market.products
        .map((view) => view.provenance.checkedAt.slice(0, 10))
        .sort()
        .at(-1) ?? null,
  }
}
