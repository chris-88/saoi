import type {
  BuildPlanRequest,
  BuildPlanResponse,
  PlanQuestion,
} from '../../contracts/market-tools.ts'
import { euro } from './figures.ts'
import { monthsUntil, round2 } from './simulate.ts'

/**
 * The single question whose answer would change the plan most (Chris, 2026-11-10), worked out
 * rather than listed: for each input not given, the plan is run across a few plausible answers
 * and the spread in the keys month, the cost of the home and the position is measured. The
 * largest spread is asked first; the rest follow in order.
 *
 * The score is in euro: the spread in cost over the period compared, plus the spread in what is
 * held at the end, plus the keys spread in months times what is saved a month.
 */

type Run = (request: Omit<BuildPlanRequest, 'alternatives'>) => BuildPlanResponse
type Base = Omit<BuildPlanRequest, 'alternatives'>

const INCOMES = [45_000, 70_000, 100_000] as const
const DEBT_MONTHS = [12, 36, 60] as const

type Measure = { keys: string | null; cost: number | null; price: number | null; total: number }

const measure = (result: BuildPlanResponse): Measure => ({
  keys: result.home?.keysOn ?? result.goalReachedOn,
  cost: result.home?.pathways[0]?.netCostEur ?? null,
  price: result.home?.price ?? null,
  total: result.position.total,
})

const spreadOf = (values: readonly (number | null)[]): number => {
  const known = values.filter((value): value is number => value !== null)
  return known.length < 2 ? 0 : Math.max(...known) - Math.min(...known)
}

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
      priceEur: round2(spreadOf(measures.map((m) => m.price))),
      totalEur: round2(spreadOf(measures.map((m) => m.total))),
    }
    const value = round2(spread.costEur + spread.totalEur + spread.keysMonths * monthly)
    candidates.push({ key, question, why: why(spread), spread, scoreEur: value })
  }

  if (home && situation.income?.annualGross === undefined) {
    score(
      'income',
      'What is the gross income a year (joint, if buying together)?',
      INCOMES.map((annualGross) =>
        run({ ...base, situation: { ...situation, income: { ...situation.income, annualGross } } }),
      ),
      (s) =>
        `Income decides how much can be borrowed: from ${euro(INCOMES[0])} to ${euro(INCOMES[2])} a year it moves the price that can be bought by up to ${euro(Math.round(s.priceEur))} and the cost of the home by up to ${euro(Math.round(s.costEur))}.`,
    )
  }
  if (home && base.propertyKind === undefined) {
    score(
      'property_kind',
      'Is the home a new build, or second-hand?',
      (['new_build', 'second_hand'] as const).map((propertyKind) => run({ ...base, propertyKind })),
      (s) =>
        `A new build brings Help to Buy and green rates: it moves the cost of the home by up to ${euro(Math.round(s.costEur))}${s.keysMonths > 0 ? ` and the keys by ${String(s.keysMonths)} months` : ''}.`,
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
        `The price sets the keys date and the loan: 15% either side of ${euro(price)} moves the keys by ${String(s.keysMonths)} months and the cost by up to ${euro(Math.round(s.costEur))}.`,
    )
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
        `The repayment decides what clearing the loan saves: between 12 and 60 months left it moves what is held at the end by up to ${euro(Math.round(s.totalEur))}${home ? ` and the cost of the home by up to ${euro(Math.round(s.costEur))}` : ''}.`,
    )
  }
  if (home) {
    candidates.push({
      key: 'current_account_bank',
      question: 'Which bank holds the current account?',
      why: 'Some products need an account with the same bank; none of those in these pathways does, so it changes no figure here.',
      spread: { keysMonths: 0, costEur: 0, priceEur: 0, totalEur: 0 },
      scoreEur: 0,
    })
  }

  const ranked = [...candidates].sort((a, b) => b.scoreEur - a.scoreEur)
  return { nextQuestion: ranked[0] ?? null, laterQuestions: ranked.slice(1) }
}
