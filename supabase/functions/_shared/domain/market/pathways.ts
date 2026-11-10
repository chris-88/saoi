import type { HomePathways, MortgageTerms, ProductView } from '../../contracts/market-tools.ts'
import { HELP_TO_BUY, MORTGAGE_MEASURES } from '../../market/first-home-rules.ts'
import { BUYING_COSTS, CASHBACK, LINKED_SAVERS } from '../../market/mortgage-incentives.ts'
import { balanceAfter, euro, mortgageFigures } from './figures.ts'
import { berMatches } from './search.ts'
import { DIRT_RATE, round2 } from './simulate.ts'
import type { Market } from './types.ts'

/**
 * Pathways to a home (Chris, 2026-11-10): the goal compared end to end per lender, not product
 * by product. Each pathway is the savings path to the keys, Help to Buy where it applies, that
 * lender's mortgage at the resulting loan-to-value over 30 years, its cashback, and any savings
 * bonus tied to its mortgage. They are compared on two axes, side by side: the month the keys
 * are in reach, and the cost of the home over the same period for every lender.
 *
 * Every assumption is stated and correctable. Only figures from the data are used: an incentive
 * not in `market/mortgage-incentives.ts` or the lender's own CCPC row is not invented.
 */

export const TERM_YEARS = 30
const MAX_PATHWAYS = 6

export type PathwayInput = {
  readonly market: Market
  readonly firstTimeBuyer: boolean
  /** True when the customer said so; false when inferred from no home being mentioned. */
  readonly firstTimeBuyerStated: boolean
  readonly newBuild: boolean
  readonly annualGrossIncome: number | undefined
  readonly homePrice: number | undefined
  readonly taxPaid: number | undefined
  /** What the savings path holds towards the goal at its date, after DIRT. */
  readonly savedByGoal: number
  readonly goalDate: string
  /** The month the savings path reaches an amount, or null within the figures. */
  readonly reachedOn: (amount: number) => string | null
  readonly monthlySaving: number
  readonly monthName: (yyyyMm: string) => string
}

type Candidate = {
  readonly product: ProductView
  readonly terms: MortgageTerms
  readonly interest: number
  readonly cashback: number
  readonly cashbackNow: number
  readonly cashbackLater: number
  readonly monthly: number
}

/** Help to Buy at a price, for a first-time buyer's new build: up to the cap, or the tax given. */
function helpToBuyAt(price: number, input: PathwayInput): number {
  if (!input.firstTimeBuyer || !input.newBuild || price > HELP_TO_BUY.maxPriceEur) return 0
  return round2(
    Math.min(price * HELP_TO_BUY.shareOfPrice, HELP_TO_BUY.capEur, input.taxPaid ?? Infinity),
  )
}

const cashOnTop = (price: number): number =>
  (price * BUYING_COSTS.stampDutyPct) / 100 + BUYING_COSTS.legalAndSurveyEur

export function homePathways(input: PathwayInput): HomePathways | null {
  const measures = input.firstTimeBuyer
    ? MORTGAGE_MEASURES.first_time_buyer
    : MORTGAGE_MEASURES.second_and_subsequent
  const ltv = measures.maxLtvPct / 100
  const maxLoan =
    input.annualGrossIncome === undefined ? null : input.annualGrossIncome * measures.loanToIncome

  // ---- The price: given, or what the savings reach by the date supports ---------------------
  let price: number
  let bindingLimit: HomePathways['bindingLimit']
  if (input.homePrice !== undefined) {
    price = input.homePrice
    bindingLimit = 'price_given'
  } else {
    // Cash at the keys: the deposit plus stamp duty and fees, less Help to Buy.
    let p = Math.max(0, (input.savedByGoal - BUYING_COSTS.legalAndSurveyEur) / 0.11)
    bindingLimit = maxLoan === null ? 'income_not_given' : 'deposit'
    for (let i = 0; i < 60; i += 1) {
      const deposit = input.savedByGoal - cashOnTop(p) + helpToBuyAt(p, input)
      const byDeposit = deposit / (1 - ltv)
      const byIncome = maxLoan === null ? Infinity : deposit + maxLoan
      const next = Math.max(0, Math.min(byDeposit, byIncome))
      if (maxLoan !== null) bindingLimit = byIncome < byDeposit ? 'income' : 'deposit'
      if (Math.abs(next - p) < 0.5) {
        p = next
        break
      }
      p = next
    }
    price = Math.floor(p / 1_000) * 1_000
  }
  if (price <= 0) return null

  const helpToBuy = helpToBuyAt(price, input)
  const loanCap = Math.min(price * ltv, maxLoan ?? Infinity)
  const deposit = round2(price - loanCap)
  const loan = round2(price - deposit)
  const stampDuty = round2((price * BUYING_COSTS.stampDutyPct) / 100)
  const needed = round2(
    Math.max(0, deposit + stampDuty + BUYING_COSTS.legalAndSurveyEur - helpToBuy),
  )
  const reached = input.reachedOn(needed)
  // Priced from the savings by the goal's date, the keys are in reach by then by construction;
  // the projection used for the month can run a few euro short of the plan's own figure.
  const keysOn =
    input.homePrice === undefined && (reached === null || reached > input.goalDate)
      ? input.goalDate
      : reached
  const ltvPct = round2((loan / price) * 100)

  // ---- Each lender's mortgages at that loan-to-value -----------------------------------------
  const buyer = input.firstTimeBuyer ? 'first_time_buyer' : 'mover'
  const assumedBer = input.newBuild ? 'A1' : 'C1'
  const isGreen = (product: ProductView): boolean => /green|eco/i.test(product.name)
  const eligible = input.market.products.flatMap((product) => {
    const terms = product.terms
    if (terms.kind !== 'mortgage') return []
    if (!terms.buyerTypes.includes(buyer)) return []
    if ((terms.ltvMinPct ?? 0) > ltvPct + 1e-9 || (terms.ltvMaxPct ?? 100) < ltvPct - 1e-9)
      return []
    if (terms.highValue || /higher value/i.test(product.name)) return []
    // A new build is taken as BER A: green rates apply. Otherwise standard rates only, and where
    // a lender prices by BER, a BER C is assumed (stated, correctable).
    if (isGreen(product) && !input.newBuild) return []
    if (terms.ber !== null && !berMatches(terms.ber, assumedBer)) return []
    return [{ product, terms }]
  })
  const fixedYearsOf = (terms: MortgageTerms): number | null =>
    terms.rateType === 'fixed' ? terms.fixedYears : null

  // Like for like: over the term where every lender has a known follow-on rate, otherwise over
  // the fixed period most lenders offer at this loan-to-value.
  const lenders = [...new Set(eligible.map((item) => item.product.provider))]
  const termKnown = lenders.every((lender) =>
    eligible.some(
      (item) =>
        item.product.provider === lender &&
        mortgageFigures(item.terms, loan, TERM_YEARS, ltvPct).totalRepaid !== null,
    ),
  )
  let basis: HomePathways['comparedOver']
  if (termKnown) {
    basis = { basis: 'term', years: TERM_YEARS }
  } else {
    const counts = new Map<number, number>()
    for (const item of eligible) {
      const years = fixedYearsOf(item.terms)
      if (years === null) continue
      const providers = new Set(
        eligible
          .filter((other) => fixedYearsOf(other.terms) === years)
          .map((other) => other.product.provider),
      )
      counts.set(years, providers.size)
    }
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 3
    basis = { basis: 'fixed_period', years: common }
  }

  const bonusFor = (lender: string): { eur: number; conditions: string[]; confirmed: boolean } => {
    const savers = (LINKED_SAVERS[lender] ?? []).filter(
      (saver) =>
        (!saver.firstTimeBuyerOnly || input.firstTimeBuyer) &&
        input.monthlySaving >= saver.minMonthlyEur,
    )
    return {
      eur: round2(
        savers.reduce(
          (sum, saver) => sum + saver.bonusEur * (saver.lessDirt ? 1 - DIRT_RATE : 1),
          0,
        ),
      ),
      conditions: savers.map((saver) => `${saver.name}: ${saver.conditions}`),
      confirmed: savers.every((saver) => saver.confirmed),
    }
  }

  const cost = (item: { product: ProductView; terms: MortgageTerms }): Candidate | null => {
    const figures = mortgageFigures(item.terms, loan, TERM_YEARS, ltvPct)
    const rule = CASHBACK[item.product.provider]
    const offered = item.terms.cashback.offered !== false
    const isFixed = item.terms.rateType === 'fixed'
    let now = 0
    let later = 0
    let laterAfter: number | null = null
    if (offered && rule !== undefined && (!rule.fixedOnly || isFixed)) {
      const pctNow = rule.upfrontPct ?? item.terms.cashback.pct
      if (pctNow !== null) now += (loan * pctNow) / 100
      if (rule.flatEur !== null && loan >= (rule.minLoanEur ?? 0)) now += rule.flatEur
      if (rule.laterPct !== null) {
        later = (loan * rule.laterPct) / 100
        laterAfter = rule.laterAfterYears
      }
    } else if (offered && rule === undefined && item.terms.cashback.pct !== null) {
      now += (loan * item.terms.cashback.pct) / 100
    }
    if (basis.basis === 'term') {
      if (figures.totalRepaid === null) return null
      const counted = now + (laterAfter !== null && laterAfter <= TERM_YEARS ? later : 0)
      return {
        product: item.product,
        terms: item.terms,
        interest: round2(figures.totalRepaid - loan),
        cashback: round2(counted),
        cashbackNow: round2(now),
        cashbackLater: round2(counted - now),
        monthly: figures.monthlyRepayment,
      }
    }
    if (fixedYearsOf(item.terms) !== basis.years) return null
    const months = basis.years * 12
    const r = item.terms.initialRatePct / 100 / 12
    const paid = figures.monthlyRepayment * months
    const owed = balanceAfter(loan, r, figures.monthlyRepayment, months)
    const counted = now + (laterAfter !== null && laterAfter <= basis.years ? later : 0)
    return {
      product: item.product,
      terms: item.terms,
      interest: round2(paid - (loan - owed)),
      cashback: round2(counted),
      cashbackNow: round2(now),
      cashbackLater: round2(counted - now),
      monthly: figures.monthlyRepayment,
    }
  }

  const leftOut: string[] = []
  const best = lenders.flatMap((lender) => {
    const bonus = bonusFor(lender)
    const options = eligible
      .filter((item) => item.product.provider === lender)
      .flatMap((item) => {
        const c = cost(item)
        return c === null ? [] : [c]
      })
      .sort((a, b) => a.interest - a.cashback - (b.interest - b.cashback))
    const top = options[0]
    const name =
      eligible.find((item) => item.product.provider === lender)?.product.providerName ?? lender
    if (top === undefined) {
      leftOut.push(
        `${name}: no ${basis.basis === 'term' ? 'rate with a stated follow-on rate' : `${String(basis.years)}-year fixed rate`} at ${String(ltvPct)}% loan-to-value.`,
      )
      return []
    }
    return [{ lender, name, top, bonus }]
  })
  if (best.length === 0) return null

  const period =
    basis.basis === 'term'
      ? `${String(TERM_YEARS)} years`
      : `the ${String(basis.years)}-year fixed period`
  const ranked = best
    .map(({ lender, name, top, bonus }) => {
      const net = round2(top.interest - top.cashback - bonus.eur)
      const rule = CASHBACK[lender]
      const cashbackConfirmed = top.cashback === 0 || rule?.confirmed === true
      const drivers = [
        ...(bonus.eur > 0
          ? [
              `${(LINKED_SAVERS[lender] ?? [])[0]?.name ?? 'savings'} bonus ${euro(bonus.eur)} after DIRT`,
            ]
          : []),
        ...(top.cashbackNow > 0 ? [`${euro(top.cashbackNow)} cashback at drawdown`] : []),
        ...(top.cashbackLater > 0
          ? [`${euro(top.cashbackLater)} more after ${String(rule?.laterAfterYears ?? 5)} years`]
          : []),
      ]
      const greenAlternative = input.newBuild
        ? null
        : input.market.products.find(
            (product) =>
              product.provider === lender &&
              product.terms.kind === 'mortgage' &&
              isGreen(product) &&
              product.terms.buyerTypes.includes(buyer) &&
              (product.terms.ltvMinPct ?? 0) <= ltvPct + 1e-9 &&
              (product.terms.ltvMaxPct ?? 100) >= ltvPct - 1e-9,
          )
      return {
        lender,
        lenderName: name,
        mortgage: {
          productId: top.product.id,
          name: top.product.name,
          ratePct: top.terms.initialRatePct,
          fixedYears: fixedYearsOf(top.terms),
          followOnRatePct: top.terms.followOnRatePct,
          monthlyRepayment: top.monthly,
        },
        keysOn,
        interestEur: top.interest,
        cashbackEur: top.cashback,
        bonusEur: bonus.eur,
        netCostEur: net,
        vsCheapestEur: 0,
        drivers: drivers.length === 0 ? 'the rate alone' : drivers.join(', '),
        conditions: [
          ...(rule === undefined || top.cashback === 0 ? [] : [rule.conditions]),
          ...bonus.conditions,
          ...(bonus.eur > 0
            ? [
                'The bonus is paid after drawdown, so it lowers the cost rather than the deposit needed: the keys date is the same.',
              ]
            : []),
        ],
        confirmed: cashbackConfirmed && (bonus.eur === 0 || bonus.confirmed),
        greenNote:
          greenAlternative === undefined ||
          greenAlternative === null ||
          greenAlternative.terms.kind !== 'mortgage'
            ? null
            : `If the home is BER B3 or better: ${greenAlternative.name} at ${String(greenAlternative.terms.initialRatePct)}%.`,
        sources: [
          ...(rule === undefined || top.cashback === 0 ? [] : [rule.sourceUrl]),
          ...(LINKED_SAVERS[lender] ?? [])
            .filter(() => bonus.eur > 0)
            .map((saver) => saver.sourceUrl),
          top.product.provenance.providerUrl ?? top.product.provenance.sourceUrl,
        ],
        line: '',
      }
    })
    .sort((a, b) => a.netCostEur - b.netCostEur)
  const cheapest = ranked[0]?.netCostEur ?? 0
  const pathways = ranked.slice(0, MAX_PATHWAYS).map((pathway, index) => {
    const vs = round2(pathway.netCostEur - cheapest)
    const when =
      keysOn === null
        ? 'keys not reached within the figures'
        : `keys around ${input.monthName(keysOn)}`
    const costLine =
      index === 0
        ? `the lowest cost over ${period}`
        : `about ${euro(Math.round(vs))} more over ${period} than the lowest`
    return {
      ...pathway,
      vsCheapestEur: vs,
      line: `With ${pathway.lenderName}: ${when}; ${pathway.mortgage.name} at ${String(pathway.mortgage.ratePct)}% (${euro(pathway.mortgage.monthlyRepayment)} a month), ${pathway.drivers === 'the rate alone' ? 'no cashback or bonus' : pathway.drivers}; ${costLine}${pathway.confirmed ? '' : ' (incentives from CCPC’s tables, not confirmed on the lender’s site)'}.`,
    }
  })

  const assumptions = [
    `Assumed: ${input.firstTimeBuyer ? 'first-time buyer' : 'not a first-time buyer'}${input.firstTimeBuyerStated ? '' : ' (no home owned was mentioned)'}`,
    `a ${String(TERM_YEARS)}-year mortgage with a ${euro(deposit)} deposit (${String(round2(100 - ltvPct))}%)`,
    input.homePrice !== undefined
      ? `a ${euro(price)} home, as given`
      : `a ${euro(price)} home: what the savings by ${input.monthName(input.goalDate)} support at ${String(measures.maxLtvPct)}% loan-to-value${bindingLimit === 'income' ? `, capped by ${String(measures.loanToIncome)} times income` : bindingLimit === 'income_not_given' ? `, assuming income allows a ${euro(loan)} loan (${String(measures.loanToIncome)} times income would need ${euro(Math.ceil(loan / measures.loanToIncome))} a year)` : ''}`,
    input.newBuild
      ? `a new build, taken as BER A (green rates apply), with Help to Buy of ${euro(helpToBuy)}${input.taxPaid === undefined ? ' (up to; limited by Income Tax and DIRT paid, not given)' : ''}`
      : 'not a new build, so no Help to Buy and standard rates (a BER C where a lender prices by BER)',
    `stamp duty of ${euro(stampDuty)} (1%) and ${euro(BUYING_COSTS.legalAndSurveyEur)} for legal fees and a survey (an estimate)`,
    `costs compared over ${period} for every lender${basis.basis === 'fixed_period' ? ', as not every lender states a follow-on rate' : ', at each lender’s stated follow-on rate after the fixed period'}`,
  ].join('; ')

  return {
    headline:
      keysOn === null
        ? 'Your home: the keys are not reached within the figures.'
        : `Your home: keys around ${input.monthName(keysOn)}.`,
    assumptions: [`${assumptions}.`],
    price,
    priceFrom: input.homePrice === undefined ? 'savings' : 'given',
    bindingLimit,
    loan,
    ltvPct,
    depositEur: deposit,
    stampDutyEur: stampDuty,
    legalAndSurveyEur: BUYING_COSTS.legalAndSurveyEur,
    helpToBuyEur: helpToBuy,
    neededAtKeysEur: needed,
    keysOn,
    comparedOver: basis,
    pathways,
    leftOut,
  }
}
