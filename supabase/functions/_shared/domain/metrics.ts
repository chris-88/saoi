import { factCatalogue, type ApplicationId, type Fact, type FactKey } from './facts.ts'
import type { JourneyEvaluation } from './requirements.ts'

/**
 * POC success measures (§66), derived from controlled data rather than asserted.
 *
 * The headline measure is questions avoided through shared context (§53).
 */

export type ApplicationEvaluation = {
  readonly applicationId: ApplicationId
  readonly evaluation: JourneyEvaluation
}

/**
 * §53 — how many duplicated questions the customer never had to answer.
 *
 * One count per requirement that was satisfied without asking inside that application:
 * a bank-held value, a value captured in general conversation, or one captured for a
 * different application. The §53 example — address asked once and reused across four
 * further journeys — comes out as 4.
 */
export function questionsAvoided(applications: readonly ApplicationEvaluation[]): number {
  let total = 0
  for (const { evaluation } of applications) {
    for (const item of evaluation.satisfied) {
      if (item.reused) total += 1
    }
  }
  return total
}

export type ReuseEntry = {
  readonly key: FactKey
  readonly label: string
  readonly timesReused: number
}

/**
 * Which facts did the most work, most reused first. This is what makes reuse legible in the
 * admin console and on screen.
 */
export function reuseByFactKey(
  applications: readonly ApplicationEvaluation[],
): readonly ReuseEntry[] {
  const counts = new Map<FactKey, number>()

  for (const { evaluation } of applications) {
    for (const item of evaluation.satisfied) {
      if (!item.reused) continue
      if (item.requirement.kind !== 'fact') continue
      const key = item.requirement.fact
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([key, timesReused]) => ({ key, label: factCatalogue[key].label, timesReused }))
    .sort((a, b) => b.timesReused - a.timesReused || a.key.localeCompare(b.key))
}

/**
 * §66 — how much distinct information the customer actually supplied. A corrected value
 * supersedes the old one and counts once.
 */
export function uniqueFactsCollected(facts: readonly Fact[]): number {
  const seen = new Set<string>()
  for (const fact of facts) {
    if (fact.supersededBy !== null) continue
    seen.add(`${fact.key}::${String(fact.subject)}`)
  }
  return seen.size
}

/** §66 — how many applications the case actually moved forward. */
export function applicationsProgressed(
  applications: readonly { readonly state: string }[],
): number {
  return applications.filter((a) => a.state !== 'not_started').length
}
