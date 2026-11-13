import {
  ADMIN_MARKET_CATEGORIES,
  type AdminMarketCategory,
  type AdminMarketView,
  type AdminMarketViews,
} from '../../contracts/market.ts'
import type { ProductView } from '../../contracts/market-tools.ts'
import { providerNameOf } from '../../market/provider-names.ts'
import type { MarketCategory } from '../../market/schema.ts'
import { euro } from './figures.ts'
import { rateLineOf } from './lookup.ts'
import { pct } from './product.ts'
import type { Market } from './types.ts'

/**
 * The admin's market screen (Chris, 2026-11-13: one entry per product, readable provider names,
 * a term to filter on): every view the engine builds, flattened for a list. The engine does the
 * folding (`normalise.ts`); this only words it. Pure: `asOf` is passed in.
 */

const CATEGORY: Readonly<Record<MarketCategory, { id: AdminMarketCategory; label: string }>> = {
  savings: { id: 'savings', label: 'Savings' },
  deposit: { id: 'deposits', label: 'Deposits' },
  mortgage: { id: 'mortgages', label: 'Mortgages' },
  loan: { id: 'loans', label: 'Loans' },
  credit_card: { id: 'credit_cards', label: 'Credit cards' },
  current_account: { id: 'current_accounts', label: 'Current accounts' },
}

/** A check older than this many whole days is stale, as the console has it. */
export const STALE_AFTER_DAYS = 8
const DAY_MS = 24 * 60 * 60 * 1000

const months = (count: number): string =>
  count % 12 === 0 && count >= 24
    ? `${String(count / 12)} years`
    : `${String(count)} month${count === 1 ? '' : 's'}`

/** "6 to 18 months", "6 months to 2 years". */
const spanOf = (low: number, high: number): string =>
  months(high).endsWith('months') && months(low).endsWith('months')
    ? `${String(low)} to ${months(high)}`
    : `${months(low)} to ${months(high)}`

export function adminMarketViews(market: Market, asOf: string): AdminMarketViews {
  const views = market.products
    .map((view) => adminViewOf(market, view, asOf))
    .sort(
      (a, b) =>
        ADMIN_MARKET_CATEGORIES.indexOf(a.category) - ADMIN_MARKET_CATEGORIES.indexOf(b.category) ||
        a.providerName.localeCompare(b.providerName) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
  return { asOf, views }
}

function adminViewOf(market: Market, view: ProductView, asOf: string): AdminMarketView {
  const providerName = providerNameOf(view.provider)
  const category = CATEGORY[view.category]
  const term = termOf(view)
  const days = Math.floor((Date.parse(asOf) - Date.parse(view.provenance.checkedAt)) / DAY_MS)
  return {
    id: view.id,
    provider: view.provider,
    providerName,
    category: category.id,
    categoryLabel: category.label,
    name: view.name,
    headline: headlineOf(view),
    termMonths: term.months,
    termLabel: term.label,
    ladder:
      view.terms.kind === 'deposit'
        ? view.terms.ladder.map((rung) => ({ months: rung.months, ratePct: rung.aerPct }))
        : [],
    access: accessOf(view),
    lines: [rateLineOf(view)],
    conditions: conditionsOf(view),
    unknown: view.unknowns.map((unknown) => unknown.meaning),
    checkedAt: view.provenance.checkedAt,
    lastChangedAt: view.provenance.lastChangedAt,
    stale: days > STALE_AFTER_DAYS,
    // The engine reads current rows only: a withdrawn product has no view.
    retired: false,
    sources: sourcesOf(market, view),
  }
}

function headlineOf(view: ProductView): AdminMarketView['headline'] {
  const terms = view.terms
  const none = { ratePct: null, label: '' }
  switch (terms.kind) {
    case 'deposit': {
      const rate = terms.aerPct ?? terms.ladder[0]?.aerPct ?? null
      return rate === null ? none : { ratePct: rate, label: `${pct(rate)} AER` }
    }
    case 'mortgage':
      return { ratePct: terms.initialRatePct, label: `${pct(terms.initialRatePct)} initial` }
    case 'loan':
      return { ratePct: terms.aprPct, label: `APR ${pct(terms.aprPct)}` }
    case 'credit_card':
      return terms.aprPct === null
        ? none
        : { ratePct: terms.aprPct, label: `APR ${pct(terms.aprPct)}` }
    case 'current_account':
      return terms.quarterlyFeeEur === null
        ? none
        : { ratePct: null, label: `${euro(terms.quarterlyFeeEur)} a quarter` }
  }
}

function termOf(view: ProductView): { months: number | null; label: string | null } {
  const terms = view.terms
  switch (terms.kind) {
    case 'deposit': {
      const first = terms.ladder[0]
      const last = terms.ladder.at(-1)
      if (first !== undefined && last !== undefined) {
        return {
          months: first.months,
          label: first === last ? months(first.months) : spanOf(first.months, last.months),
        }
      }
      if (terms.introductory !== null) {
        return { months: null, label: `fixed for ${months(terms.introductory.months)}` }
      }
      return { months: null, label: terms.basis }
    }
    case 'mortgage':
      if (terms.rateType === 'fixed' && terms.fixedYears !== null) {
        return { months: terms.fixedYears * 12, label: `${String(terms.fixedYears)}-year fixed` }
      }
      return { months: null, label: terms.rateType }
    case 'loan':
      if (terms.maxTermMonths !== null) {
        return { months: terms.maxTermMonths, label: `up to ${months(terms.maxTermMonths)}` }
      }
      return { months: null, label: terms.maxTermStated }
    case 'credit_card':
    case 'current_account':
      return { months: null, label: null }
  }
}

function accessOf(view: ProductView): string | null {
  const terms = view.terms
  if (terms.kind !== 'deposit') return null
  switch (terms.access) {
    case 'fixed_term':
      return 'Fixed term'
    case 'notice':
      return `${String(terms.noticeDays ?? 0)} days’ notice`
    case 'instant':
      return 'Instant access'
  }
}

function conditionsOf(view: ProductView): AdminMarketView['conditions'] {
  const out: AdminMarketView['conditions'] = []
  const add = (label: string, value: string | null) => {
    if (value !== null && value !== '') out.push({ label, value })
  }
  const range = (low: number | null, high: number | null): string | null =>
    low === null && high === null
      ? null
      : [low === null ? null : `from ${euro(low)}`, high === null ? null : `up to ${euro(high)}`]
          .filter((part) => part !== null)
          .join(' ')
  const terms = view.terms
  switch (terms.kind) {
    case 'deposit':
      add('Monthly saving', range(terms.minMonthlyEur, terms.maxMonthlyEur))
      add('Lump sum', range(terms.minLumpSumEur, terms.maxLumpSumEur))
      if (terms.lumpSumAerPct !== null) add('Rate on a lump sum', `${pct(terms.lumpSumAerPct)} AER`)
      if (terms.bonus !== null) {
        add('Bonus', `${euro(terms.bonus.amountEur)}: ${terms.bonus.conditions.join(' ')}`)
      }
      if (terms.rateForNewAccounts) add('Rate', 'for accounts opened now')
      if (terms.interestPaid !== null) add('Interest paid', terms.interestPaid.replaceAll('_', ' '))
      add('DIRT', terms.dirtApplies ? 'applies' : 'DIRT-free')
      break
    case 'mortgage':
      add(
        'Loan-to-value',
        terms.ltvMinPct === null && terms.ltvMaxPct === null
          ? null
          : `${terms.ltvMinPct === null ? 'up to' : `${String(terms.ltvMinPct)}% to`} ${String(terms.ltvMaxPct ?? 100)}%`,
      )
      add('BER', terms.ber)
      add('For', terms.buyerTypes.map((type) => type.replaceAll('_', ' ')).join(', '))
      if (terms.followOnRatePct !== null) add('Follow-on rate', pct(terms.followOnRatePct))
      add('Cashback', terms.cashback.stated)
      if (terms.minLoanEur !== null) add('Smallest loan', euro(terms.minLoanEur))
      for (const [label, value] of Object.entries(terms.fees)) add(label.replace(/:$/, ''), value)
      break
    case 'loan':
      if (terms.maxAmountEur !== null) add('Up to', euro(terms.maxAmountEur))
      add('Rate type', terms.rateType)
      add('Purposes', terms.purposes.join(', '))
      add('Set-up fees', terms.setupFees)
      break
    case 'credit_card':
      if (terms.purchaseRatePct !== null) add('Purchases', pct(terms.purchaseRatePct))
      if (terms.cashRatePct !== null) add('Cash', pct(terms.cashRatePct))
      if (terms.balanceTransfer !== null) {
        add(
          'Balance transfers',
          `${pct(terms.balanceTransfer.introPct)} for ${months(terms.balanceTransfer.introMonths)}`,
        )
      }
      break
    case 'current_account':
      if (terms.annualFeeEur !== null) add('Fees a year', euro(terms.annualFeeEur))
      if (terms.creditInterestPct !== null) add('Credit interest', pct(terms.creditInterestPct))
      if (terms.overdraft !== null) add('Overdraft', terms.overdraft ? 'yes' : 'no')
      break
  }
  const guarantee = view.depositGuarantee
  if (guarantee !== null && guarantee.scheme !== null) {
    add(
      'Deposit guarantee',
      `${guarantee.scheme}${guarantee.coverEur === null ? '' : `, ${euro(guarantee.coverEur)}`}`,
    )
  }
  if (view.platform !== null) add('Platform', view.platform.note)
  for (const check of view.checks) add('Check', check)
  add('Attribution', view.provenance.attribution)
  return out
}

function sourcesOf(market: Market, view: ProductView): AdminMarketView['sources'] {
  const current = (market.recordsOf.get(view.id) ?? []).filter(
    (record) => record.supersededAt === null,
  )
  const rows = [...view.provenance.rows, ...view.provenance.preferredOver]
  return rows.map((row) => {
    const record = current.find(
      (candidate) =>
        candidate.product.source === row.source && candidate.product.productId === row.productId,
    )
    return {
      source: row.source,
      rowId: `${view.provider}:${row.productId}`,
      url: record?.product.sourceUrl ?? null,
      checkedAt: record?.product.checkedAt ?? view.provenance.checkedAt,
    }
  })
}
