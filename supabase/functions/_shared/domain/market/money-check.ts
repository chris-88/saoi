import {
  buildPlanRequestSchema,
  type Goal,
  type MoneyCheckRequest,
  type MoneyCheckResponse,
  type Situation,
} from '../../contracts/market-tools.ts'
import { monthlyOutgoings, review } from './review.ts'
import { buildPlan } from './plan.ts'
import type { AsOf, Market } from './types.ts'

/**
 * The one-call entry (Chris, 2026-11-09: "connect it and just talk"). Takes whatever the
 * customer has said so far and returns the review, a plan when there is enough to build one,
 * otherwise the questions that would unlock it, and the presentation block a host reads first.
 * The granular tools stay for follow-ups.
 *
 * When no goal was given but there is money to place or a debt to weigh, the plan is built for
 * "the savings held, no date" and says so (`planGoalAssumed`): nothing is locked away without a
 * date, so the assumption costs nothing the customer did not choose.
 */

const DEFAULT_GOAL: Goal = {
  id: 'savings',
  kind: 'grow_savings',
  label: 'The savings held (no date set)',
  priority: 1,
}

/** The questions that would most change the answer, in order, at most three. */
export function questionsFor(situation: Situation, goals: readonly Goal[]): string[] {
  const out: string[] = []
  const held = situation.savings.reduce((sum, item) => sum + item.balance, 0)
  const home = goals.some((goal) => goal.kind === 'house_deposit')
  if (held === 0 && situation.monthlySaving === undefined) {
    out.push(
      'How much is held in savings or a current account now, and how much can be put aside each month?',
    )
  }
  if (goals.length === 0) {
    out.push(
      'What is the money for: a home, a car, a buffer for emergencies, or nothing in particular yet? And by when?',
    )
  }
  if (home && situation.firstTimeBuyer === undefined) {
    out.push('Is this a first home? Help to Buy and the lending limits depend on it.')
  }
  if (home && situation.income?.annualGross === undefined) {
    out.push(
      'What is the gross income a year (joint, if buying together)? It sets what the Central Bank limits allow.',
    )
  }
  if (situation.savings.some((item) => item.aerPct === undefined)) {
    out.push(
      'What do the savings earn now, if known? Without the rate, the money they could earn elsewhere is not counted.',
    )
  }
  if (
    situation.debts.some(
      (debt) =>
        debt.ratePct === undefined ||
        (debt.monthlyRepayment === undefined && debt.monthsRemaining === undefined),
    )
  ) {
    out.push(
      'For each loan or card: the interest rate, and the monthly repayment or the months left?',
    )
  }
  if (monthlyOutgoings(situation) === null) {
    out.push('Roughly what goes out each month, rent included? It sizes an emergency buffer.')
  }
  return out.slice(0, 3)
}

export function moneyCheck(
  market: Market,
  request: MoneyCheckRequest,
  asOf: AsOf,
  createdAt: string,
): MoneyCheckResponse {
  const { situation, goals, ...options } = request
  const reviewed = review(market, { situation, goals }, asOf)
  const questions = questionsFor(situation, goals)

  const held = situation.savings.reduce((sum, item) => sum + item.balance, 0)
  const enough = held > 0 || (situation.monthlySaving ?? 0) > 0
  let plan: MoneyCheckResponse['plan'] = null
  let assumed: string | null = null
  if (enough) {
    const planGoals = goals.length > 0 ? goals : [DEFAULT_GOAL]
    if (goals.length === 0) assumed = DEFAULT_GOAL.label
    plan = buildPlan(
      market,
      buildPlanRequestSchema.parse({ ...options, situation, goals: planGoals }),
      asOf,
      createdAt,
    )
  }

  const ask =
    questions.length === 0
      ? []
      : [
          `To sharpen this, the customer could say: ${questions.map((q, i) => `(${String(i + 1)}) ${q}`).join(' ')}`,
        ]
  const presentation =
    plan === null
      ? [...reviewed.presentation.slice(0, -1), ...ask, ...reviewed.presentation.slice(-1)]
      : [
          ...plan.presentation.slice(0, -1),
          ...(assumed === null
            ? []
            : [
                'No goal was given, so this plan is for the savings held with no date: nothing is locked away.',
              ]),
          ...ask,
          ...plan.presentation.slice(-1),
        ]

  return { presentation, questions, review: reviewed, plan, planGoalAssumed: assumed }
}
