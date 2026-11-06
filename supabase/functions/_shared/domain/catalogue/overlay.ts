import type { GoalBlueprint, GoalCheckin } from '../goals/types.ts'
import type { NeedDefinition, NeedPriority } from '../needs/types.ts'

/**
 * Editing the catalogue without pretending the conditions are editable.
 *
 * A goal's signals are predicates over facts — `savings < essentials * 3` — and no form edits
 * that. What a presenter actually wants to change between run-throughs is the wording: a name
 * that reads badly in the room, a description that over-promises, a check-in agenda that misses
 * the point. So that moves to a database row that overlays the compiled catalogue, and the
 * conditions stay in code where they are tested (plan §3.2, decision 2).
 *
 * The split is the whole design. Anything here changes what Saoirse *says*. Only `enabled` changes
 * what Saoirse *does*, and that is a switch rather than a rule, so it cannot be malformed.
 */

/** One row's worth of edits. Every prose field is null when it has not been overridden. */
export type CatalogueOverride = {
  readonly kind: 'goal' | 'need'
  readonly entryId: string
  /** False removes the entry from evaluation entirely. The only field that changes behaviour. */
  readonly enabled: boolean
  readonly name: string | null
  /** A goal's description or a need's framing — the one-line summary, whichever it is called. */
  readonly summary: string | null
  /** Needs only. Goals have no priority; the engine ranks them by evidence. */
  readonly priority: NeedPriority | null
  /** Milestone id to replacement label. */
  readonly milestoneLabels: Readonly<Record<string, string>>
  /** Check-in key (see `checkinKey`) to replacement agenda. */
  readonly checkinAgendas: Readonly<Record<string, readonly string[]>>
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * A stable handle for a check-in, which the catalogue does not give them.
 *
 * Derived from what the check-in *is* rather than where it sits, so inserting one in the code
 * catalogue above an existing one does not silently move somebody's edited agenda onto a
 * different check-in. `catalogue.test.ts` asserts these are unique within each goal, which is
 * what makes deriving the key safe instead of merely convenient.
 */
export function checkinKey(checkin: GoalCheckin): string {
  return checkin.kind === 'event' ? `on:${checkin.event}` : `every:${String(checkin.everyMonths)}`
}

/** Nothing overridden. The shape a fresh row has before anybody edits it. */
export function emptyOverride(kind: 'goal' | 'need', entryId: string): CatalogueOverride {
  return {
    kind,
    entryId,
    enabled: true,
    name: null,
    summary: null,
    priority: null,
    milestoneLabels: {},
    checkinAgendas: {},
    version: 0,
    createdAt: '',
    updatedAt: '',
  }
}

/** Whether a row changes anything at all. A row of nulls is noise in the list. */
export function overridesAnything(override: CatalogueOverride): boolean {
  return (
    !override.enabled ||
    override.name !== null ||
    override.summary !== null ||
    override.priority !== null ||
    Object.keys(override.milestoneLabels).length > 0 ||
    Object.keys(override.checkinAgendas).length > 0
  )
}

function indexBy(
  overrides: readonly CatalogueOverride[],
  kind: 'goal' | 'need',
): Map<string, CatalogueOverride> {
  return new Map(overrides.filter((override) => override.kind === kind).map((o) => [o.entryId, o]))
}

/**
 * The goal catalogue as it is actually in force.
 *
 * Disabled goals are dropped rather than flagged: the engine's contract is that it evaluates
 * every goal it is given, and a flag would mean every caller had to remember to check it. One
 * forgotten check is a goal that was switched off still being offered, which is worse than the
 * engine never hearing about it (Invariant 3 — behaviour is computed from what it is handed).
 */
export function effectiveGoals(
  catalogue: readonly GoalBlueprint[],
  overrides: readonly CatalogueOverride[],
): readonly GoalBlueprint[] {
  const byId = indexBy(overrides, 'goal')

  const result: GoalBlueprint[] = []

  for (const goal of catalogue) {
    const override = byId.get(goal.id)
    if (override === undefined) {
      result.push(goal)
      continue
    }
    if (!override.enabled) continue

    result.push({
      ...goal,
      name: override.name ?? goal.name,
      description: override.summary ?? goal.description,
      milestones: goal.milestones.map((milestone) => ({
        ...milestone,
        label: override.milestoneLabels[milestone.id] ?? milestone.label,
      })),
      checkins: goal.checkins.map((checkin) => {
        const agenda = override.checkinAgendas[checkinKey(checkin)]
        // An agenda edited down to nothing is a mistake, not an instruction to drop it.
        return agenda === undefined || agenda.length === 0 ? checkin : { ...checkin, agenda }
      }),
    })
  }

  return result
}

/** The need catalogue as it is actually in force. */
export function effectiveNeeds(
  catalogue: readonly NeedDefinition[],
  overrides: readonly CatalogueOverride[],
): readonly NeedDefinition[] {
  const byId = indexBy(overrides, 'need')

  const result: NeedDefinition[] = []

  for (const need of catalogue) {
    const override = byId.get(need.id)
    if (override === undefined) {
      result.push(need)
      continue
    }
    if (!override.enabled) continue

    result.push({
      ...need,
      name: override.name ?? need.name,
      framing: override.summary ?? need.framing,
      priority: override.priority ?? need.priority,
    })
  }

  return result
}
