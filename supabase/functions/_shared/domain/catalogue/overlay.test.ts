import { describe, expect, it } from 'vitest'
import { goalCatalogue } from '../goals/catalogue.ts'
import { evaluateGoals } from '../goals/engine.ts'
import type { GoalContext } from '../goals/types.ts'
import { needCatalogue } from '../needs/catalogue.ts'
import { evaluateNeeds } from '../needs/engine.ts'
import {
  checkinKey,
  effectiveGoals,
  effectiveNeeds,
  emptyOverride,
  overridesAnything,
  type CatalogueOverride,
} from './overlay.ts'

const override = (
  kind: 'goal' | 'need',
  entryId: string,
  edits: Partial<CatalogueOverride> = {},
): CatalogueOverride => ({ ...emptyOverride(kind, entryId), ...edits })

describe('check-in keys', () => {
  it('are unique within every goal, which is what makes deriving them safe', () => {
    for (const goal of goalCatalogue) {
      const keys = goal.checkins.map(checkinKey)
      expect(new Set(keys).size, `${goal.id} has two check-ins with the same key`).toBe(keys.length)
    }
  })

  it('describe what the check-in is, not where it sits', () => {
    expect(checkinKey({ kind: 'scheduled', everyMonths: 3, purpose: '', agenda: [] })).toBe(
      'every:3',
    )
    expect(checkinKey({ kind: 'event', event: 'mortgage_approved', purpose: '', agenda: [] })).toBe(
      'on:mortgage_approved',
    )
  })
})

describe('an empty overlay', () => {
  it('leaves both catalogues exactly as compiled', () => {
    expect(effectiveGoals(goalCatalogue, [])).toEqual(goalCatalogue)
    expect(effectiveNeeds(needCatalogue, [])).toEqual(needCatalogue)
  })

  it('is recognised as changing nothing', () => {
    expect(overridesAnything(emptyOverride('goal', 'buy_first_home'))).toBe(false)
  })
})

describe('disabling', () => {
  it('removes the goal from what the engine is given', () => {
    const result = effectiveGoals(goalCatalogue, [
      override('goal', 'buy_first_home', { enabled: false }),
    ])

    expect(result).toHaveLength(goalCatalogue.length - 1)
    expect(result.find((goal) => goal.id === 'buy_first_home')).toBeUndefined()
  })

  it('removes the need from what the engine is given', () => {
    const result = effectiveNeeds(needCatalogue, [
      override('need', needCatalogue[0]!.id, { enabled: false }),
    ])
    expect(result).toHaveLength(needCatalogue.length - 1)
  })

  it('is the only edit that counts as changing behaviour', () => {
    expect(overridesAnything(override('goal', 'buy_first_home', { enabled: false }))).toBe(true)
  })

  it('leaves every other goal untouched', () => {
    const result = effectiveGoals(goalCatalogue, [
      override('goal', 'buy_first_home', { enabled: false }),
    ])
    const expected = goalCatalogue.filter((goal) => goal.id !== 'buy_first_home')
    expect(result).toEqual(expected)
  })
})

describe('prose', () => {
  it('replaces a goal name and description', () => {
    const [goal] = effectiveGoals(
      goalCatalogue.filter((item) => item.id === 'buy_first_home'),
      [override('goal', 'buy_first_home', { name: 'Get on the ladder', summary: 'A first home.' })],
    )

    expect(goal?.name).toBe('Get on the ladder')
    expect(goal?.description).toBe('A first home.')
  })

  it('replaces a need name, framing and priority', () => {
    const first = needCatalogue[0]!
    const [need] = effectiveNeeds(
      needCatalogue.filter((item) => item.id === first.id),
      [override('need', first.id, { name: 'Renamed', summary: 'Reframed.', priority: 'low' })],
    )

    expect(need?.name).toBe('Renamed')
    expect(need?.framing).toBe('Reframed.')
    expect(need?.priority).toBe('low')
  })

  it('leaves the conditions alone — the whole point of the split', () => {
    const original = goalCatalogue.find((goal) => goal.id === 'buy_first_home')!
    const [goal] = effectiveGoals(
      [original],
      [override('goal', 'buy_first_home', { name: 'Renamed' })],
    )

    expect(goal?.signals).toBe(original.signals)
    expect(goal?.suppressions).toBe(original.suppressions)
    expect(goal?.deferrals).toBe(original.deferrals)
    expect(goal?.relationships).toBe(original.relationships)
    expect(goal?.draws).toBe(original.draws)
  })

  it('replaces one milestone label and no others', () => {
    const original = goalCatalogue.find((goal) => goal.milestones.length > 1)!
    const target = original.milestones[0]!

    const [goal] = effectiveGoals(
      [original],
      [override('goal', original.id, { milestoneLabels: { [target.id]: 'Reworded' } })],
    )

    expect(goal?.milestones[0]?.label).toBe('Reworded')
    expect(goal?.milestones[1]?.label).toBe(original.milestones[1]?.label)
    // Rewording a milestone must not change how it is detected.
    expect(goal?.milestones[0]?.binding).toEqual(target.binding)
  })

  it('replaces a check-in agenda by its derived key', () => {
    const original = goalCatalogue.find((goal) => goal.checkins.length > 0)!
    const checkin = original.checkins[0]!

    const [goal] = effectiveGoals(
      [original],
      [override('goal', original.id, { checkinAgendas: { [checkinKey(checkin)]: ['Just this'] } })],
    )

    expect(goal?.checkins[0]?.agenda).toEqual(['Just this'])
    expect(goal?.checkins[0]?.purpose).toBe(checkin.purpose)
  })

  it('ignores an agenda edited down to nothing', () => {
    const original = goalCatalogue.find((goal) => goal.checkins.length > 0)!
    const checkin = original.checkins[0]!

    const [goal] = effectiveGoals(
      [original],
      [override('goal', original.id, { checkinAgendas: { [checkinKey(checkin)]: [] } })],
    )

    expect(goal?.checkins[0]?.agenda).toEqual(checkin.agenda)
  })

  it('ignores an override for an entry that is not in the catalogue', () => {
    const result = effectiveGoals(goalCatalogue, [
      override('goal', 'no_such_goal', { enabled: false, name: 'Ghost' }),
    ])

    expect(result).toHaveLength(goalCatalogue.length)
  })

  it('does not let a goal override touch a need of the same id, or the reverse', () => {
    const first = needCatalogue[0]!
    const asGoal = effectiveNeeds(needCatalogue, [
      override('goal', first.id, { enabled: false, name: 'Wrong kind' }),
    ])

    expect(asGoal).toHaveLength(needCatalogue.length)
    expect(asGoal.find((need) => need.id === first.id)?.name).toBe(first.name)
  })
})

/**
 * The overlay only matters if the engines act on it, and "disabled" is the one edit that changes
 * behaviour — so this is the test that would catch a call site still reading the module constant.
 */
describe('the engines honour what they are given', () => {
  const context: GoalContext = {
    facts: {
      has: () => false,
      get: () => undefined,
      boolean: () => undefined,
      number: () => undefined,
    } as unknown as GoalContext['facts'],
    applications: [],
    sensitiveDisclosure: false,
    plans: [],
    today: '2026-10-07',
  }

  it('never raises a goal that has been switched off', () => {
    const all = evaluateGoals(context)
    expect(all.some((candidate) => candidate.goal.id === 'buy_first_home')).toBe(true)

    const trimmed = evaluateGoals(
      context,
      effectiveGoals(goalCatalogue, [override('goal', 'buy_first_home', { enabled: false })]),
    )

    expect(trimmed.some((candidate) => candidate.goal.id === 'buy_first_home')).toBe(false)
    expect(trimmed).toHaveLength(all.length - 1)
  })

  it('uses the overridden name in what it hands back', () => {
    const [candidate] = evaluateGoals(
      context,
      effectiveGoals(goalCatalogue, [
        override('goal', 'buy_first_home', { name: 'Ladder' }),
      ]).filter((goal) => goal.id === 'buy_first_home'),
    )

    expect(candidate?.goal.name).toBe('Ladder')
  })

  it('never evaluates a need that has been switched off', () => {
    const first = needCatalogue[0]!
    const needContext = {
      facts: context.facts,
      applications: [],
      sensitiveDisclosure: false,
      decisions: [],
    } as unknown as Parameters<typeof evaluateNeeds>[0]

    const trimmed = evaluateNeeds(
      needContext,
      effectiveNeeds(needCatalogue, [override('need', first.id, { enabled: false })]),
    )

    expect(trimmed.some((candidate) => candidate.need.id === first.id)).toBe(false)
  })
})
