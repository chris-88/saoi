/**
 * What a case is.
 *
 * `presenter` / `audience` came from a scripted demonstration: one rehearsed case driven from
 * the stage, throwaway ones for everybody else. A live demonstration where the room invents
 * the situation has no rehearsed case to join, so an ordinary case is just a `customer` one.
 * `presenter` survives for a case being driven on screen, and `audience` so old rows still
 * load (migration 20261006090000). `test` marks a case created by an automated probe, which
 * is excluded from the capacity cap and may be deleted at any time (migration 20261012120000).
 *
 * Defined here, once, because this union is written down in four places — a Zod row schema, a
 * loaded-case type, an admin response contract and the admin handler — and the moment the
 * database moved on its own, every case in the system failed to parse.
 */
export const CASE_KINDS = ['customer', 'presenter', 'audience', 'test'] as const

export type CaseKind = (typeof CASE_KINDS)[number]

/**
 * What a case needs from whoever is watching (§5 of the console redesign).
 *
 * Ordered by how much it wants attention, which is also the order the rules are applied in: a
 * case that was blocked *and* has an application waiting is reported as blocked, because that is
 * the thing somebody should look at.
 */
export const CASE_STATUSES = ['blocked', 'needs_review', 'in_progress', 'completed', 'new'] as const

export type CaseStatus = (typeof CASE_STATUSES)[number]

export const CASE_STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  blocked: 'Blocked',
  needs_review: 'Needs review',
  in_progress: 'In progress',
  completed: 'Completed',
  new: 'New',
}

/** Everything the rules look at. Counts and states, never conversation. */
export type CaseStatusInput = {
  /** A `request_blocked` event has been written against this case. */
  readonly everBlocked: boolean
  readonly applications: readonly { readonly state: string }[]
  /** A check-in has come due and not been dealt with. */
  readonly checkinDue: boolean
  readonly customerMessages: number
}

/**
 * Derived, never stored — the same rule as every other state in this system.
 *
 * `new` is not in the redesign's tab list and exists anyway: a case with no messages is not "in
 * progress", and on a prototype where every visitor gets one the moment they arrive, most cases
 * are empty. Lumping them in with real conversations would make the busiest tab the least useful.
 */
export function caseStatus(input: CaseStatusInput): CaseStatus {
  if (input.everBlocked) return 'blocked'

  const waiting = input.applications.some((application) =>
    ['info_required', 'waiting_partner'].includes(application.state),
  )
  if (waiting || input.checkinDue) return 'needs_review'

  const settled = (state: string) => state === 'completed' || state === 'declined'
  if (input.applications.length > 0 && input.applications.every((a) => settled(a.state))) {
    return 'completed'
  }

  return input.customerMessages > 0 ? 'in_progress' : 'new'
}

/**
 * What a conversation came to (§9, "conversations by outcome").
 *
 * Different from status, which is where a case stands now. An outcome is how far it got, and
 * the two can disagree: a case can be `in_progress` and have already produced an application.
 *
 * The spec's panel is only honest if every value is derivable, so the one everybody asks for —
 * "abandoned" — is not here. Nothing in the data distinguishes a customer who gave up from one
 * who is coming back tomorrow, and a prototype with no sign-in cannot tell them apart. Inventing
 * the distinction is exactly what §9 forbids.
 */
export const CASE_OUTCOMES = ['applied', 'planned', 'explored', 'browsing', 'blocked'] as const

export type CaseOutcome = (typeof CASE_OUTCOMES)[number]

export const CASE_OUTCOME_LABELS: Readonly<Record<CaseOutcome, string>> = {
  applied: 'Applied for something',
  planned: 'Made a plan',
  explored: 'Worked out what they needed',
  browsing: 'Had a look',
  blocked: 'Turned away',
}

/** One line each, for the chart's legend. The console explains its own numbers or it is noise. */
export const CASE_OUTCOME_NOTES: Readonly<Record<CaseOutcome, string>> = {
  applied: 'An application reached the bank.',
  planned: 'A goal became a plan, with nothing submitted yet.',
  explored: 'Saoirse established what they were after. Nothing was started.',
  browsing: 'A conversation that never got as far as a goal.',
  blocked: 'Something was turned away at the gate.',
}

export type CaseOutcomeInput = {
  readonly everBlocked: boolean
  readonly applications: readonly { readonly state: string }[]
  readonly plans: number
  readonly goalsIdentified: number
  readonly customerMessages: number
}

/**
 * How far a conversation got, in the order that counts as further.
 *
 * Reaching the bank outranks having a plan, which outranks having been understood. A case that
 * did all three is reported at its furthest point, because "what came of it" has one answer.
 *
 * `blocked` is the exception and comes first: a conversation that was turned away is a different
 * kind of outcome, not a lesser one, and burying it under "had a look" would hide the only
 * category anybody needs to act on.
 */
export function caseOutcome(input: CaseOutcomeInput): CaseOutcome | null {
  /*
   * Null for a case nobody spoke in. On a prototype where every visitor gets a case the moment
   * they arrive, most of them are empty, and counting those as "had a look" would make the
   * largest slice of the outcomes chart a measurement of page loads.
   */
  if (input.customerMessages === 0) return null

  if (input.everBlocked) return 'blocked'

  const reached = (state: string) =>
    ['submitted', 'under_review', 'info_required', 'approved', 'declined', 'completed'].includes(
      state,
    )

  if (input.applications.some((application) => reached(application.state))) return 'applied'
  if (input.plans > 0) return 'planned'
  if (input.goalsIdentified > 0) return 'explored'

  return 'browsing'
}
