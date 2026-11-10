import type {
  HomePathways,
  HomePreferences,
  HomeSort,
  MortgageTerms,
  ProductView,
} from '../../contracts/market-tools.ts'
import { MORTGAGE_WARNINGS } from '../../market/disclosures.ts'
import { HELP_TO_BUY, MORTGAGE_MEASURES } from '../../market/first-home-rules.ts'
import { BUYING_COSTS, CASHBACK, LINKED_SAVERS } from '../../market/mortgage-incentives.ts'
import { euro, mortgageFigures } from './figures.ts'
import { berMatches } from './search.ts'
import { DIRT_RATE, round2 } from './simulate.ts'
import type { Market } from './types.ts'

/**
 * The options for a home (Chris, 2026-11-10): every eligible lender's options compared end to
 * end. Each option is the savings to the keys, Help to Buy where it applies, one of the lender's
 * mortgages at the resulting loan-to-value (its cheapest per rate type and fixed period, with the
 * runners-up listed), its cashback, and any savings bonus tied to it. They are filtered by the
 * customer's own choices (stay with my bank, fixed or variable, a green home) and sorted by the
 * metric the customer picks: cost over the first 5 years, the keys date or the monthly
 * repayment. A comparison: no option is picked for the customer (decision
 * `2026-11-10-saoi-compare-with-customer-filters`).
 *
 * Every assumption is stated and correctable. Only figures from the data are used: an incentive
 * not in `market/mortgage-incentives.ts` or the lender's own CCPC row is not invented.
 */

export const TERM_YEARS = 30

/** Names a customer might use for a lender, folded to letters and digits. */
const BANK_ALIASES: Readonly<Record<string, string>> = {
  bankofireland: 'boi',
  boi: 'boi',
  allied: 'aib',
  alliedirishbanks: 'aib',
  aib: 'aib',
  permanenttsb: 'ptsb',
  ptsb: 'ptsb',
  avant: 'avant_money',
  avantmoney: 'avant_money',
  creditunion: 'credit_union_mortgages',
}
const fold = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Whether a lender is the bank the customer named. */
export function isBank(named: string, provider: string, providerName: string): boolean {
  const asked = fold(named)
  if (asked === '') return false
  if (BANK_ALIASES[asked] === provider) return true
  const id = fold(provider)
  const name = fold(providerName)
  return asked === id || name === asked || name.startsWith(asked) || asked.startsWith(name)
}

export const SORT_WORDS: Readonly<Record<HomeSort, string>> = {
  five_year_cost: 'cost over the first 5 years, lowest first',
  keys_date: 'keys date, soonest first',
  monthly_repayment: 'monthly repayment, lowest first',
}

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
  /** The savings plan's monthly lines, to show the lender's own regular saver in its bundle. */
  readonly savers: readonly { provider: string; name: string; monthly: number }[]
  /** The customer's own filters and sort order. */
  readonly preferences?: HomePreferences | undefined
}

type Candidate = {
  readonly product: ProductView
  readonly terms: MortgageTerms
  /** Interest over the first five years, plus the valuation fee where stated. */
  readonly interest: number
  /** Cashback paid within the five years. */
  readonly cashback: number
  readonly cashbackNow: number
  readonly cashbackLater: number
  /** Cashback paid after the five years (BoI's later 1%): listed, not ranked. */
  readonly cashbackAfter: number
  readonly cashbackAfterYears: number | null
  readonly monthly: number
  /** A fix shorter than five years with no follow-on rate stated: the fixed rate carried on. */
  readonly followOnAssumed: boolean
  readonly thirtyYearInterest: number | null
}

/** The comparison horizon: the first five years (Chris, 2026-11-10). */
export const HORIZON_YEARS = 5

/** The valuation fee where the source states one in euro; other fees are listed, not added. */
function valuationFeeOf(fees: Readonly<Record<string, string>>): number {
  for (const [label, value] of Object.entries(fees)) {
    if (!/valuation/i.test(label)) continue
    const found = /€\s?([\d,]+(?:\.\d+)?)/.exec(value)?.[1]
    if (found !== undefined) return Number(found.replaceAll(',', ''))
  }
  return 0
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

type Bundle = HomePathways['pathways'][number]['bundle']

/**
 * What the customer would hold with the lender on this path: its mortgage-linked saver, its own
 * regular saver where the savings plan uses one, the mortgage, the cashback. Information, not a
 * recommendation to move banks: the current account stays where it is unless a product counted
 * here needs one with the lender (none of those recorded does today).
 */
function bundleFor(
  lender: string,
  pathway: {
    mortgage: { name: string; ratePct: number; monthlyRepayment: number }
    bonusEur: number
    cashbackEur: number
  },
  input: PathwayInput,
): Bundle {
  const products: Bundle['products'] = []
  if (pathway.bonusEur > 0) {
    for (const saver of LINKED_SAVERS[lender] ?? []) {
      products.push({
        role: 'linked_saver',
        name: saver.name,
        detail: `€${String(saver.minMonthlyEur)} or more a month for ${String(saver.minMonths)} months, ${euro(saver.bonusEur)} bonus less DIRT after drawdown`,
      })
    }
  }
  for (const saver of input.savers.filter((line) => line.provider === lender && line.monthly > 0)) {
    products.push({
      role: 'regular_saver',
      name: saver.name,
      detail: `${euro(saver.monthly)} a month`,
    })
  }
  products.push({
    role: 'mortgage',
    name: pathway.mortgage.name,
    detail: `${String(pathway.mortgage.ratePct)}%, ${euro(pathway.mortgage.monthlyRepayment)} a month`,
  })
  const rule = CASHBACK[lender]
  if (pathway.cashbackEur > 0) {
    products.push({
      role: 'cashback',
      name: 'Cashback',
      detail:
        rule?.laterPct !== null && rule?.laterPct !== undefined
          ? `${String(rule.upfrontPct ?? 0)}% at drawdown and ${String(rule.laterPct)}% after ${String(rule.laterAfterYears ?? 5)} years`
          : euro(pathway.cashbackEur),
    })
  }
  return {
    products,
    currentAccount:
      'None of these products is recorded as needing a current account with the lender.',
  }
}

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
  const prefs = input.preferences ?? {}
  const green = input.newBuild || prefs.green === true
  const assumedBer = input.newBuild ? 'A1' : prefs.green === true ? 'B3' : 'C1'
  const isGreen = (product: ProductView): boolean => /green|eco/i.test(product.name)
  const rateType = prefs.rateType ?? 'either'
  const onlyBank =
    prefs.stayWithBank === true && prefs.currentBank !== undefined ? prefs.currentBank : null
  const filters: string[] = []
  const eligible = input.market.products.flatMap((product) => {
    const terms = product.terms
    if (terms.kind !== 'mortgage') return []
    if (onlyBank !== null && !isBank(onlyBank, product.provider, product.providerName)) return []
    if (rateType !== 'either' && terms.rateType !== rateType) return []
    if (!terms.buyerTypes.includes(buyer)) return []
    if ((terms.ltvMinPct ?? 0) > ltvPct + 1e-9 || (terms.ltvMaxPct ?? 100) < ltvPct - 1e-9)
      return []
    // A rate for larger loans only: kept when the loan is at least its stated minimum. Where the
    // source does not state the minimum, the rate is kept and the pathway says to check it.
    if (terms.minLoanEur !== null && loan < terms.minLoanEur) return []
    // A new build is taken as BER A: green rates apply. Otherwise standard rates only, and where
    // a lender prices by BER, a BER C is assumed (stated, correctable).
    if (isGreen(product) && !green) return []
    if (terms.ber !== null && !berMatches(terms.ber, assumedBer)) return []
    return [{ product, terms }]
  })
  const fixedYearsOf = (terms: MortgageTerms): number | null =>
    terms.rateType === 'fixed' ? terms.fixedYears : null

  // Like for like (Chris, 2026-11-10): every lender over the first five years. Ranking on 30
  // years at today's follow-on rates mostly compares standard variable rates people rarely pay,
  // as they switch; five years covers the fixes on offer and the cashback paid up front.
  const lenders = [...new Set(eligible.map((item) => item.product.provider))]
  const basis: HomePathways['comparedOver'] = { basis: 'first_years', years: HORIZON_YEARS }

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
    // Interest over the first 60 months on a 30-year term: the initial rate for the fix, then the
    // follow-on rate for the rest of the 60 months; with no follow-on stated, the fixed rate is
    // carried on and the figure says so.
    const horizonMonths = HORIZON_YEARS * 12
    const fixedMonths =
      item.terms.rateType === 'fixed' && item.terms.fixedYears !== null
        ? Math.min(item.terms.fixedYears * 12, horizonMonths)
        : horizonMonths
    const r1 = item.terms.initialRatePct / 100 / 12
    const pay1 = figures.monthlyRepayment
    let balance = loan
    let interest = 0
    for (let month = 0; month < fixedMonths; month += 1) {
      const charge = balance * r1
      interest += charge
      balance = balance + charge - pay1
    }
    const followOnAssumed = fixedMonths < horizonMonths && item.terms.followOnRatePct === null
    if (fixedMonths < horizonMonths) {
      const r2 = (item.terms.followOnRatePct ?? item.terms.initialRatePct) / 100 / 12
      const left = TERM_YEARS * 12 - fixedMonths
      const pay2 = r2 === 0 ? balance / left : (balance * r2) / (1 - Math.pow(1 + r2, -left))
      for (let month = fixedMonths; month < horizonMonths; month += 1) {
        const charge = balance * r2
        interest += charge
        balance = balance + charge - pay2
      }
    }
    const within = laterAfter !== null && laterAfter < HORIZON_YEARS ? later : 0
    const fees = valuationFeeOf(item.terms.fees)
    return {
      product: item.product,
      terms: item.terms,
      interest: round2(interest + fees),
      cashback: round2(now + within),
      cashbackNow: round2(now),
      cashbackLater: round2(within),
      cashbackAfter: round2(later - within),
      cashbackAfterYears: laterAfter,
      monthly: pay1,
      followOnAssumed,
      thirtyYearInterest: figures.totalRepaid === null ? null : round2(figures.totalRepaid - loan),
    }
  }

  const leftOut: string[] = []
  const kindOf = (terms: MortgageTerms): string =>
    terms.rateType === 'fixed' ? `fixed-${String(terms.fixedYears ?? 0)}` : 'variable'
  const best = lenders.flatMap((lender) => {
    const bonus = bonusFor(lender)
    const all = eligible
      .filter((item) => item.product.provider === lender)
      .flatMap((item) => {
        const c = cost(item)
        return c === null ? [] : [c]
      })
      .sort((a, b) => a.interest - a.cashback - (b.interest - b.cashback))
    const name =
      eligible.find((item) => item.product.provider === lender)?.product.providerName ?? lender
    if (all.length === 0) {
      leftOut.push(`${name}: no eligible rate at ${String(ltvPct)}% loan-to-value.`)
      return []
    }
    // Every option the lender has: its cheapest product (net of cashback) per rate type and
    // fixed period, with the rest of that kind as runners-up. A rate with no cashback and one
    // with 3% are only comparable once both are worked out.
    const kinds = [...new Set(all.map((option) => kindOf(option.terms)))]
    return kinds.flatMap((kind) => {
      const options = all.filter((option) => kindOf(option.terms) === kind)
      const top = options[0]
      return top === undefined ? [] : [{ lender, name, top, bonus, options }]
    })
  })
  if (best.length === 0) return null
  const sortBy: HomeSort = prefs.sortBy ?? 'five_year_cost'
  if (onlyBank !== null) {
    const shown = best[0]?.name ?? onlyBank
    filters.push(`Showing ${shown} options, as you asked.`)
  }
  if (rateType !== 'either') filters.push(`Showing ${rateType} rates only, as you asked.`)
  if (prefs.green === true && !input.newBuild)
    filters.push('Green rates included: the home is taken as BER B3 or better, as you said.')
  if (prefs.openToCurrentAccountSwitch === false)
    filters.push(
      'Leaving out options that need a current account with the lender, as you asked: none of these is recorded as needing one.',
    )

  const period = `the first ${String(HORIZON_YEARS)} years`
  const ranked = best
    .map(({ lender, name, top, bonus, options }) => {
      const net = round2(top.interest - top.cashback - bonus.eur)
      const minLoanUnknown = top.terms.highValue && top.terms.minLoanEur === null
      const lowestRatePct = Math.min(
        ...eligible
          .filter((item) => item.product.provider === lender)
          .map((item) => item.terms.initialRatePct),
      )
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
        ...(top.cashbackAfter > 0
          ? [
              `+${euro(top.cashbackAfter)} after ${String(top.cashbackAfterYears ?? HORIZON_YEARS)} years if repayments are on time (not counted in the ranking)`,
            ]
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
          rateType: top.terms.rateType,
          ratePct: top.terms.initialRatePct,
          fixedYears: fixedYearsOf(top.terms),
          followOnRatePct: top.terms.followOnRatePct,
          monthlyRepayment: top.monthly,
        },
        keysOn,
        interestEur: top.interest,
        cashbackEur: top.cashback,
        bonusEur: bonus.eur,
        cashbackAfterEur: top.cashbackAfter,
        netCostEur: net,
        thirtyYearNetEur:
          top.thirtyYearInterest === null
            ? null
            : round2(
                top.thirtyYearInterest -
                  top.cashbackNow -
                  top.cashbackLater -
                  top.cashbackAfter -
                  bonus.eur,
              ),
        followOnAssumed: top.followOnAssumed,
        vsCheapestEur: 0,
        drivers: drivers.length === 0 ? 'the rate alone' : drivers.join(', '),
        conditions: [
          ...(minLoanUnknown
            ? [
                `${top.product.name} is a higher-value rate for larger loans; the minimum loan is not stated in CCPC’s data, so check it with ${name}.`,
              ]
            : top.terms.minLoanEur !== null
              ? [`${top.product.name} is for loans of ${euro(top.terms.minLoanEur)} or more.`]
              : []),
          ...(rule === undefined || top.cashback === 0 ? [] : [rule.conditions]),
          ...(top.followOnAssumed
            ? [
                `${top.product.name}: no follow-on rate is stated, so the fixed rate is carried on to the end of the first ${String(HORIZON_YEARS)} years (unconfirmed).`,
              ]
            : []),
          ...bonus.conditions,
          ...(bonus.eur > 0
            ? [
                'The bonus is paid after drawdown, so it lowers the cost rather than the deposit needed: the keys date is the same.',
              ]
            : []),
        ],
        confirmed:
          cashbackConfirmed &&
          (bonus.eur === 0 || bonus.confirmed) &&
          !minLoanUnknown &&
          !top.followOnAssumed,
        lowestRatePct,
        considered: options.slice(0, 3).map((option) => ({
          productId: option.product.id,
          name: option.product.name,
          ratePct: option.terms.initialRatePct,
          netCostEur: round2(option.interest - option.cashback - bonus.eur),
        })),
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
    .sort((a, b) => {
      const byCost = a.netCostEur - b.netCostEur
      const byMonthly = a.mortgage.monthlyRepayment - b.mortgage.monthlyRepayment
      const byKeys = (a.keysOn ?? '9999-99').localeCompare(b.keysOn ?? '9999-99')
      if (sortBy === 'monthly_repayment') return byMonthly || byCost
      if (sortBy === 'keys_date') return byKeys || byCost
      return byCost || byMonthly
    })
  const cheapest = Math.min(...ranked.map((pathway) => pathway.netCostEur))
  const pathways = ranked.map((pathway) => {
    const vs = round2(pathway.netCostEur - cheapest)
    const when =
      keysOn === null
        ? 'deposit not reached within the figures'
        : `deposit in place around ${input.monthName(keysOn)}`
    const costLine =
      vs <= 0
        ? `${euro(Math.round(pathway.netCostEur))} over ${period}, the lowest shown`
        : `${euro(Math.round(pathway.netCostEur))} over ${period}, ${euro(Math.round(vs))} more than the lowest shown`
    const bundle = bundleFor(pathway.lender, pathway, input)
    const kind =
      pathway.mortgage.rateType === 'fixed' && pathway.mortgage.fixedYears !== null
        ? `${String(pathway.mortgage.fixedYears)}-year fixed`
        : 'variable'
    return {
      ...pathway,
      vsCheapestEur: vs,
      bundle,
      line: `${pathway.lenderName}, ${kind}: ${pathway.mortgage.name} at ${String(pathway.mortgage.ratePct)}%, ${euro(pathway.mortgage.monthlyRepayment)} a month; ${when}; ${costLine}${pathway.drivers === 'the rate alone' ? '' : ` (${pathway.drivers})`}${pathway.confirmed ? '' : ' (incentives from CCPC’s tables, not confirmed on the lender’s site)'}.`,
    }
  })

  const assumptions = [
    `Showing ${input.firstTimeBuyer ? 'first-time-buyer' : 'second-and-later-buyer'} rates${input.firstTimeBuyerStated ? '' : ' (no home owned was mentioned; say if not)'}`,
    `a ${String(TERM_YEARS)}-year mortgage with a ${euro(deposit)} deposit (${String(round2(100 - ltvPct))}%)`,
    input.homePrice !== undefined
      ? `a ${euro(price)} home, as given`
      : `a ${euro(price)} home: what the savings by ${input.monthName(input.goalDate)} support at ${String(measures.maxLtvPct)}% loan-to-value${bindingLimit === 'income' ? `, capped by ${String(measures.loanToIncome)} times income` : bindingLimit === 'income_not_given' ? `, assuming income allows a ${euro(loan)} loan (${String(measures.loanToIncome)} times income would need ${euro(Math.ceil(loan / measures.loanToIncome))} a year)` : ''}`,
    input.newBuild
      ? `a new build, taken as BER A (green rates apply), with Help to Buy of ${euro(helpToBuy)}${input.taxPaid === undefined ? ' (up to; limited by Income Tax and DIRT paid, not given)' : ''}`
      : prefs.green === true
        ? 'not a new build, so no Help to Buy; green rates for a BER B3 or better home'
        : 'not a new build, so no Help to Buy and standard rates (a BER C where a lender prices by BER)',
    `stamp duty of ${euro(stampDuty)} (1%) and ${euro(BUYING_COSTS.legalAndSurveyEur)} for legal fees and a survey (an estimate)`,
    `costs compared over ${period} for every lender: interest on a ${String(TERM_YEARS)}-year term plus the valuation fee, less cashback paid within ${String(HORIZON_YEARS)} years and any savings bonus; a shorter fix moves to its stated follow-on rate for the rest of the ${String(HORIZON_YEARS)} years`,
  ].join('; ')

  return {
    headline:
      keysOn === null
        ? 'At these figures, the deposit and buying costs are not reached within the figures.'
        : `At these figures, the deposit and buying costs are in place around ${input.monthName(keysOn)}.`,
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
    sortBy,
    sortedBy: `${String(pathways.length)} option${pathways.length === 1 ? '' : 's'} that fit${pathways.length === 1 ? 's' : ''}, sorted by ${SORT_WORDS[sortBy]} (another order can be chosen).`,
    filters,
    pathways,
    leftOut,
    warnings: [...MORTGAGE_WARNINGS],
  }
}
