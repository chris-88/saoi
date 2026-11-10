import type { Goal, Situation } from '../../contracts/market-tools.ts'
import { isCurrentAccount } from './held-rates.ts'
import { monthlyOutgoings } from './review.ts'

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
  // Second: without it a loan's figures rest on an assumed even repayment (Chris, 2026-11-09).
  const debts = situation.debts.filter((debt) => debt.kind !== 'mortgage')
  if (
    debts.some((debt) => debt.monthlyRepayment === undefined && debt.monthsRemaining === undefined)
  ) {
    out.push(
      debts.some((debt) => debt.ratePct === undefined)
        ? 'For each loan or card: the interest rate, and the monthly repayment or the months left? Without the repayment, an even repayment over the plan’s months is assumed.'
        : 'For each loan or card: the actual monthly repayment, or the months left? Without it, an even repayment over the plan’s months is assumed.',
    )
  } else if (debts.some((debt) => debt.ratePct === undefined)) {
    out.push('For each loan or card: the interest rate?')
  }
  if (goals.length === 0) {
    out.push('What is the money for: a home, a car, or nothing in particular yet? And by when?')
  }
  // A first-time buyer is assumed when no home is mentioned, and stated in the pathways: not asked.
  if (home && situation.income?.annualGross === undefined) {
    out.push(
      'What is the gross income a year (joint, if buying together)? It sets what the Central Bank limits allow.',
    )
  }
  if (home) {
    out.push(
      'Roughly what price, and is it a new build? Help to Buy and green rates apply to new builds; the price sets the keys date.',
    )
  }
  if (situation.savings.some((item) => item.aerPct === undefined && !isCurrentAccount(item))) {
    out.push(
      'What do the savings earn now, if known? Without the rate, the money they could earn elsewhere is not counted.',
    )
  }
  if (monthlyOutgoings(situation) === null) {
    // A buffer is modelled only when the customer raises one (Chris, 2026-11-10): no question.
  }
  return out.slice(0, 3)
}

export const SHARPEN = 'To sharpen this, the customer could say:'

/** The questions as one presentation sentence, or nothing when there are none. */
export const sharpenLines = (questions: readonly string[]): string[] =>
  questions.length === 0
    ? []
    : [`${SHARPEN} ${questions.map((q, i) => `(${String(i + 1)}) ${q}`).join(' ')}`]
