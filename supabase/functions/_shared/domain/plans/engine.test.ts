import { describe, expect, it } from 'vitest'
import {
  canTransition,
  checkinDue,
  describeProjection,
  nextMilestone,
  planProgress,
  reachesSavingsTarget,
  reached,
} from './engine.ts'
import type { Checkin, Milestone, Plan, PlanContext } from './types.ts'
import type { FactReader } from '../journey.ts'

const milestone = (over: Partial<Milestone> = {}): Milestone => ({
  id: 'm1',
  kind: 'numeric',
  label: 'Deposit reaches €60,000',
  sort: 0,
  targetAmount: 60_000,
  targetDate: null,
  targetProduct: null,
  targetState: null,
  targetFacts: null,
  state: 'not_started',
  achievedAt: null,
  ...over,
})

const checkin = (over: Partial<Checkin> = {}): Checkin => ({
  id: 'c1',
  purpose: 'Mortgage readiness review',
  agenda: ['Check deposit progress', 'Confirm income has not changed'],
  triggerKind: 'date',
  dueAt: '2027-01-15T09:00:00Z',
  triggerEvent: null,
  state: 'scheduled',
  ...over,
})

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1',
  goal: 'buy_first_home',
  title: 'Buy our first home',
  status: 'active',
  targetAmount: 60_000,
  targetDate: '2027-04-01',
  milestones: [milestone()],
  checkins: [checkin()],
  applications: [],
  lastConfirmedAt: null,
  ...over,
})

/** A reader over a plain object, so a `facts` milestone can be tested from one literal. */
const reader = (held: Record<string, unknown> = {}): FactReader => ({
  has: (key) => held[key] !== undefined,
  get: (key) => held[key],
  number: (key) => (typeof held[key] === 'number' ? held[key] : null),
  boolean: (key) => (typeof held[key] === 'boolean' ? held[key] : null),
})

const context = (over: Partial<PlanContext> = {}): PlanContext => ({
  savingsBalance: 46_000,
  monthlySaving: 2_500,
  facts: reader(),
  today: '2026-10-05',
  ...over,
})

describe('progress is measured, never guessed', () => {
  it('works out the gap and when they will close it', () => {
    const progress = planProgress(plan(), context())

    expect(progress.short).toBe(14_000)
    // €14,000 at €2,500 a month.
    expect(progress.monthsRemaining).toBe(6)
    expect(progress.projectedDate).toBe('2027-04-05')
  })

  it('reports a fraction of the target, not of nothing', () => {
    expect(planProgress(plan(), context()).fraction).toBeCloseTo(46 / 60, 3)
  })

  it('refuses to project without a saving rate', () => {
    const progress = planProgress(plan(), context({ monthlySaving: null }))

    expect(progress.short).toBe(14_000)
    expect(progress.monthsRemaining).toBeNull()
    expect(progress.projectedDate).toBeNull()
  })

  it('says nothing about being on track when no date was set', () => {
    expect(planProgress(plan({ targetDate: null }), context()).onTrack).toBeNull()
  })

  it('knows when the date they set will be missed', () => {
    // €14,000 at €500 a month is 28 months, well past April.
    const progress = planProgress(plan(), context({ monthlySaving: 500 }))
    expect(progress.onTrack).toBe(false)
  })

  it('treats an achieved target as zero away, not as unknown', () => {
    const progress = planProgress(plan(), context({ savingsBalance: 61_000 }))

    expect(progress.short).toBe(0)
    expect(progress.monthsRemaining).toBe(0)
    expect(progress.fraction).toBe(1)
  })

  it('says nothing at all when there is no target', () => {
    const progress = planProgress(plan({ targetAmount: null }), context())

    expect(progress.short).toBeNull()
    expect(progress.fraction).toBeNull()
    expect(progress.projectedDate).toBeNull()
  })
})

describe('milestones', () => {
  it('counts a numeric milestone as reached once the money is there', () => {
    expect(reached(milestone(), context({ savingsBalance: 60_000 }))).toBe(true)
    expect(reached(milestone(), context({ savingsBalance: 59_999 }))).toBe(false)
  })

  it('counts an application milestone from the application, not the plan', () => {
    const approved = milestone({
      kind: 'application',
      targetProduct: 'mortgage',
      targetState: 'approved',
      targetAmount: null,
    })

    expect(reached(approved, context(), [{ product: 'mortgage', state: 'approved' }])).toBe(true)
    expect(reached(approved, context(), [{ product: 'mortgage', state: 'submitted' }])).toBe(false)
  })

  it('does not call a number they have already passed the next thing ahead', () => {
    const next = nextMilestone(
      plan({
        milestones: [
          milestone({ id: 'm1', targetAmount: 50_000, sort: 0 }),
          milestone({ id: 'm2', targetAmount: 60_000, sort: 1 }),
        ],
      }),
      context({ savingsBalance: 52_000 }),
    )

    expect(next?.id).toBe('m2')
  })

  it('has nothing ahead once everything is reached', () => {
    expect(nextMilestone(plan(), context({ savingsBalance: 70_000 }))).toBeNull()
  })
})

describe('check-ins', () => {
  it('is not due before its date', () => {
    expect(checkinDue(checkin(), context({ today: '2026-12-31' }))).toBe(false)
  })

  it('is due on the day', () => {
    expect(checkinDue(checkin(), context({ today: '2027-01-15' }))).toBe(true)
  })

  it('fires on the event it was waiting for', () => {
    const onEvent = checkin({
      triggerKind: 'event',
      dueAt: null,
      triggerEvent: 'savings_target_reached',
    })

    expect(checkinDue(onEvent, context(), [])).toBe(false)
    expect(checkinDue(onEvent, context(), ['savings_target_reached'])).toBe(true)
  })

  it('does not fire one the customer already dealt with', () => {
    expect(checkinDue(checkin({ state: 'completed' }), context({ today: '2030-01-01' }))).toBe(
      false,
    )
    expect(checkinDue(checkin({ state: 'skipped' }), context({ today: '2030-01-01' }))).toBe(false)
  })

  it('carries an agenda written when it was created, not when it fires', () => {
    expect(checkin().agenda.length).toBeGreaterThan(0)
  })
})

describe('plan lifecycle', () => {
  it('lets a proposal be accepted or dropped, and nothing else', () => {
    expect(canTransition('draft', 'active')).toBe(true)
    expect(canTransition('draft', 'abandoned')).toBe(true)
    expect(canTransition('draft', 'completed')).toBe(false)
  })

  it('lets an active plan be paused and picked up again', () => {
    expect(canTransition('active', 'paused')).toBe(true)
    expect(canTransition('paused', 'active')).toBe(true)
  })

  it('does not reopen something the customer finished or walked away from', () => {
    expect(canTransition('completed', 'active')).toBe(false)
    expect(canTransition('abandoned', 'active')).toBe(false)
    expect(canTransition('archived', 'active')).toBe(false)
  })
})

describe('putting a projection into words', () => {
  it('gives the model the numbers rather than letting it invent them', () => {
    const words = describeProjection(planProgress(plan(), context()))

    expect(words).toContain('€46,000 of €60,000')
    expect(words).toContain('6 months')
  })

  it('tells the model not to guess when it cannot know', () => {
    const words = describeProjection(planProgress(plan(), context({ monthlySaving: null })))
    expect(words).toMatch(/do not guess/i)
  })

  it('says plainly when they have arrived', () => {
    const words = describeProjection(planProgress(plan(), context({ savingsBalance: 60_000 })))
    expect(words).toMatch(/reached/i)
  })
})

/**
 * A milestone that is reached by the case being able to answer something.
 *
 * Most of the goal catalogue's milestones are this shape — "affordability understood", "debts
 * understood" — and before this existed they were all unevaluable, so plan progress sat still
 * while the conversation collected exactly the information the milestone was about.
 */
describe('milestones bound to what the case knows', () => {
  const understood = milestone({
    kind: 'facts',
    label: 'Affordability understood',
    targetAmount: null,
    targetFacts: ['income.annualBasic', 'housing.purchasePrice'],
  })

  it('is reached once every fact is held', () => {
    const facts = reader({ 'income.annualBasic': 92_000, 'housing.purchasePrice': 600_000 })
    expect(reached(understood, context({ facts }))).toBe(true)
  })

  it('is not reached while one is still missing', () => {
    const facts = reader({ 'income.annualBasic': 92_000 })
    expect(reached(understood, context({ facts }))).toBe(false)
  })

  it('counts a household fact and a person fact alike', () => {
    // "Do we know their income" has one answer whether it was recorded against the household or
    // against them, and a milestone that cared would be asking a different question.
    const personal: FactReader = {
      has: (key, subject) => key === 'income.annualBasic' && subject === 'primary',
      get: () => undefined,
      number: () => null,
      boolean: () => null,
    }
    expect(
      reached(
        milestone({ kind: 'facts', targetAmount: null, targetFacts: ['income.annualBasic'] }),
        context({ facts: personal }),
      ),
    ).toBe(true)
  })

  /** Vacuous truth is the wrong default: a binding to nothing is a mistake, not an achievement. */
  it('is never reached when it is bound to nothing', () => {
    expect(
      reached(milestone({ kind: 'facts', targetAmount: null, targetFacts: [] }), context()),
    ).toBe(false)
    expect(
      reached(milestone({ kind: 'facts', targetAmount: null, targetFacts: null }), context()),
    ).toBe(false)
  })
})

/**
 * `savings_target_reached` used to be raised whenever any milestone was achieved, so defining a
 * deposit target fired the check-in meant for reaching one — a customer €3,500 short had a
 * "mortgage readiness review" come due the moment their plan was created.
 */
describe('reaching a savings target', () => {
  const plan = (targetAmount: number | null): Plan => ({ targetAmount }) as unknown as Plan

  const milestone = (kind: Milestone['kind'], targetAmount: number | null): Milestone =>
    ({ kind, targetAmount }) as unknown as Milestone

  it('is true only when a numeric milestone meets the plan target', () => {
    expect(reachesSavingsTarget(plan(38_500), milestone('numeric', 38_500))).toBe(true)
  })

  it('is false for part of the way there', () => {
    expect(reachesSavingsTarget(plan(38_500), milestone('numeric', 19_250))).toBe(false)
  })

  it('is false for everything that is not money arriving', () => {
    for (const kind of ['date', 'application', 'facts', 'customer', 'external'] as const) {
      expect(reachesSavingsTarget(plan(38_500), milestone(kind, 38_500)), kind).toBe(false)
    }
  })

  it('is false when the plan has no money target at all', () => {
    // "Get ready for the baby" has milestones and no figure; nothing on it can be reached.
    expect(reachesSavingsTarget(plan(null), milestone('numeric', 38_500))).toBe(false)
  })

  it('is true when they have overshot', () => {
    expect(reachesSavingsTarget(plan(38_500), milestone('numeric', 40_000))).toBe(true)
  })
})
