import { describe, expect, it } from 'vitest'
import { addMonths, checkinsFor, milestonesFor, planDraftFor } from './plan.ts'
import { blueprintFor, goalCatalogue } from './catalogue.ts'
import { MILESTONE_KINDS } from '../plans/types.ts'

const blueprint = (id: string) => {
  const found = blueprintFor(id)
  if (found === undefined) throw new Error(`no blueprint for ${id}`)
  return found
}

describe('a blueprint becomes a plan the customer could agree to', () => {
  const draft = planDraftFor({
    goal: 'buy_first_home',
    targetAmount: 60_000,
    targetDate: '2027-04-01',
    today: '2026-10-06',
  })

  it('takes its name and shape from the goal, not from the last goal that was built', () => {
    // Every plan used to get a first-home deposit ladder and a mortgage readiness review, so
    // somebody saving for a wedding was told their next step was a mortgage application.
    expect(draft?.goal).toBe('buy_first_home')
    expect(draft?.title).toBe('Buy our first home')

    const wedding = planDraftFor({
      goal: 'save_for_defined_purchase',
      targetAmount: 20_000,
      targetDate: '2027-08-01',
      today: '2026-10-06',
    })
    expect(wedding?.milestones.map((m) => m.label)).not.toContain('Mortgage submitted')
    expect(wedding?.checkins.map((c) => c.purpose)).not.toContain('Mortgage readiness review')
  })

  it('puts the customer’s own figure in the milestone, not a percentage', () => {
    const labels = draft?.milestones.map((milestone) => milestone.label) ?? []
    expect(labels).toContain('Deposit target reached — €60,000')
  })

  it('works the quarter marks out from the target', () => {
    const wedding = milestonesFor(blueprint('save_for_defined_purchase'), {
      targetAmount: 20_000,
      targetDate: null,
    })
    expect(wedding.filter((m) => m.kind === 'numeric').map((m) => m.targetAmount)).toEqual([
      5_000, 10_000, 15_000, 20_000,
    ])
  })

  it('binds process milestones to the application that proves them', () => {
    const submitted = draft?.milestones.find((m) => m.label === 'Mortgage submitted')
    expect(submitted?.kind).toBe('application')
    expect(submitted?.targetProduct).toBe('mortgage')
    expect(submitted?.targetState).toBe('submitted')
  })

  it('binds "understood" milestones to the facts that would make them true', () => {
    const affordability = draft?.milestones.find((m) => m.label === 'Affordability understood')
    expect(affordability?.kind).toBe('facts')
    expect(affordability?.targetFacts).toEqual(['income.annualBasic', 'housing.purchasePrice'])
  })

  it('leaves what only the customer can confirm to the customer', () => {
    const property = draft?.milestones.find((m) => m.label === 'Property selected')
    expect(property?.kind).toBe('customer')
  })

  /**
   * A money marker with no target to be a share of can never be reached, so carrying it would
   * leave permanent outstanding work on the plan.
   */
  it('drops milestones the plan has no figures for', () => {
    const noTarget = planDraftFor({
      goal: 'buy_first_home',
      targetAmount: null,
      targetDate: null,
      today: '2026-10-06',
    })

    expect(noTarget?.milestones.every((milestone) => milestone.kind !== 'numeric')).toBe(true)
    // The rest of the route survives, so the plan is still worth having.
    expect(noTarget?.milestones.length).toBeGreaterThan(3)
  })

  it('carries an agenda on every check-in it creates', () => {
    expect(draft?.checkins.length).toBeGreaterThan(0)
    for (const checkin of draft?.checkins ?? []) {
      expect(checkin.agenda.length, checkin.purpose).toBeGreaterThan(0)
    }
  })

  it('dates a monthly check-in and leaves an event one waiting', () => {
    const checkins = checkinsFor(blueprint('buy_first_home'), { today: '2026-10-06' })
    const monthly = checkins.find((checkin) => checkin.triggerKind === 'date')
    const onEvent = checkins.find((checkin) => checkin.triggerKind === 'event')

    expect(monthly?.dueAt).toBe('2026-11-06')
    expect(onEvent?.dueAt).toBeNull()
    expect(onEvent?.triggerEvent).toBe('savings_target_reached')
  })

  it('keeps a plan for something the catalogue does not cover', () => {
    const other = planDraftFor({
      goal: 'other',
      title: 'Buy a boat',
      targetAmount: 15_000,
      targetDate: null,
      today: '2026-10-06',
    })

    expect(other?.title).toBe('Buy a boat')
    expect(other?.milestones).toEqual([])
  })
})

describe('every blueprint produces a usable plan', () => {
  it('names only milestone kinds the schema accepts', () => {
    for (const goal of goalCatalogue) {
      const drafts = milestonesFor(goal, { targetAmount: 10_000, targetDate: '2027-01-01' })
      for (const draft of drafts) expect(MILESTONE_KINDS, goal.id).toContain(draft.kind)
    }
  })

  it('gives every goal at least one milestone to make progress against', () => {
    for (const goal of goalCatalogue) {
      const drafts = milestonesFor(goal, { targetAmount: 10_000, targetDate: '2027-01-01' })
      expect(drafts.length, goal.id).toBeGreaterThan(0)
    }
  })

  /** Two identical lines on a plan is worse than one: it reads like a mistake, and it is one. */
  it('never produces the same milestone twice', () => {
    for (const goal of goalCatalogue) {
      const labels = milestonesFor(goal, { targetAmount: 60_000, targetDate: '2027-01-01' }).map(
        (draft) => draft.label,
      )
      expect(new Set(labels).size, goal.id).toBe(labels.length)
    }
  })
})

describe('dating a check-in', () => {
  it('counts months, not thirty-day blocks', () => {
    expect(addMonths('2026-10-06', 1)).toBe('2026-11-06')
    expect(addMonths('2026-10-06', 12)).toBe('2027-10-06')
    expect(addMonths('2026-12-15', 3)).toBe('2027-03-15')
  })

  it('clamps to the end of a shorter month rather than sliding into the next one', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })
})
