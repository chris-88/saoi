import type {
  DepositTerms,
  Figures,
  Objective,
  ProductView,
  SavingsFigures,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '../../contracts/market-tools.ts'
import {
  attributionsOf,
  cardInterestOver12Months,
  euro,
  loanFigures,
  mortgageFigures,
  oldestCheck,
} from './figures.ts'
import { simulateDeposit } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * Search and rank: the products in one category that meet the filters, with the figures for the
 * caller's own amounts, ordered by an objective the caller chooses and the result names.
 *
 * Savings and deposits default to the highest interest after DIRT that can be known over the
 * horizon; debt to the lowest total cost. A product whose rate is known for only part of the
 * horizon counts only the known part, and says so, so an introductory rate that ends with
 * nothing stated after it does not outrank a rate that holds.
 */

export class MarketInputError extends Error {
  override readonly name = 'MarketInputError'
}

export const DEFAULT_LIMIT = 5
export const DEFAULT_HORIZON_MONTHS = 12
export const DEFAULT_MORTGAGE_TERM_YEARS = 30
export const DEFAULT_LOAN_TERM_MONTHS = 60

const OBJECTIVES_BY_CATEGORY = {
  savings: ['highest_net_return', 'easiest_access'],
  deposit: ['highest_net_return', 'easiest_access'],
  mortgage: ['lowest_total_cost', 'lowest_monthly_repayment'],
  loan: ['lowest_total_cost', 'lowest_monthly_repayment'],
  credit_card: ['lowest_total_cost'],
  current_account: ['lowest_total_cost'],
} as const satisfies Record<SearchRequest['category'], readonly Objective[]>

const LOAN_PURPOSE_LABELS: Readonly<Record<NonNullable<SearchRequest['purpose']>, string>> = {
  personal: 'Personal loans',
  car: 'Car loans',
  home_improvement: 'Home improvements',
  energy_upgrade: 'Home energy upgrade loans (SCBI)',
  holiday: 'Holiday loans',
  student: 'Student loans',
}

const NOT_FOR_ADULT_SAVING = /child|kid|junior|teen|student|third level/i

type Candidate = {
  readonly product: ProductView
  readonly figures: Figures
  readonly flags: string[]
}

class Exclusions {
  private readonly counts = new Map<string, number>()
  add(reason: string) {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1)
  }
  list() {
    return [...this.counts].map(([reason, count]) => ({ reason, count }))
  }
}

export function objectiveFor(request: SearchRequest): Objective {
  const allowed: readonly Objective[] = OBJECTIVES_BY_CATEGORY[request.category]
  const objective = request.objective ?? allowed[0]
  if (objective === undefined || !allowed.includes(objective)) {
    throw new MarketInputError(
      `Objective ${String(request.objective)} does not apply to ${request.category}; use one of ${allowed.join(', ')}.`,
    )
  }
  return objective
}

export function search(market: Market, request: SearchRequest, asOf: AsOf): SearchResponse {
  const objective = objectiveFor(request)
  const excluded = new Exclusions()
  const assumptions: string[] = []
  const inCategory = market.products.filter((product) => {
    if (product.category !== request.category) return false
    if (request.providers !== undefined && !request.providers.includes(product.provider)) {
      excluded.add('Not one of the providers asked for')
      return false
    }
    return true
  })

  let candidates: Candidate[]
  let basis: string
  switch (request.category) {
    case 'savings':
    case 'deposit': {
      const result = savingsCandidates(inCategory, request, asOf, excluded, assumptions)
      candidates = result.candidates
      basis = result.basis(objective)
      break
    }
    case 'mortgage': {
      const result = mortgageCandidates(inCategory, request, excluded, assumptions)
      candidates = result.candidates
      basis = result.basis(objective)
      break
    }
    case 'loan': {
      const result = loanCandidates(inCategory, request, excluded, assumptions)
      candidates = result.candidates
      basis = result.basis(objective)
      break
    }
    case 'credit_card': {
      const balance = request.amount ?? 2_000
      if (request.amount === undefined)
        assumptions.push('No balance given: figures are for €2,000.')
      candidates = inCategory.flatMap((product): Candidate[] =>
        product.terms.kind === 'credit_card'
          ? [
              {
                product,
                figures: {
                  kind: 'credit_card',
                  balance,
                  interestOver12Months: cardInterestOver12Months(product.terms, balance),
                },
                flags: flagsOf(product),
              },
            ]
          : [],
      )
      assumptions.push(
        'Interest on the balance held for twelve months with nothing repaid: the balance-transfer rate for its introductory months, the purchase rate after. Fees and the APR’s charges are not added.',
      )
      basis = `Lowest interest over twelve months on a ${euro(balance)} balance.`
      break
    }
    case 'current_account':
      candidates = inCategory.flatMap((product): Candidate[] =>
        product.terms.kind === 'current_account'
          ? [
              {
                product,
                figures: { kind: 'current_account', annualFeeEur: product.terms.annualFeeEur },
                flags: flagsOf(product),
              },
            ]
          : [],
      )
      assumptions.push(
        'Fees are the quarterly maintenance fee as CCPC states it, times four. Transaction charges are not counted.',
      )
      basis = 'Lowest yearly maintenance fee.'
      break
  }

  const ranked = [...candidates].sort(comparator(objective))
  const limit = request.limit ?? DEFAULT_LIMIT
  const shown = ranked.slice(0, limit)
  const results: SearchResult[] = shown.map((candidate, index) => ({
    rank: index + 1,
    product: candidate.product,
    figures: candidate.figures,
    flags: candidate.flags,
  }))

  return {
    ranking: { objective, basis },
    results,
    matched: candidates.length,
    excluded: excluded.list(),
    assumptions,
    dataCheckedAt: oldestCheck(shown.map((candidate) => candidate.product)),
    attributions: attributionsOf(shown.map((candidate) => candidate.product)),
  }
}

// -------------------------------------------------------------------------------------------
// Savings and deposits
// -------------------------------------------------------------------------------------------

export const SAVINGS_ASSUMPTIONS: readonly string[] = [
  'DIRT at 33% is deducted from interest, except on products the source marks DIRT-free.',
  'Interest accrues monthly at a twelfth of the AER and is credited every twelve months and at the end.',
  'Variable rates are assumed to stay as published today; they can change.',
  'Bonuses are not counted as interest.',
]

export function savingsCandidates(
  products: readonly ProductView[],
  request: Pick<
    SearchRequest,
    | 'category'
    | 'amount'
    | 'monthlyAmount'
    | 'horizonMonths'
    | 'access'
    | 'maxNoticeDays'
    | 'includePlatforms'
  >,
  asOf: AsOf,
  excluded: { add(reason: string): void },
  assumptions: string[],
) {
  const horizon = request.horizonMonths ?? DEFAULT_HORIZON_MONTHS
  if (request.horizonMonths === undefined) {
    assumptions.push(`No horizon given: figures run ${String(DEFAULT_HORIZON_MONTHS)} months.`)
  }
  let lumpSum = request.amount ?? 0
  let monthly = request.monthlyAmount ?? 0
  if (lumpSum === 0 && monthly === 0) {
    if (request.category === 'savings') monthly = 500
    else lumpSum = 10_000
    assumptions.push(
      `No amount given: figures are for ${request.category === 'savings' ? '€500 a month' : 'a €10,000 lump sum'}.`,
    )
  }
  assumptions.push(...SAVINGS_ASSUMPTIONS)

  const candidates = products.flatMap((product): Candidate[] => {
    const terms = product.terms
    if (terms.kind !== 'deposit') return []
    if (NOT_FOR_ADULT_SAVING.test(product.name)) {
      excluded.add('For children or students, by its name')
      return []
    }
    if (request.includePlatforms === false && product.platform !== null) {
      excluded.add('Opened through a deposit platform (Raisin), and platforms were left out')
      return []
    }
    if (
      request.access !== undefined &&
      request.access !== 'any' &&
      terms.access !== request.access
    ) {
      excluded.add(`Not ${request.access.replace('_', ' ')} access`)
      return []
    }
    if (
      request.maxNoticeDays !== undefined &&
      terms.access === 'notice' &&
      (terms.noticeDays ?? 0) > request.maxNoticeDays
    ) {
      excluded.add(`Notice longer than ${String(request.maxNoticeDays)} days`)
      return []
    }
    if (terms.access === 'fixed_term' && !terms.ladder.some((rung) => rung.months <= horizon)) {
      excluded.add(`Every term ends after the ${String(horizon)}-month horizon`)
      return []
    }
    const simulation = simulateDeposit(terms, { lumpSum, monthly, horizonMonths: horizon, asOf })
    const figures = simulation.figures
    if (figures.paidIn === 0) {
      excluded.add(cannotTakeReason(terms, lumpSum, monthly))
      return []
    }
    return [{ product, figures, flags: savingsFlags(product, figures) }]
  })

  const amounts = [
    ...(lumpSum > 0 ? [`a ${euro(lumpSum)} lump sum`] : []),
    ...(monthly > 0 ? [`${euro(monthly)} a month`] : []),
  ].join(' and ')

  return {
    candidates,
    basis: (objective: Objective) =>
      objective === 'easiest_access'
        ? `Easiest access first (instant, then shortest notice, then shortest term), then highest interest after DIRT over ${String(horizon)} months on ${amounts}.`
        : `Highest interest after DIRT that can be known over ${String(horizon)} months on ${amounts}, for the inputs given. Where a rate is known for fewer months, only those months count, and the result says so. Bonuses are not counted.`,
  }
}

function cannotTakeReason(terms: DepositTerms, lumpSum: number, monthly: number): string {
  if (lumpSum > 0 && terms.takesLumpSum === null && monthly === 0) {
    return 'Not known whether it takes a lump sum'
  }
  if (monthly > 0 && terms.takesMonthly === null && lumpSum === 0) {
    return 'Not known whether it takes monthly saving'
  }
  if (
    lumpSum > 0 &&
    terms.minLumpSumEur !== null &&
    lumpSum < terms.minLumpSumEur &&
    monthly === 0
  ) {
    return 'The amount is below its minimum'
  }
  return 'Does not take this kind of money (a lump sum, or monthly saving)'
}

function savingsFlags(product: ProductView, figures: SavingsFigures): string[] {
  const terms = product.terms
  const flags: string[] = []
  if (product.platform !== null) flags.push(product.platform.note)
  if (product.depositGuarantee !== null && product.depositGuarantee.country !== 'Ireland') {
    flags.push(
      product.depositGuarantee.scheme === null
        ? 'Which deposit guarantee scheme covers it is not stated.'
        : `Protected by the ${product.depositGuarantee.scheme}${product.depositGuarantee.coverEur === null ? '' : ` up to ${euro(product.depositGuarantee.coverEur)}`}, not the Irish scheme.`,
    )
  }
  if (figures.stop !== null) flags.push(figures.stop.reason)
  if (figures.notPlaced.monthly > 0) {
    flags.push(
      `${euro(figures.notPlaced.monthly)} a month is above what it takes and is not counted.`,
    )
  }
  if (figures.notPlaced.lumpSum > 0) {
    flags.push(
      `${euro(figures.notPlaced.lumpSum)} of the lump sum is not placed here (it does not take it, or it is above the maximum).`,
    )
  }
  if (terms.kind === 'deposit') {
    if (terms.basis === 'variable') flags.push('Variable rate: it can change.')
    if (!terms.dirtApplies) flags.push('DIRT-free.')
    if (terms.bonus !== null) {
      flags.push(
        `A conditional ${euro(terms.bonus.amountEur)} bonus, not counted: ${terms.bonus.conditions.join(' ')}`,
      )
    }
  }
  return [...flags, ...flagsOf(product)]
}

/** Unknowns and eligibility, for any product. */
export function flagsOf(product: ProductView): string[] {
  return [
    ...product.unknowns.map((unknown) => `Not stated by the source: ${unknown.meaning}.`),
    ...product.checks,
  ]
}

// -------------------------------------------------------------------------------------------
// Mortgages
// -------------------------------------------------------------------------------------------

/** A BER asked for matches a rate for that band (`B` covers B1 to B3) or for any BER. */
export function berMatches(rateBer: string | null, asked: string): boolean {
  if (rateBer === null) return true
  const rate = rateBer.toUpperCase()
  const mine = asked.toUpperCase()
  return mine === rate || (rate.length === 1 && mine.startsWith(rate))
}

export function mortgageCandidates(
  products: readonly ProductView[],
  request: Pick<SearchRequest, 'buyerType' | 'loanAmount' | 'propertyValue' | 'termYears' | 'ber'>,
  excluded: { add(reason: string): void },
  assumptions: string[],
) {
  const buyerType = request.buyerType ?? 'first_time_buyer'
  const termYears = request.termYears ?? DEFAULT_MORTGAGE_TERM_YEARS
  if (request.termYears === undefined) assumptions.push('No term given: a 30-year term.')
  if (request.buyerType === undefined)
    assumptions.push('No buyer type given: first-time buyer rates.')

  let loanAmount = request.loanAmount
  if (loanAmount === undefined && request.propertyValue !== undefined) {
    loanAmount = request.propertyValue * 0.9
    assumptions.push('No loan amount given: 90% of the property value.')
  }
  if (loanAmount === undefined) {
    loanAmount = 300_000
    assumptions.push('No loan amount given: figures are for €300,000.')
  }
  const ltv =
    request.propertyValue !== undefined && request.propertyValue > 0
      ? (loanAmount / request.propertyValue) * 100
      : null
  if (ltv === null) {
    assumptions.push(
      'No property value given, so the loan-to-value is not known: rates for every LTV band are shown and each says its band.',
    )
  }
  assumptions.push(
    'Repayments at the initial rate for the fixed period, then the provider’s stated follow-on rate for the rest of the term (it is a “potential” rate and can change). Variable rates are assumed to stay as published.',
    'Cashback is counted where CCPC states a percentage. Fees are listed as the source states them and not added.',
  )

  const candidates = products.flatMap((product): Candidate[] => {
    const terms = product.terms
    if (terms.kind !== 'mortgage') return []
    if (!terms.buyerTypes.includes(buyerType)) {
      excluded.add(`Not on the ${buyerType.replace(/_/g, ' ')} list`)
      return []
    }
    if (
      ltv !== null &&
      ((terms.ltvMinPct ?? 0) > ltv + 1e-9 || (terms.ltvMaxPct ?? 100) < ltv - 1e-9)
    ) {
      excluded.add('For a different loan-to-value band')
      return []
    }
    if (terms.ber !== null) {
      if (request.ber === undefined) {
        excluded.add('A rate for a particular BER; give the BER to include these')
        return []
      }
      if (!berMatches(terms.ber, request.ber)) {
        excluded.add('For a different BER')
        return []
      }
    }
    const figures = mortgageFigures(terms, loanAmount, termYears, ltv)
    const flags: string[] = []
    if (ltv === null) {
      flags.push(
        `For a loan-to-value of ${String(terms.ltvMinPct ?? 0)}% to ${String(terms.ltvMaxPct ?? 100)}%.`,
      )
    }
    if (figures.totalRepaid === null) {
      flags.push('No follow-on rate is stated, so there is no whole-term figure.')
    }
    if (terms.cashback.offered === true && terms.cashback.pct === null) {
      flags.push(
        `Cashback offered but no percentage stated${terms.cashback.stated === null ? '' : `: “${terms.cashback.stated}”`}.`,
      )
    }
    if (terms.cashback.pct !== null && terms.cashback.stated !== null) {
      flags.push(`Cashback as stated: “${terms.cashback.stated}”.`)
    }
    return [{ product, figures, flags: [...flags, ...flagsOf(product)] }]
  })

  return {
    candidates,
    basis: (objective: Objective) =>
      objective === 'lowest_monthly_repayment'
        ? `Lowest monthly repayment at the initial rate on ${euro(loanAmount)} over ${String(termYears)} years.`
        : `Lowest total cost over ${String(termYears)} years on ${euro(loanAmount)}: interest at the initial rate for the fixed period and the stated follow-on rate after, less any stated cashback. Rates with no whole-term figure come last.`,
  }
}

// -------------------------------------------------------------------------------------------
// Loans
// -------------------------------------------------------------------------------------------

export function loanCandidates(
  products: readonly ProductView[],
  request: Pick<SearchRequest, 'amount' | 'termMonths' | 'purpose'>,
  excluded: { add(reason: string): void },
  assumptions: string[],
) {
  const amount = request.amount ?? 10_000
  const termMonths = request.termMonths ?? DEFAULT_LOAN_TERM_MONTHS
  if (request.amount === undefined) assumptions.push('No amount given: figures are for €10,000.')
  if (request.termMonths === undefined) assumptions.push('No term given: 60 months.')
  assumptions.push(
    'Repayments from the APR as an effective annual rate, level each month. Set-up fees are listed, not added.',
  )
  const purpose = request.purpose === undefined ? null : LOAN_PURPOSE_LABELS[request.purpose]

  const candidates = products.flatMap((product): Candidate[] => {
    const terms = product.terms
    if (terms.kind !== 'loan') return []
    if (purpose !== null && !terms.purposes.includes(purpose)) {
      excluded.add('Not offered for this purpose')
      return []
    }
    if (
      purpose !== 'Student loans' &&
      terms.purposes.length > 0 &&
      terms.purposes.every((p) => p === 'Student loans')
    ) {
      excluded.add('A student loan')
      return []
    }
    if (terms.maxAmountEur !== null && amount > terms.maxAmountEur) {
      excluded.add('The amount is above its maximum')
      return []
    }
    if (terms.maxTermMonths !== null && termMonths > terms.maxTermMonths) {
      excluded.add('The term is longer than it allows')
      return []
    }
    const flags: string[] = []
    if (terms.maxTermMonths === null) {
      flags.push(
        `The longest term is not known${terms.maxTermStated === null ? '' : ` (CCPC: “${terms.maxTermStated}”)`}; check ${String(termMonths)} months is allowed.`,
      )
    }
    if (terms.setupFees !== null) flags.push(`Set-up fees: ${terms.setupFees}.`)
    if (terms.rateType === 'variable') flags.push('Variable rate: it can change.')
    return [
      {
        product,
        figures: loanFigures(terms.aprPct, amount, termMonths),
        flags: [...flags, ...flagsOf(product)],
      },
    ]
  })

  return {
    candidates,
    basis: (objective: Objective) =>
      objective === 'lowest_monthly_repayment'
        ? `Lowest monthly repayment on ${euro(amount)} over ${String(termMonths)} months.`
        : `Lowest total interest on ${euro(amount)} over ${String(termMonths)} months.`,
  }
}

// -------------------------------------------------------------------------------------------
// Ordering
// -------------------------------------------------------------------------------------------

const ACCESS_ORDER = { instant: 0, notice: 1, fixed_term: 2 } as const

/** A figure to minimise, nulls last. */
function costOf(figures: Figures, objective: Objective): number | null {
  switch (figures.kind) {
    case 'mortgage':
      return objective === 'lowest_monthly_repayment'
        ? figures.monthlyRepayment
        : figures.totalCostAfterCashback
    case 'loan':
      return objective === 'lowest_monthly_repayment'
        ? figures.monthlyRepayment
        : figures.totalInterest
    case 'credit_card':
      return figures.interestOver12Months
    case 'current_account':
      return figures.annualFeeEur
    case 'savings':
      return -figures.netInterest
  }
}

function accessRank(product: ProductView): number {
  const terms = product.terms
  if (terms.kind !== 'deposit') return 0
  const days =
    terms.access === 'fixed_term' ? (terms.ladder[0]?.months ?? 0) * 30 : (terms.noticeDays ?? 0)
  return ACCESS_ORDER[terms.access] * 100_000 + days
}

function comparator(objective: Objective) {
  return (a: Candidate, b: Candidate): number => {
    if (objective === 'easiest_access') {
      const access = accessRank(a.product) - accessRank(b.product)
      if (access !== 0) return access
    }
    const x = costOf(a.figures, objective)
    const y = costOf(b.figures, objective)
    if (x === null && y === null) return a.product.id.localeCompare(b.product.id)
    if (x === null) return 1
    if (y === null) return -1
    return x - y || a.product.id.localeCompare(b.product.id)
  }
}
