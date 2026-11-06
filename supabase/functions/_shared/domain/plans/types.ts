import type { FactKey } from '../facts.ts'
import { GOAL_IDS, type GoalId } from '../goals/types.ts'
import type { FactReader, Product } from '../journey.ts'
import type { ApplicationState } from '../state-machine.ts'

/**
 * Customer Plans — where the customer is trying to get to, and how far along they are.
 *
 * Banking records transactions. Digital banking added products. Needs added intent. A plan
 * adds trajectory: the thing that makes a mortgage, a joint account, a savings account and a
 * deferred loan one objective rather than five unrelated applications.
 *
 * What is stored and what is computed is the whole design. A plan holds decisions — the goal,
 * the target the customer agreed, when a milestone was actually reached, when the next
 * check-in is due. Everything else is derived from the case on demand: progress, the gap, the
 * projected date, whether it is on track. A stored percentage is a number that can disagree
 * with the balance it came from, and this codebase already has three engines that refuse to
 * do that (Invariant 2, Invariant 3).
 */

/**
 * A plan's goal is a goal-catalogue blueprint id.
 *
 * These were nine values invented alongside plans, which could not express four of the seven
 * goals the catalogue marks as the demonstration priorities (§20). One list now, in the goals
 * domain, so a plan can only ever name a goal that has a blueprint behind it.
 */
export const PLAN_GOALS = GOAL_IDS
export type PlanGoal = GoalId

/**
 * `draft` is a plan Saoirse has proposed and the customer has not agreed to. It is deliberately a
 * state rather than an absence: §10 says Saoirse must not silently create a persistent plan, so
 * the proposal and the acceptance are different events.
 */
export const PLAN_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'abandoned',
  'archived',
] as const

export type PlanStatus = (typeof PLAN_STATUSES)[number]

/**
 * How the engine can tell a milestone has been reached.
 *
 * `facts` exists because most milestones worth having are of the form "affordability
 * understood" or "debts understood", which is not a tick box — it is whether the case can
 * answer the question. Binding those to fact keys keeps plan progress computed from what has
 * actually been collected rather than remembered separately (Invariant 3).
 */
export const MILESTONE_KINDS = [
  'numeric',
  'date',
  'application',
  'facts',
  'customer',
  'external',
] as const
export type MilestoneKind = (typeof MILESTONE_KINDS)[number]

export const MILESTONE_STATES = [
  'not_started',
  'in_progress',
  'achieved',
  'missed',
  'no_longer_relevant',
] as const

export type MilestoneState = (typeof MILESTONE_STATES)[number]

export type Milestone = {
  readonly id: string
  readonly kind: MilestoneKind
  readonly label: string
  readonly sort: number
  readonly targetAmount: number | null
  readonly targetDate: string | null
  readonly targetProduct: Product | null
  readonly targetState: ApplicationState | null
  /** For `facts` milestones: every key the case must be able to answer. */
  readonly targetFacts: readonly FactKey[] | null
  readonly state: MilestoneState
  readonly achievedAt: string | null
}

export const CHECKIN_STATES = [
  'scheduled',
  'due',
  'completed',
  'skipped',
  'cancelled',
  'rescheduled',
] as const

export type CheckinState = (typeof CHECKIN_STATES)[number]

/**
 * A planned reason to speak again.
 *
 * The agenda is written when the check-in is created, not when it fires. A check-in whose
 * reason is invented at the moment of contact is a marketing trigger wearing a different hat
 * — §20 is explicit that if there is nothing useful to discuss, Saoirse should say so and leave.
 */
export type Checkin = {
  readonly id: string
  readonly purpose: string
  readonly agenda: readonly string[]
  readonly triggerKind: 'date' | 'event'
  readonly dueAt: string | null
  readonly triggerEvent: string | null
  readonly state: CheckinState
}

export type Plan = {
  readonly id: string
  readonly goal: PlanGoal
  readonly title: string
  readonly status: PlanStatus
  readonly targetAmount: number | null
  readonly targetDate: string | null
  readonly milestones: readonly Milestone[]
  readonly checkins: readonly Checkin[]
  /** Applications started in service of this goal. */
  readonly applications: readonly { readonly product: Product; readonly state: ApplicationState }[]
  readonly lastConfirmedAt: string | null
}

/**
 * Everything derived. Recomputed on every read, never written down.
 */
export type PlanProgress = {
  /** What they hold now against what they agreed to reach. Null when there is no target. */
  readonly current: number | null
  readonly target: number | null
  readonly short: number | null
  /** 0 to 1. Null rather than zero when there is nothing to measure. */
  readonly fraction: number | null
  /**
   * When they will arrive at the rate they gave. Null when the case cannot say — no rate, no
   * target, or already there. Never a guess (§16, §40).
   */
  readonly projectedDate: string | null
  readonly monthsRemaining: number | null
  /** Against the date the customer set, where they set one. */
  readonly onTrack: boolean | null
  readonly nextMilestone: Milestone | null
  readonly nextCheckin: Checkin | null
}

/** What the plan reads from the case. Facts and state, never conversation. */
export type PlanContext = {
  readonly savingsBalance: number | null
  readonly monthlySaving: number | null
  readonly facts: FactReader
  readonly today: string
}

/**
 * A plan as proposed, before anything exists in the database.
 *
 * Defined here rather than next to the write that persists it, because this is what a goal
 * blueprint produces: the milestones and check-ins a goal carries, with the customer's agreed
 * target filled in. One definition, so the catalogue and the writer cannot disagree about shape.
 */
export type MilestoneDraft = {
  readonly kind: MilestoneKind
  readonly label: string
  readonly targetAmount: number | null
  readonly targetDate: string | null
  readonly targetProduct: Product | null
  readonly targetState: ApplicationState | null
  readonly targetFacts: readonly FactKey[] | null
}

export type CheckinDraft = {
  readonly purpose: string
  readonly agenda: readonly string[]
  readonly triggerKind: 'date' | 'event'
  readonly dueAt: string | null
  readonly triggerEvent: string | null
}

export type PlanDraft = {
  readonly goal: PlanGoal
  readonly title: string
  readonly targetAmount: number | null
  readonly targetDate: string | null
  readonly milestones: readonly MilestoneDraft[]
  readonly checkins: readonly CheckinDraft[]
}
