import type {
  AffordabilityRequest,
  AffordabilityResponse,
  SwitchRequest,
  SwitchResponse,
} from '../../contracts/market-tools.ts'
import { MORTGAGE_MEASURES } from '../../market/first-home-rules.ts'
import { attributionsOf, euro, oldestCheck } from './figures.ts'
import { DEFAULT_LIMIT, DEFAULT_MORTGAGE_TERM_YEARS, mortgageCandidates } from './search.ts'
import { annuityPayment, round2 } from './simulate.ts'
import type { Market } from './types.ts'

/**
 * What a deposit and an income allow under the Central Bank's mortgage measures, and what a
 * switch is worth against the market.
 *
 * The limits are the Central Bank of Ireland's, recorded with their source in
 * `market/first-home-rules.ts`: loan-to-income 4 times gross income for first-time buyers and
 * 3.5 for second and subsequent buyers; loan-to-value 90% for both. Lenders may go above them
 * for 15% of their lending (the allowances), which this does not assume.
 */

export const CENTRAL_BANK_LIMITS = {
  first_time_buyer: {
    loanToIncome: MORTGAGE_MEASURES.first_time_buyer.loanToIncome,
    maxLtvPct: MORTGAGE_MEASURES.first_time_buyer.maxLtvPct,
  },
  second_and_subsequent: {
    loanToIncome: MORTGAGE_MEASURES.second_and_subsequent.loanToIncome,
    maxLtvPct: MORTGAGE_MEASURES.second_and_subsequent.maxLtvPct,
  },
} as const

const LIMITS_SOURCE = `Central Bank of Ireland mortgage measures (${MORTGAGE_MEASURES.source.url}, checked ${MORTGAGE_MEASURES.source.checkedOn}).`
const ALLOWANCE = MORTGAGE_MEASURES.allowance

export function affordability(
  market: Market,
  request: AffordabilityRequest,
): AffordabilityResponse {
  const limits = CENTRAL_BANK_LIMITS[request.buyer]
  const termYears = request.termYears ?? DEFAULT_MORTGAGE_TERM_YEARS
  const maxLoanByIncome = request.annualGrossIncome * limits.loanToIncome
  const maxPriceByDeposit = request.deposit / (1 - limits.maxLtvPct / 100)
  const maxPrice = Math.min(maxPriceByDeposit, request.deposit + maxLoanByIncome)
  const bindingLimit = maxPriceByDeposit <= request.deposit + maxLoanByIncome ? 'deposit' : 'income'

  let forProperty: AffordabilityResponse['forProperty'] = null
  let loanAmount = maxPrice - request.deposit
  let propertyValue = maxPrice
  if (request.propertyValue !== undefined) {
    propertyValue = request.propertyValue
    const depositNeeded = request.propertyValue * (1 - limits.maxLtvPct / 100)
    const loanNeeded = Math.max(0, request.propertyValue - request.deposit)
    forProperty = {
      propertyValue: request.propertyValue,
      depositNeeded: round2(depositNeeded),
      depositShortfall: round2(Math.max(0, depositNeeded - request.deposit)),
      loanNeeded: round2(loanNeeded),
      withinIncomeLimit: loanNeeded <= maxLoanByIncome,
      ltvPct: round2((loanNeeded / request.propertyValue) * 100),
    }
    loanAmount = loanNeeded
  }
  const ltvPct = propertyValue > 0 ? (loanAmount / propertyValue) * 100 : 0

  const assumptions = [
    `Loan-to-income ${String(limits.loanToIncome)} times gross income; loan-to-value at most ${String(limits.maxLtvPct)}%. ${LIMITS_SOURCE}`,
    ALLOWANCE,
    'Lenders also assess whether the repayments are affordable; these are the regulatory limits only.',
    'The deposit is the savings given; Help to Buy, gifts and other sources count only if included.',
  ]
  const candidates = mortgageCandidates(
    market.products,
    {
      buyerType: request.buyer === 'first_time_buyer' ? 'first_time_buyer' : 'mover',
      loanAmount,
      propertyValue,
      termYears,
      ber: request.ber,
    },
    { add: () => undefined },
    assumptions,
  )
  const options = [...candidates.candidates]
    .sort(
      (a, b) =>
        (a.figures.kind === 'mortgage' ? (a.figures.totalCostAfterCashback ?? Infinity) : 0) -
        (b.figures.kind === 'mortgage' ? (b.figures.totalCostAfterCashback ?? Infinity) : 0),
    )
    .slice(0, request.limit ?? DEFAULT_LIMIT)
    .flatMap((candidate) =>
      candidate.figures.kind === 'mortgage'
        ? [{ product: candidate.product, figures: candidate.figures, flags: candidate.flags }]
        : [],
    )

  return {
    mode: 'affordability',
    limits: { ...limits, source: LIMITS_SOURCE, allowance: ALLOWANCE },
    maxLoanByIncome: round2(maxLoanByIncome),
    maxPriceByDeposit: round2(maxPriceByDeposit),
    maxPrice: round2(maxPrice),
    bindingLimit,
    forProperty,
    loanAmount: round2(loanAmount),
    ltvPct: round2(ltvPct),
    options,
    ranking: { objective: 'lowest_total_cost', basis: candidates.basis('lowest_total_cost') },
    assumptions,
    dataCheckedAt: oldestCheck(options.map((option) => option.product)),
    attributions: attributionsOf(options.map((option) => option.product)),
  }
}

export function switchMortgage(market: Market, request: SwitchRequest): SwitchResponse {
  const months = request.remainingTermYears * 12
  const currentMonthly = annuityPayment(request.balance, request.currentRatePct / 100 / 12, months)
  const currentTotal = currentMonthly * months
  const ltv =
    request.propertyValue === undefined ? null : (request.balance / request.propertyValue) * 100

  const assumptions = [
    'The current rate is assumed to hold for the rest of the term.',
    'Monthly saving: the current repayment less the new one at its initial rate, over the same remaining term.',
  ]
  if (request.switchingCostsEur === undefined) {
    assumptions.push(
      'No switching costs given: none are deducted. Legal and valuation fees are usually payable; each option lists its fees as the source states them.',
    )
  }
  const candidates = mortgageCandidates(
    market.products,
    {
      buyerType: 'switcher',
      loanAmount: request.balance,
      propertyValue: request.propertyValue,
      termYears: request.remainingTermYears,
      ber: request.ber,
    },
    { add: () => undefined },
    assumptions,
  )
  const costs = request.switchingCostsEur ?? 0

  const options = candidates.candidates
    .flatMap((candidate) => {
      const figures = candidate.figures
      if (figures.kind !== 'mortgage' || candidate.product.terms.kind !== 'mortgage') return []
      const monthlySaving = round2(currentMonthly - figures.monthlyRepayment)
      const cashback = figures.cashbackEur ?? 0
      const fixedMonths =
        candidate.product.terms.fixedYears === null
          ? null
          : Math.min(months, candidate.product.terms.fixedYears * 12)
      const net = costs - cashback
      const breakEvenMonths =
        net <= 0 ? 0 : monthlySaving <= 0 ? null : Math.ceil(net / monthlySaving)
      const flags = [...candidate.flags]
      if (request.currentFixedMonthsLeft !== undefined && request.currentFixedMonthsLeft > 0) {
        flags.push(
          `${String(request.currentFixedMonthsLeft)} months are left on the current fixed rate: leaving early can cost a break fee the data does not give. Ask the current lender.`,
        )
      }
      return [
        {
          product: candidate.product,
          figures,
          monthlySaving,
          savingOverFixedPeriod: fixedMonths === null ? null : round2(monthlySaving * fixedMonths),
          lifetimeSaving:
            figures.totalRepaid === null
              ? null
              : round2(currentTotal - figures.totalRepaid + cashback - costs),
          breakEvenMonths,
          flags,
        },
      ]
    })
    .sort((a, b) => (b.lifetimeSaving ?? -Infinity) - (a.lifetimeSaving ?? -Infinity))
    .slice(0, request.limit ?? DEFAULT_LIMIT)

  return {
    mode: 'switch',
    current: {
      ratePct: request.currentRatePct,
      monthlyRepayment: round2(currentMonthly),
      totalRemaining: round2(currentTotal),
    },
    ltvPct: ltv === null ? null : round2(ltv),
    options,
    ranking: {
      objective: 'lowest_total_cost',
      basis: `Largest saving over the remaining ${String(request.remainingTermYears)} years on ${euro(request.balance)} against ${String(request.currentRatePct)}% now, after cashback${request.switchingCostsEur === undefined ? '' : ` and ${euro(costs)} of switching costs`}, for the inputs given.`,
    },
    assumptions,
    dataCheckedAt: oldestCheck(options.map((option) => option.product)),
    attributions: attributionsOf(options.map((option) => option.product)),
  }
}
