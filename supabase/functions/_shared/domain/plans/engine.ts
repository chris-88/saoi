import type { Checkin, Milestone, Plan, PlanContext, PlanProgress, PlanStatus } from './types.ts'

/**
 * Plan arithmetic.
 *
 * §40 — the deterministic system calculates and the model explains. Every number a customer
 * is told about their own money comes from here, so "you'll get there around February" is
 * something the bank can stand over rather than something a model found plausible.
 */

/** Months are the unit customers think in, and the only one the inputs can support. */
const MONTH = 'month'

function addMonths(from: string, months: number): string {
  const [year = 0, month = 1, day = 1] = from.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

/**
 * How far along, and when they will arrive.
 *
 * Returns nulls rather than zeros wherever the case genuinely cannot say. A projected date
 * invented from a missing saving rate is the exact failure this engine exists to prevent —
 * the customer would act on it.
 */
export function planProgress(plan: Plan, context: PlanContext): PlanProgress {
  const target = plan.targetAmount
  const current = context.savingsBalance

  const short = target !== null && current !== null ? Math.max(0, target - current) : null
  const fraction =
    target !== null && target > 0 && current !== null
      ? Math.min(1, Math.max(0, current / target))
      : null

  const rate = context.monthlySaving
  const monthsRemaining =
    short !== null && rate !== null && rate > 0 ? Math.ceil(short / rate) : short === 0 ? 0 : null

  const projectedDate = monthsRemaining === null ? null : addMonths(context.today, monthsRemaining)

  // Only meaningful where the customer set a date to be measured against.
  const onTrack =
    plan.targetDate === null || projectedDate === null ? null : projectedDate <= plan.targetDate

  return {
    current,
    target,
    short,
    fraction,
    projectedDate,
    monthsRemaining,
    onTrack,
    nextMilestone: nextMilestone(plan, context),
    nextCheckin: nextCheckin(plan),
  }
}

/** The nearest thing still ahead of them, in plan order. */
export function nextMilestone(plan: Plan, context: PlanContext): Milestone | null {
  const open = plan.milestones
    .filter((milestone) => milestone.state === 'not_started' || milestone.state === 'in_progress')
    .sort((a, b) => a.sort - b.sort)

  // A numeric milestone they have already passed is reported as reached, not as next: the
  // stored state catches up when something evaluates it, and the customer should not be told
  // they are approaching a number they are already over.
  return open.find((milestone) => !reached(milestone, context)) ?? null
}

/**
 * Has this milestone actually happened?
 *
 * Pure and evaluated from the case, so the same answer comes out whether it is asked by a
 * scheduled job, the console, or the customer's next turn.
 */
export function reached(
  milestone: Milestone,
  context: PlanContext,
  applications: readonly { product: string; state: string }[] = [],
): boolean {
  switch (milestone.kind) {
    case 'numeric':
      return (
        milestone.targetAmount !== null &&
        context.savingsBalance !== null &&
        context.savingsBalance >= milestone.targetAmount
      )
    case 'date':
      return milestone.targetDate !== null && context.today >= milestone.targetDate
    case 'application':
      return applications.some(
        (application) =>
          application.product === milestone.targetProduct &&
          application.state === milestone.targetState,
      )
    /**
     * Reached once the case can answer every one of them.
     *
     * An empty list would be vacuously true, so it counts as not reached — a milestone bound to
     * nothing has not been evidenced, it has been mis-defined.
     */
    case 'facts':
      return (
        milestone.targetFacts !== null &&
        milestone.targetFacts.length > 0 &&
        milestone.targetFacts.every(
          (key) => context.facts.has(key, 'household') || context.facts.has(key, 'primary'),
        )
      )
    // Nothing in the case evidences these; they are marked by hand.
    case 'customer':
    case 'external':
      return milestone.state === 'achieved'
  }
}

/**
 * The next time Saoirse should speak to them, if there is one.
 *
 * A check-in that is due but has nothing on its agenda is still returned: deciding there is
 * nothing useful to say is the check-in doing its job, and §20 wants Saoirse to say so plainly
 * rather than quietly skip it.
 */
export function nextCheckin(plan: Plan): Checkin | null {
  const open = plan.checkins.filter(
    (checkin) => checkin.state === 'scheduled' || checkin.state === 'due',
  )

  const dated = open
    .filter((checkin) => checkin.dueAt !== null)
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))

  return dated[0] ?? open[0] ?? null
}

/** Due now, by date or because the event it was waiting for happened. */
export function checkinDue(
  checkin: Checkin,
  context: PlanContext,
  firedEvents: readonly string[] = [],
): boolean {
  if (checkin.state !== 'scheduled' && checkin.state !== 'due') return false

  if (checkin.triggerKind === 'date') {
    return checkin.dueAt !== null && checkin.dueAt.slice(0, 10) <= context.today
  }

  return checkin.triggerEvent !== null && firedEvents.includes(checkin.triggerEvent)
}

/**
 * Which status changes are allowed.
 *
 * Small enough to read, and worth having explicit: a completed plan that can be paused, or an
 * abandoned one that quietly reactivates, is a customer being told something untrue about
 * their own intentions.
 */
const TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  draft: ['active', 'abandoned'],
  active: ['paused', 'completed', 'abandoned'],
  paused: ['active', 'abandoned', 'archived'],
  completed: ['archived'],
  abandoned: ['archived'],
  archived: [],
}

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Plain words for a projection, so the model has something to say rather than invent. */
export function describeProjection(progress: PlanProgress): string | null {
  if (progress.target === null || progress.current === null) return null

  const money = (amount: number) => `€${amount.toLocaleString('en-IE')}`

  if (progress.short === 0) {
    return `They have reached the ${money(progress.target)} target.`
  }

  const where = `${money(progress.current)} of ${money(progress.target)}`

  if (progress.monthsRemaining === null) {
    return `${where}. How long depends on what they can put away each month — do not guess.`
  }

  const when = `about ${String(progress.monthsRemaining)} ${MONTH}${progress.monthsRemaining === 1 ? '' : 's'}`
  const track =
    progress.onTrack === null
      ? ''
      : progress.onTrack
        ? ' That is ahead of the date they set.'
        : ' That is later than the date they set.'

  return `${where}, ${when} away at the rate they gave (${progress.projectedDate ?? 'unknown'}).${track}`
}

/**
 * Whether reaching this milestone means the money actually arrived.
 *
 * `savings_target_reached` is what an event check-in on a savings goal waits for, and it used to
 * be raised whenever *any* milestone was achieved. So defining a deposit target fired the
 * check-in meant for reaching one: a customer €3,500 short had a "mortgage readiness review"
 * come due the moment their plan was created.
 *
 * Only a numeric milestone at or above the plan's full target counts. A fractional one is
 * progress — worth a milestone, not worth telling somebody they have arrived — and everything
 * else on a plan is paperwork.
 */
export function reachesSavingsTarget(plan: Plan, milestone: Milestone): boolean {
  if (milestone.kind !== 'numeric') return false
  if (plan.targetAmount === null || milestone.targetAmount === null) return false

  return milestone.targetAmount >= plan.targetAmount
}
