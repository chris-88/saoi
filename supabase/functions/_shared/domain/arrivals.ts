/**
 * What became of the people who arrived (§44, §53).
 *
 * After a show and tell the question is not "how many events" but "how far did each person
 * get": a room scans a code, some of them say something, fewer keep a plan, fewer still start
 * an application. Each step here is a count of cases, in the order a visit happens, so the
 * drop between two steps is the number who stopped there.
 *
 * Pure, so the order and the wording are tested rather than trusted. The admin function
 * decides which cases are in the period and what each one did; this decides what to call it.
 */

export const JOURNEY_STEPS = [
  { step: 'arrived', label: 'Arrived' },
  { step: 'spoke', label: 'Said something' },
  { step: 'kept_plan', label: 'Kept a plan' },
  { step: 'started_application', label: 'Started an application' },
  { step: 'submitted', label: 'Submitted' },
  { step: 'signed_in', label: 'Signed in' },
  { step: 'came_back', label: 'Came back' },
  { step: 'gave_feedback', label: 'Gave feedback' },
] as const

export type JourneyStep = (typeof JOURNEY_STEPS)[number]['step']

/** One case that arrived in the period: what was written against it, and whether they spoke. */
export type Arrival = {
  /** The types of every event on the case, however many times each happened. */
  eventTypes: ReadonlySet<string>
  customerMessages: number
  /** A notification went out and somebody spoke after it. See `cameBack`. */
  cameBack: boolean
}

/** Which event marks a step. `spoke` and `came_back` are decided from messages, not events. */
const STEP_EVENTS: Readonly<Partial<Record<JourneyStep, string>>> = {
  kept_plan: 'plan_created',
  started_application: 'application_created',
  submitted: 'application_submitted',
  signed_in: 'customer_signed_in',
  gave_feedback: 'feedback_given',
}

function reached(arrival: Arrival, step: JourneyStep): boolean {
  switch (step) {
    case 'arrived':
      return true
    case 'spoke':
      return arrival.customerMessages > 0
    case 'came_back':
      return arrival.cameBack
    case 'kept_plan':
    case 'started_application':
    case 'submitted':
    case 'signed_in':
    case 'gave_feedback': {
      const event = STEP_EVENTS[step]
      return event !== undefined && arrival.eventTypes.has(event)
    }
  }
}

/** Every step, in order, with how many of the arrivals reached it. */
export function countJourney(
  arrivals: readonly Arrival[],
): { step: JourneyStep; label: string; count: number }[] {
  return JOURNEY_STEPS.map(({ step, label }) => ({
    step,
    label,
    count: arrivals.filter((arrival) => reached(arrival, step)).length,
  }))
}

/**
 * Whether somebody came back after being told to.
 *
 * A return turn leaves no event of its own: the digest is built from `last_seen_at` and the
 * reply is an ordinary Saoirse message. So "came back" is the honest reading of what is there: a
 * notification was sent, and a message was written on the case after it went.
 */
export function cameBack(
  notificationsAt: readonly string[],
  messagesAt: readonly string[],
): boolean {
  const earliest = Math.min(...notificationsAt.map((at) => Date.parse(at)))
  if (!Number.isFinite(earliest)) return false
  return messagesAt.some((at) => Date.parse(at) > earliest)
}

/**
 * Where a conversation stalled, as the detectors in `saoirse-turn` record it. Counted as events,
 * not cases: one conversation that stalled five times is five things to read.
 */
export const STALLS = [
  { type: 'card_promised_not_shown', label: 'Promised a card it did not show' },
  { type: 'question_with_card', label: 'Asked a question beside a card' },
  { type: 'question_while_card_awaits', label: 'Asked while a card was waiting' },
  { type: 'customer_repeated', label: 'Customer repeated themselves' },
  { type: 'request_blocked', label: 'Turned away by the gate' },
] as const

export type StallType = (typeof STALLS)[number]['type']

export function countStalls(
  eventTypes: readonly string[],
): { type: StallType; label: string; count: number }[] {
  return STALLS.map(({ type, label }) => ({
    type,
    label,
    count: eventTypes.filter((event) => event === type).length,
  }))
}

export type FeedbackSummary = {
  thumbsUp: number
  thumbsDown: number
  /** How many rated the whole conversation, as distinct from a thumbs on one reply. */
  ratings: number
  /** Mean of the session ratings to one decimal; null when nobody has rated. */
  averageRating: number | null
}

/** The thumbs and the ratings, which the same table holds and the screen reads apart. */
export function summariseFeedback(
  rows: readonly { kind: string; rating: number }[],
): FeedbackSummary {
  const thumbs = rows.filter((row) => row.kind === 'turn')
  const ratings = rows.filter((row) => row.kind === 'session')
  const total = ratings.reduce((sum, row) => sum + row.rating, 0)
  return {
    thumbsUp: thumbs.filter((row) => row.rating > 0).length,
    thumbsDown: thumbs.filter((row) => row.rating < 0).length,
    ratings: ratings.length,
    averageRating: ratings.length === 0 ? null : Math.round((total / ratings.length) * 10) / 10,
  }
}
