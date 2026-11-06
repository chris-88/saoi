import type { NeedCandidate, NeedContext } from './types.ts'
import { depositGap } from './catalogue.ts'

/**
 * A plan is what a need looks like when it does not fit in one conversation.
 *
 * Some needs are finished by tapping a card. Others take months — build a deposit, then apply.
 * Without somewhere to put the second kind, the only honest thing Saoirse can say is "I can't help
 * with that", which is what it said to a customer six months out from a deposit.
 *
 * Steps are derived, never remembered: the same rule as outstanding requirements (Invariant 3).
 * What IS remembered is what the bank promised to watch — see `PlanWatch`.
 */

export type PlanStep = {
  readonly id: string
  readonly title: string
  /** Why this step, in terms of what the customer told us. */
  readonly because: string
  readonly state: 'doing_now' | 'waiting_on_them' | 'later'
  /** Roughly when, when the case supports saying. Never invented. */
  readonly when: string | null
}

export type Plan = {
  readonly steps: readonly PlanStep[]
  /** What the bank will watch for, so the customer does not have to remember to come back. */
  readonly watch: PlanWatch | null
}

/**
 * The condition that brings the customer back.
 *
 * Deterministic and checkable: a number to reach, or a date to pass. "We'll be in touch" is
 * not a plan, and a promise the system cannot actually keep is worse than no promise (§35).
 */
export type PlanWatch =
  | { readonly kind: 'savings_target'; readonly target: number; readonly describe: string }
  | { readonly kind: 'date'; readonly on: string; readonly describe: string }

const euro = (amount: number): string => `€${amount.toLocaleString('en-IE')}`

/**
 * Builds the plan from what the case already knows.
 *
 * Only produces a plan where there is genuinely a sequence — a deposit to build before a
 * mortgage is worth applying for. A customer who already has the deposit has no plan, they
 * have an application.
 */
export function buildPlan(context: NeedContext, candidates: readonly NeedCandidate[]): Plan | null {
  const gap = depositGap(context)
  const saving = candidates.find((candidate) => candidate.need.id === 'save_home_deposit')
  const mortgage = candidates.find((candidate) => candidate.need.id === 'first_home_mortgage')

  const buying = mortgage !== undefined && mortgage.confidence > 0
  if (!buying || gap === null || gap.short <= 0) return null
  if (saving === undefined || saving.state === 'declined') return null

  const monthly = context.facts.number('goals.monthlySaving', 'household')
  const targetDate = context.facts.get('goals.targetDate', 'household')

  const steps: PlanStep[] = [
    {
      id: 'open-savings',
      title: 'Open a savings account and start the deposit',
      because: `you are ${euro(gap.short)} short of the ${euro(gap.target)} you will need`,
      state: 'doing_now',
      when: null,
    },
    {
      id: 'build-deposit',
      title: `Build it to ${euro(gap.target)}`,
      because:
        monthly !== null && monthly > 0
          ? `at ${euro(monthly)} a month that is about ${String(Math.ceil(gap.short / monthly))} months`
          : 'how long depends on what you can put away each month',
      state: 'waiting_on_them',
      when: typeof targetDate === 'string' ? targetDate : null,
    },
    {
      id: 'start-mortgage',
      title: 'Start the mortgage application',
      because: 'the deposit is in place and your position is clear',
      state: 'later',
      when: null,
    },
  ]

  return {
    steps,
    watch: {
      kind: 'savings_target',
      target: gap.target,
      describe: `your savings reach ${euro(gap.target)}`,
    },
  }
}

/**
 * Has the thing the bank said it would watch for actually happened?
 *
 * Pure, so the same answer comes out wherever it is asked — a scheduled check, an admin
 * pressing a button, or the next turn of a conversation.
 */
export function watchMet(
  watch: PlanWatch,
  now: { readonly savingsBalance: number | null; readonly today: string },
): boolean {
  switch (watch.kind) {
    case 'savings_target':
      return now.savingsBalance !== null && now.savingsBalance >= watch.target
    case 'date':
      return now.today >= watch.on
  }
}
