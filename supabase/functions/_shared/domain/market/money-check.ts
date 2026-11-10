import {
  buildPlanRequestSchema,
  type Goal,
  type MoneyCheckRequest,
  type MoneyCheckResponse,
  type PlanQuestion,
} from '../../contracts/market-tools.ts'
import { questionsFor, sharpenLines } from './questions.ts'
import { review } from './review.ts'
import { buildPlan, NEXT_QUESTION_PREFIX, nextQuestionLine } from './plan.ts'
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

  // A plan already ends with its one question (saoi_build_plan gives the same). With no goal
  // given, the goal is the question that matters most: the plan is for the savings held only.
  const goalQuestion: PlanQuestion = {
    key: 'goal',
    question: 'What is the money for: a home, a car, or nothing in particular yet? And by when?',
    why: 'With a goal and a date, the plan saves towards it instead of the savings held with no date.',
    spread: { keysMonths: 0, costEur: 0, priceEur: 0, totalEur: 0 },
    scoreEur: 0,
  }
  const presentation =
    plan === null
      ? [
          ...reviewed.presentation.slice(0, -1),
          ...sharpenLines(questions),
          ...reviewed.presentation.slice(-1),
        ]
      : assumed === null
        ? [...plan.presentation]
        : (() => {
            const body = plan.presentation.filter((line) => !line.startsWith(NEXT_QUESTION_PREFIX))
            return [
              ...body.slice(0, -1),
              'No goal was given, so this plan is for the savings held with no date: nothing is locked away.',
              ...body.slice(-1),
              nextQuestionLine(goalQuestion),
            ]
          })()
  if (plan !== null && assumed !== null) {
    plan = {
      ...plan,
      questions,
      nextQuestion: goalQuestion,
      laterQuestions: [
        ...(plan.nextQuestion === null ? [] : [plan.nextQuestion]),
        ...plan.laterQuestions,
      ],
    }
  }

  // With a plan, the questions are the plan's, ranked by how much each answer would move it.
  return {
    presentation,
    questions: plan === null ? questions : plan.questions,
    review: reviewed,
    plan,
    planGoalAssumed: assumed,
  }
}
