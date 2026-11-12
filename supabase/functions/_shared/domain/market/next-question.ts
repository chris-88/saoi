import type {
  BuildPlanRequest,
  BuildPlanResponse,
  PlanQuestion,
} from '../../contracts/market-tools.ts'
import { MORTGAGE_MEASURES } from '../../market/first-home-rules.ts'
import { euro } from './figures.ts'
import { monthsUntil, round2 } from './simulate.ts'

/**
 * The single question whose answer would change the plan most (Chris, 2026-11-10), worked out
 * rather than listed: for each input not given, the plan is run across a few plausible answers
 * and the spread in the keys month, the cost of the home and the position is measured. The
 * largest spread is asked first; the rest follow in order.
 *
 * The score is in euro and measures the goal, not the size of the home (Chris, 2026-11-10): the
 * spread in the price that can be bought, plus the keys spread in months times what is saved a
 * month, plus the spread in what is held at the end, plus the spread in cost per €100,000
 * borrowed. The absolute cost of the home is reported but not scored: a bigger home costs more,
 * which says nothing about the answer.
 */

type Run = (request: Omit<BuildPlanRequest, 'alternatives'>) => BuildPlanResponse
type Base = Omit<BuildPlanRequest, 'alternatives'>

const INCOMES = [45_000, 70_000, 100_000] as const
const DEBT_MONTHS = [12, 36, 60] as const

type Measure = {
  keys: string | null
  cost: number | null
  costPer100k: number | null
  price: number | null
  total: number
}

/** The lowest net cost among the options shown, whatever order the customer sorted them in. */
const lowestCost = (result: BuildPlanResponse): number | null =>
  result.home === null || result.home.pathways.length === 0
    ? null
    : Math.min(...result.home.pathways.map((pathway) => pathway.netCostEur))

const measure = (result: BuildPlanResponse): Measure => ({
  keys: result.home?.keysOn ?? result.goalReachedOn,
  cost: lowestCost(result),
  costPer100k: (() => {
    const cost = lowestCost(result)
    return result.home === null || result.home.loan <= 0 || cost === null
      ? null
      : (cost / result.home.loan) * 100_000
  })(),
  price: result.home?.price ?? null,
  total: result.position.total,
})

const spreadOf = (values: readonly (number | null)[]): number => {
  const known = values.filter((value): value is number => value !== null)
  return known.length < 2 ? 0 : Math.max(...known) - Math.min(...known)
}

type Spread = PlanQuestion['spread']

const months = (n: number): string => `${String(n)} ${n === 1 ? 'month' : 'months'}`

/**
 * What a spread moves, in words, each part only when it moves (2026-11-12: a hook line never
 * quotes a spread of nothing, "by up to €0"). `price: false` leaves the price out, for the
 * questions whose answer cannot move it.
 */
function movedParts(s: Spread, options: { readonly price?: boolean } = {}): string[] {
  return [
    s.keysMonths > 0 ? `the keys by ${months(s.keysMonths)}` : '',
    options.price !== false && Math.round(s.priceEur) > 0
      ? `the price that can be bought by up to ${euro(Math.round(s.priceEur))}`
      : '',
    Math.round(s.totalEur) > 0
      ? `what is held at the end by up to ${euro(Math.round(s.totalEur))}`
      : '',
    Math.round(s.costPer100kEur) > 0
      ? `the cost per €100,000 borrowed by up to ${euro(Math.round(s.costPer100kEur))}`
      : '',
  ].filter((part) => part !== '')
}

/** "a", "a and b", "a, b and c". */
const listed = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`

/** A sentence that ends with what moves, or stops at the lead when nothing does. */
const movesOrStop = (lead: string, range: string, parts: readonly string[]): string =>
  parts.length === 0 ? `${lead}.` : `${lead}: ${range} it moves ${listed(parts)}.`

const keysSpread = (keys: readonly (string | null)[], asOf: string): number => {
  const months = keys
    .filter((key): key is string => key !== null)
    .map((key) => monthsUntil(asOf, key))
  return months.length < 2 ? 0 : Math.max(...months) - Math.min(...months)
}

export function rankQuestions(
  base: Base,
  main: BuildPlanResponse,
  run: Run,
  asOf: string,
): { nextQuestion: PlanQuestion | null; laterQuestions: PlanQuestion[] } {
  const { situation } = base
  const home = main.home !== null
  const monthly = situation.monthlySaving ?? 0
  const candidates: PlanQuestion[] = []

  const score = (
    key: PlanQuestion['key'],
    question: string,
    results: readonly BuildPlanResponse[],
    why: (s: PlanQuestion['spread']) => string,
  ) => {
    const measures = results.map(measure)
    const spread = {
      keysMonths: keysSpread(
        measures.map((m) => m.keys),
        asOf,
      ),
      costEur: round2(spreadOf(measures.map((m) => m.cost))),
      costPer100kEur: round2(spreadOf(measures.map((m) => m.costPer100k))),
      priceEur: round2(spreadOf(measures.map((m) => m.price))),
      totalEur: round2(spreadOf(measures.map((m) => m.total))),
    }
    // Asking the price itself: its spread is the question, not its effect, so it is not scored.
    const value = round2(
      (key === 'home_price' ? 0 : spread.priceEur) +
        spread.keysMonths * monthly +
        spread.totalEur +
        spread.costPer100kEur,
    )
    candidates.push({ key, question, why: why(spread), spread, scoreEur: value })
  }

  if (home && situation.income?.annualGross === undefined) {
    score(
      'income',
      'What is the gross income a year (joint, if buying together)?',
      INCOMES.map((annualGross) =>
        run({ ...base, situation: { ...situation, income: { ...situation.income, annualGross } } }),
      ),
      (s) => incomeWhy(base, s),
    )
  }
  if (home && base.propertyKind === undefined) {
    score(
      'property_kind',
      'Is the home a new build, or second-hand?',
      (['new_build', 'second_hand'] as const).map((propertyKind) => run({ ...base, propertyKind })),
      (s) =>
        movesOrStop(
          'A new build brings Help to Buy and green rates',
          'at these figures',
          movedParts(s),
        ),
    )
  }
  if (home && base.homePrice === undefined && main.home !== null) {
    const price = main.home.price
    score(
      'home_price',
      'Roughly what price, or which area?',
      [0.85, 1.15].map((factor) =>
        run({ ...base, homePrice: Math.round((price * factor) / 1_000) * 1_000 }),
      ),
      (s) =>
        movesOrStop(
          'The price sets the deposit, the loan and the keys date',
          `15% either side of ${euro(price)}`,
          movedParts(s, { price: false }),
        ),
    )
  }
  /*
   * Tax paid (2026-11-12, the first-home experience): on a new build with tax paid not given,
   * Help to Buy is left out of the figures and could be up to `helpToBuyEur`. What is at stake is
   * that amount, so it is the score; the spread is the plan run with none of it and all of it.
   */
  const conditional = main.home?.helpToBuyConditional === true ? main.home.helpToBuyEur : 0
  if (home && base.taxPaidLastFourYearsEur === undefined && conditional > 0) {
    const results = [0, conditional].map((taxPaidLastFourYearsEur) =>
      run({ ...base, taxPaidLastFourYearsEur }),
    )
    const measures = results.map(measure)
    candidates.push({
      key: 'tax_paid',
      question: `How much Income Tax and DIRT ${base.buyingTogether === true ? 'have you both' : 'have you'} paid over the last four years?`,
      why: `It decides whether Help to Buy covers the ${euro(Math.round(conditional))}.`,
      spread: {
        keysMonths: keysSpread(
          measures.map((m) => m.keys),
          asOf,
        ),
        costEur: round2(spreadOf(measures.map((m) => m.cost))),
        costPer100kEur: round2(spreadOf(measures.map((m) => m.costPer100k))),
        priceEur: round2(spreadOf(measures.map((m) => m.price))),
        totalEur: round2(spreadOf(measures.map((m) => m.total))),
      },
      scoreEur: round2(conditional),
    })
  }
  /*
   * First-time buyer (2026-11-12): assumed when not said, and it sets the Central Bank limit
   * (4 times income for a first home, 3.5 times otherwise) and whether Help to Buy can apply.
   * Scored by the larger of what the plan moves between the two and the difference in the loan
   * the limits allow on the income given, so a buyer whose figures are otherwise complete is
   * still asked the one thing assumed.
   */
  if (home && situation.firstTimeBuyer === undefined) {
    const income = situation.income?.annualGross
    const first = MORTGAGE_MEASURES.first_time_buyer.loanToIncome
    const other = MORTGAGE_MEASURES.second_and_subsequent.loanToIncome
    const limitSpread = income === undefined ? 0 : round2(income * (first - other))
    const before = candidates.length
    score(
      'first_time_buyer',
      base.buyingTogether === true
        ? 'Is this a first home for both of you, neither having owned one before?'
        : 'Is this your first home, never having owned one before?',
      ([true, false] as const).map((firstTimeBuyer) =>
        run({ ...base, situation: { ...situation, firstTimeBuyer } }),
      ),
      (s) => {
        const limit =
          income === undefined
            ? `It sets the Central Bank limit: ${String(first)} times gross income for a first home, ${String(other)} times otherwise`
            : `It sets the Central Bank limit on ${euro(income)} a year: ${euro(Math.round(income * first))} as a first-time buyer, ${euro(Math.round(income * other))} otherwise`
        const parts = movedParts(s)
        return parts.length === 0 ? `${limit}.` : `${limit}; here it moves ${listed(parts)}.`
      },
    )
    const added = candidates[before]
    if (added !== undefined && limitSpread > added.scoreEur) {
      candidates[before] = { ...added, scoreEur: limitSpread }
    }
  }
  const assumed = main.assumedRepayments.map((item) => item.debtId)
  if (assumed.length > 0) {
    score(
      'debt_repayment',
      `What is the ${main.assumedRepayments.map((item) => item.label).join(' and ')}’s actual monthly repayment, or the months left?`,
      DEBT_MONTHS.map((monthsRemaining) =>
        run({
          ...base,
          situation: {
            ...situation,
            debts: situation.debts.map((debt) =>
              assumed.includes(debt.id) ? { ...debt, monthsRemaining } : debt,
            ),
          },
        }),
      ),
      (s) =>
        movesOrStop(
          'The repayment decides what clearing the loan saves',
          'between 12 and 60 months left',
          movedParts(s, { price: home }),
        ),
    )
  }
  if (home) {
    candidates.push({
      key: 'current_account_bank',
      question: 'Which bank holds the current account?',
      why: 'Some products need an account with the same bank; none of the options shown does, so it changes no figure here.',
      spread: { keysMonths: 0, costEur: 0, costPer100kEur: 0, priceEur: 0, totalEur: 0 },
      scoreEur: 0,
    })
  }

  const ranked = [...candidates].sort((a, b) => b.scoreEur - a.scoreEur)
  return { nextQuestion: ranked[0] ?? null, laterQuestions: ranked.slice(1) }
}

/**
 * What the income moves (2026-11-12). With a price given, the price that can be bought cannot
 * move, so the sentence says whether the limits reach that price: the mortgage it needs and the
 * income that loan needs at the buyer's multiple. Without one, the parts that move, each only
 * when it does.
 */
function incomeWhy(base: Base, s: Spread): string {
  const range = `from ${euro(INCOMES[0])} to ${euro(INCOMES[2])} a year`
  if (base.homePrice === undefined) {
    return movesOrStop('Income decides how much can be borrowed', range, movedParts(s))
  }
  const measures =
    base.situation.firstTimeBuyer === false
      ? MORTGAGE_MEASURES.second_and_subsequent
      : MORTGAGE_MEASURES.first_time_buyer
  const loan = Math.round((base.homePrice * measures.maxLtvPct) / 100)
  const needs = Math.ceil(loan / measures.loanToIncome / 1_000) * 1_000
  const parts = movedParts(s, { price: false })
  return (
    `It decides whether the Central Bank limits reach the ${euro(base.homePrice)}: a ${euro(loan)} mortgage (${String(measures.maxLtvPct)}%) needs about ${euro(needs)} a year at ${String(measures.loanToIncome)} times income` +
    (parts.length === 0 ? '.' : `; ${range} it moves ${listed(parts)}.`)
  )
}
