import {
  buildPlanRequestSchema,
  type Goal,
  type MoneyCheckRequest,
  type MoneyCheckResponse,
} from '../../contracts/market-tools.ts'
import { questionsFor, SHARPEN, sharpenLines } from './questions.ts'
import { review } from './review.ts'
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

  // A plan already carries the questions in its presentation (saoi_build_plan gives the same).
  const presentation =
    plan === null
      ? [
          ...reviewed.presentation.slice(0, -1),
          ...sharpenLines(questions),
          ...reviewed.presentation.slice(-1),
        ]
      : assumed === null
        ? [...plan.presentation]
        : [
            ...plan.presentation.slice(0, -1).filter((line) => !line.startsWith(SHARPEN)),
            'No goal was given, so this plan is for the savings held with no date: nothing is locked away.',
            ...sharpenLines(questions),
            ...plan.presentation.slice(-1),
          ]
  // With no goal given, the plan's questions are the money check's (which ask what it is for).
  if (plan !== null && assumed !== null) plan = { ...plan, questions }

  return { presentation, questions, review: reviewed, plan, planGoalAssumed: assumed }
}
