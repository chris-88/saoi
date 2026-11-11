import type {
  HomeCalculatorRequest,
  HomeCalculatorResponse,
  HomeMarket,
  ProductView,
} from '../../contracts/market-tools.ts'
import { accountOf, allocatable } from './allocate.ts'
import { euro } from './figures.ts'
import { monthName } from './home-arithmetic.ts'
import { homePathways, TERM_YEARS } from './pathways.ts'
import { NO_DATE_HORIZON } from './plan.ts'
import { pct } from './product.ts'
import { addMonths, bestRung, monthsUntil, placement, round2, simulateDeposit } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * The market beside the home calculator's figures (decision 2026-11-10: comparison, not advice).
 * claude.ai's card cannot call a second tool, so the calculator's one response carries the
 * savings and mortgage tiles: the top savings rate for money that can be reached by the date and
 * the interest it would earn, and how many mortgages fit the loan with their monthly range.
 *
 * Nothing new is decided here. Savings eligibility is the plan engine's (`allocatable`: adult
 * saving, nothing locked past the date or without one) with each product's own limits
 * (`placement`); the interest is the engine's month-by-month projection (`simulateDeposit`,
 * after DIRT); the mortgages are `homePathways` with no customer preferences, as build-plan
 * lists them without filters. No product or lender is picked, and the basis is stated.
 */

type Figures = HomeCalculatorResponse['figures']

/** A deposit product's rate for a horizon: the longest term that ends by it, or the headline. */
function rateFor(product: ProductView, horizonMonths: number): number | null {
  const terms = product.terms
  if (terms.kind !== 'deposit') return null
  if (terms.access === 'fixed_term') return bestRung(terms.ladder, horizonMonths)?.aerPct ?? null
  const banded = terms.bands.map((band) => band.aerPct)
  return terms.aerPct ?? (banded.length === 0 ? null : Math.max(...banded))
}

function savingsSummary(
  market: Market,
  request: HomeCalculatorRequest,
  figures: Figures,
  asOf: AsOf,
): HomeMarket['savings'] {
  const saved = request.depositSavedEur ?? 0
  const monthly = request.monthlySavingEur ?? 0
  const dated = request.targetDate?.slice(0, 7) ?? figures.depositReachedOn
  const by = dated ?? addMonths(asOf, NO_DATE_HORIZON)
  const horizon = dated === null ? NO_DATE_HORIZON : monthsUntil(asOf, by)

  // The plan engine's pool, then each product's own limits: it takes the whole deposit saved or
  // the whole monthly amount (a regular saver within its monthly cap).
  const pool = allocatable(market.products, { horizonMonths: horizon, lockAllowed: dated !== null })
  const fits = pool.flatMap((product) => {
    if (product.terms.kind !== 'deposit') return []
    const rate = rateFor(product, horizon)
    if (rate === null) return []
    const placed = placement(product.terms, saved, monthly)
    const takes =
      (saved === 0 && monthly === 0) ||
      (saved > 0 && placed.lump >= saved - 0.005) ||
      (monthly > 0 && placed.monthly >= monthly - 0.005)
    return takes ? [{ product, terms: product.terms, rate, placed }] : []
  })
  if (fits.length === 0) return null
  const accounts = new Set(fits.map((item) => accountOf(item.product))).size

  // The highest rate; where two pay it, the one that takes more of the money.
  const top = [...fits].sort(
    (a, b) =>
      b.rate - a.rate ||
      b.placed.lump + b.placed.monthly * horizon - (a.placed.lump + a.placed.monthly * horizon),
  )[0]
  if (top === undefined) return null
  const simulation = simulateDeposit(top.terms, {
    lumpSum: saved,
    monthly,
    horizonMonths: horizon,
    asOf,
  })
  const result = simulation.figures
  const until =
    dated === null
      ? `over the next ${String(NO_DATE_HORIZON)} months, as no date is known`
      : `by ${monthName(by)}`
  const notes = [
    top.terms.dirtApplies ? 'interest after DIRT' : 'interest DIRT-free (a State Savings product)',
    ...(result.notPlaced.lumpSum > 0 || result.notPlaced.monthly > 0
      ? [
          `${euro(result.notPlaced.lumpSum)} of the deposit and ${euro(result.notPlaced.monthly)} a month are above what that account takes and are not counted`,
        ]
      : []),
    ...(result.stop === null
      ? []
      : [
          `the interest stops at month ${String(result.stop.afterMonths)}, as the rate after that is not known`,
        ]),
    'no product is picked',
  ]
  return {
    topRatePct: top.rate,
    topRateProvider: top.product.providerName,
    accounts,
    interestToTargetEur: round2(result.netInterest),
    by,
    basis: `The highest rate on the market for money that can be reached ${until}, among ${String(accounts)} account${accounts === 1 ? '' : 's'} that take this saving; ${notes.join('; ')}.`,
  }
}

function mortgageSummary(
  market: Market,
  request: HomeCalculatorRequest,
  figures: Figures,
  asOf: AsOf,
): HomeMarket['mortgage'] {
  if (figures.priceEur === null) return null
  const reachedOn = figures.depositReachedOn
  const home = homePathways({
    market,
    firstTimeBuyer: request.firstTimeBuyer ?? true,
    firstTimeBuyerStated: request.firstTimeBuyer !== undefined,
    newBuild: request.propertyKind === 'new_build' || request.propertyKind === 'self_build',
    annualGrossIncome: figures.incomeEur ?? undefined,
    homePrice: figures.priceEur,
    taxPaid: request.taxPaidLastFourYearsEur,
    // Unused with a price given: the price is not worked back from the savings.
    savedByGoal: figures.neededAtKeysEur ?? 0,
    goalDate: request.targetDate?.slice(0, 7) ?? reachedOn ?? addMonths(asOf, NO_DATE_HORIZON),
    reachedOn: () => reachedOn,
    monthlySaving: request.monthlySavingEur ?? 0,
    monthName,
    savers: [],
  })
  if (home === null || home.pathways.length === 0) return null
  const monthlies = home.pathways.map((pathway) => pathway.mortgage.monthlyRepayment)
  return {
    loanEur: home.loan,
    options: home.pathways.length,
    lowestRatePct: Math.min(...home.pathways.map((pathway) => pathway.mortgage.ratePct)),
    lowestMonthlyEur: round2(Math.min(...monthlies)),
    highestMonthlyEur: round2(Math.max(...monthlies)),
    termYears: TERM_YEARS,
    basis: `Every lender’s mortgages that fit ${euro(home.loan)} at ${String(home.ltvPct)}% of the price over ${String(TERM_YEARS)} years for ${request.firstTimeBuyer === false ? 'a second or later buyer' : 'a first-time buyer'}, fixed and variable, one per lender, rate type and fixed period; the monthly repayment at each one’s initial rate; no lender is picked.`,
  }
}

/**
 * The savings and mortgage market for the calculator's figures, or null when there is no
 * market data. Facts only: the top rate and its interest, the count of options and their
 * monthly range, each with its basis.
 */
export function homeMarketSummary(
  market: Market,
  request: HomeCalculatorRequest,
  figures: Figures,
  asOf: AsOf,
): HomeMarket | null {
  if (market.products.length === 0) return null
  const savings = savingsSummary(market, request, figures, asOf)
  const mortgage = mortgageSummary(market, request, figures, asOf)
  const lines: string[] = []
  if (savings !== null) {
    const interest =
      savings.interestToTargetEur > 0
        ? `, about ${euro(Math.round(savings.interestToTargetEur))} interest ${savings.basis.includes('DIRT-free') ? 'DIRT-free' : 'after DIRT'} by ${monthName(savings.by)} in that account`
        : ''
    lines.push(
      `Savings: the top rate on the market is ${pct(savings.topRatePct)} (${savings.topRateProvider})${interest}; ${String(savings.accounts)} account${savings.accounts === 1 ? ' fits' : 's fit'}.`,
    )
  }
  if (mortgage !== null) {
    const low = euro(Math.round(mortgage.lowestMonthlyEur))
    const high = euro(Math.round(mortgage.highestMonthlyEur))
    lines.push(
      `Mortgages: ${String(mortgage.options)} fit${mortgage.options === 1 ? 's' : ''} ${euro(mortgage.loanEur)} over ${String(mortgage.termYears)} years, ${low === high ? `at ${low}` : `from ${low} to ${high}`} a month.`,
    )
  }
  return { savings, mortgage, lines }
}
