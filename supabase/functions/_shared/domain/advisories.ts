import type { ApplicationId } from './facts.ts'
import type { Application, ApplicationState } from './state-machine.ts'

/**
 * Advisories are deterministic rules, not model judgement (CLAUDE.md > Advisories, §6 Stage 8).
 *
 * Saoirse explains the advisory in its own words, but whether one applies — and what it says — is
 * decided here. The card offers the customer the decision; Saoirse never takes it.
 */

export const ADVISORY_IDS = ['loan_vs_mortgage'] as const
export type AdvisoryId = (typeof ADVISORY_IDS)[number]

export type AdvisoryAction = 'pause' | 'continue'

export type Advisory = {
  readonly id: AdvisoryId
  readonly title: string
  /** Fixed content. Saoirse phrases it; Saoirse does not invent it (§51). */
  readonly explanation: string
  readonly actions: readonly AdvisoryAction[]
  /** The application the customer is being asked to decide about. */
  readonly appliesTo: ApplicationId
}

/**
 * States in which advising is still useful: the customer can still change course. Once an
 * application is with the bank, the moment to advise has passed.
 */
const STILL_DECIDABLE = [
  'in_progress',
  'waiting_customer',
  'waiting_partner',
  'ready',
] as const satisfies readonly ApplicationState[]

/** A mortgage the customer is actually pursuing right now. */
const MORTGAGE_ACTIVE = [
  'in_progress',
  'waiting_customer',
  'waiting_partner',
  'ready',
  'submitted',
  'under_review',
  'info_required',
  'approved',
] as const satisfies readonly ApplicationState[]

const includes = (states: readonly ApplicationState[], state: ApplicationState): boolean =>
  states.includes(state)

const LOAN_VS_MORTGAGE_EXPLANATION =
  'Taking on additional borrowing while a mortgage application is being assessed can affect ' +
  'how much the mortgage team is able to lend, because the repayments count against your ' +
  'affordability. It may be worth holding the loan until the mortgage is decided. Either way, ' +
  'the choice is yours.'

/**
 * Every advisory that currently applies to the case.
 *
 * Required rule: `loan_vs_mortgage` fires when a personal loan is still progressing while a
 * mortgage is active.
 */
export function evaluateAdvisories(applications: readonly Application[]): readonly Advisory[] {
  const advisories: Advisory[] = []

  const mortgageActive = applications.some(
    (application) =>
      application.product === 'mortgage' && includes(MORTGAGE_ACTIVE, application.state),
  )

  if (mortgageActive) {
    for (const application of applications) {
      if (application.product !== 'personal_loan') continue
      if (!includes(STILL_DECIDABLE, application.state)) continue

      advisories.push({
        id: 'loan_vs_mortgage',
        title: 'This loan could affect your mortgage',
        explanation: LOAN_VS_MORTGAGE_EXPLANATION,
        actions: ['pause', 'continue'],
        appliesTo: application.id,
      })
    }
  }

  return advisories
}
