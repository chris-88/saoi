import type { FactKey } from '../facts.ts'
import { combineConfidence } from '../needs/engine.ts'
import type { SignalStrength } from '../needs/types.ts'
import { goalCatalogue } from './catalogue.ts'
import { lifeEventClusters } from './clusters.ts'
import {
  GOAL_THRESHOLDS,
  type GoalBlueprint,
  type GoalCandidate,
  type GoalContention,
  type GoalContext,
  type GoalEvidence,
  type GoalId,
  type GoalTier,
  type LifeEventCluster,
} from './types.ts'

/**
 * Goal discovery.
 *
 * Confidence is the same noisy-or the Needs Engine uses, imported rather than reimplemented so
 * the two cannot drift into disagreeing about what "established" means. What this adds on top is
 * everything the Needs Engine has no view of: that goals arrive in clusters, that only one of
 * them is what the customer actually came to talk about, that some are right but mistimed, and
 * that two of them can quietly lay claim to the same money.
 *
 * Nothing here activates anything. Every function returns a reading of the case; creating a plan
 * takes the customer saying yes (§6, Invariant 1).
 */

/** Clusters whose circumstances the case evidences. */
export function matchedClusters(context: GoalContext): readonly LifeEventCluster[] {
  return lifeEventClusters.filter((cluster) =>
    cluster.signals.some((signal) => signal.when(context)),
  )
}

type ClusterEvidence = {
  readonly evidence: readonly GoalEvidence[]
  readonly clusters: readonly string[]
  readonly clusterDeferred: boolean
}

/**
 * What a matched life event contributes to one goal.
 *
 * A cluster is a reason to consider a goal, never a reason to conclude it. So it contributes
 * evidence and nothing else: the goal it names as primary gets inferred support, the ones it
 * names as secondary get background, and the tiering is still decided by the engine below. This
 * is what stops "we just had a baby" turning into six plans (§13).
 */
function fromClusters(goal: GoalBlueprint, matched: readonly LifeEventCluster[]): ClusterEvidence {
  const evidence: GoalEvidence[] = []
  const clusters: string[] = []
  let clusterDeferred = false

  for (const cluster of matched) {
    const strength: SignalStrength | null = cluster.primary.includes(goal.id)
      ? 'strong_inferred'
      : cluster.secondary.includes(goal.id) || cluster.deferred.includes(goal.id)
        ? 'soft_inferred'
        : null

    if (strength === null) continue

    clusters.push(cluster.id)
    if (cluster.deferred.includes(goal.id)) clusterDeferred = true

    evidence.push({
      signal: `cluster:${cluster.id}`,
      strength,
      describe: cluster.name.toLowerCase(),
    })
  }

  return { evidence, clusters, clusterDeferred }
}

/**
 * The catalogue a call should use.
 *
 * Defaulted rather than required so every existing caller and test keeps working, and so the
 * compiled catalogue stays the answer when nobody has edited anything. The one caller that
 * passes something else is `saoirse-turn`, which hands over the catalogue with the admin overlay
 * already applied (`domain/catalogue/overlay.ts`).
 */
type Catalogue = readonly GoalBlueprint[]

/**
 * Every goal in the catalogue, with where it stands and why.
 *
 * All of them, not only the interesting ones: "why was this never mentioned to me" is as fair a
 * question as "why was this suggested", and the console has to be able to answer both (§19).
 */
export function evaluateGoals(
  context: GoalContext,
  catalogue: Catalogue = goalCatalogue,
): readonly GoalCandidate[] {
  const matched = matchedClusters(context)

  const unranked = catalogue.map((goal) => {
    const own = goal.signals.filter((signal) => signal.when(context))
    const cluster = fromClusters(goal, matched)

    const evidence: readonly GoalEvidence[] = [
      ...own.map((signal) => ({
        signal: signal.id,
        strength: signal.strength,
        describe: signal.describe,
      })),
      ...cluster.evidence,
    ]

    const confidence = combineConfidence(evidence.map((item) => item.strength))
    const declared = own.some((signal) => signal.declaration === true)
    // Household or person: the engine does not care which subject holds it, only whether the
    // case can answer the question at all.
    const missing = goal.informationNeeded.filter(
      (key) => !context.facts.has(key, 'household') && !context.facts.has(key, 'primary'),
    )

    return { goal, evidence, confidence, declared, cluster, missing }
  })

  /**
   * One primary at most, and only ever a goal the customer named themselves.
   *
   * There is deliberately no fallback to the best-evidenced goal. "What they came in about" is a
   * claim about what they said, and ranking by confidence would put those words in their mouth —
   * the console showed "organise money together" under that heading for a customer who had only
   * ever mentioned buying a house, because the house already had a plan and something had to come
   * first. Nothing has to come first. A case with no stated objective has no primary goal, and
   * the related ones are still there to work with.
   */
  const contenders = unranked.filter(
    (item) =>
      item.confidence >= GOAL_THRESHOLDS.strong &&
      !settled(item.goal.id, context) &&
      !item.goal.suppressions.some((rule) => rule.when(context)) &&
      !item.cluster.clusterDeferred &&
      !item.goal.deferrals.some((rule) => rule.when(context)),
  )

  const primary =
    contenders
      .filter((item) => item.declared)
      // Corroboration breaks the tie, because a declared goal is already at full confidence and
      // several can be. Of two goals the customer named, the one the rest of the case supports is
      // the one they are actually working on.
      .sort((a, b) => b.confidence - a.confidence || b.evidence.length - a.evidence.length)[0] ??
    null

  return unranked.map((item): GoalCandidate => {
    const { goal, evidence, confidence, cluster, missing } = item

    if (settled(goal.id, context)) {
      return candidate(item, 'planned', 'they already have a plan for this', null)
    }

    /**
     * Nothing points at this goal, so there is nothing to suppress or defer.
     *
     * Suppression and deferral both describe a goal the case has some reason to believe in:
     * "we are not raising this, and here is why". Applying them to a goal with no evidence
     * fills the console with reasons for silence about things nobody was going to mention,
     * and buries the handful that matter. A goal with no evidence is simply latent.
     */
    const evidenced = confidence >= GOAL_THRESHOLDS.secondary || cluster.clusterDeferred
    if (!evidenced) {
      return {
        goal,
        tier: 'latent',
        confidence,
        evidence,
        clusters: cluster.clusters,
        reason: null,
        revisitWhen: null,
        missing,
      }
    }

    const suppressed = goal.suppressions.find((rule) => rule.when(context))
    if (suppressed) return candidate(item, 'suppressed', suppressed.describe, null)

    const deferral = goal.deferrals.find((rule) => rule.when(context))
    if (deferral) return candidate(item, 'deferred', deferral.describe, deferral.revisitWhen)

    const unmet = unmetPrerequisite(goal, context)
    if (unmet !== null) {
      return candidate(
        item,
        'deferred',
        `${unmet.name.toLowerCase()} normally comes first`,
        `they have made progress on ${unmet.name.toLowerCase()}`,
      )
    }

    // A cluster that lists a goal as deferred is saying the circumstance makes it foreseeable
    // and premature at once — the kitchen loan a first-time buyer should not take out yet.
    if (cluster.clusterDeferred) {
      return candidate(
        item,
        'deferred',
        'this usually comes later in the situation they are in, not now',
        'they have finished what they are working on',
      )
    }

    const tier: GoalTier =
      primary !== null && primary.goal.id === goal.id
        ? 'primary'
        : confidence >= GOAL_THRESHOLDS.strong
          ? 'strong_related'
          : 'secondary'

    return {
      goal,
      tier,
      confidence,
      evidence,
      clusters: cluster.clusters,
      reason: null,
      revisitWhen: null,
      missing,
    }
  })
}

function candidate(
  item: {
    goal: GoalBlueprint
    evidence: readonly GoalEvidence[]
    confidence: number
    cluster: ClusterEvidence
    missing: readonly FactKey[]
  },
  tier: GoalTier,
  reason: string | null,
  revisitWhen: string | null,
): GoalCandidate {
  return {
    goal: item.goal,
    tier,
    confidence: item.confidence,
    evidence: item.evidence,
    clusters: item.cluster.clusters,
    reason,
    revisitWhen,
    missing: item.missing,
  }
}

/** A goal the customer has already decided about, one way or the other. */
function settled(id: GoalId, context: GoalContext): boolean {
  return context.plans.some(
    (plan) => plan.goal === id && ['draft', 'active', 'paused', 'completed'].includes(plan.status),
  )
}

/**
 * A goal the catalogue says normally comes after another one.
 *
 * "Normally" is doing work: this defers rather than blocks, and a customer who wants to invest
 * before their reserve is full is still allowed to. The engine's job is to say so, once.
 */
function unmetPrerequisite(goal: GoalBlueprint, context: GoalContext): GoalBlueprint | null {
  for (const id of goal.relationships.prerequisites) {
    const satisfied = context.plans.some(
      (plan) => plan.goal === id && ['active', 'completed'].includes(plan.status),
    )
    if (satisfied) continue

    const blueprint = goalCatalogue.find((item) => item.id === id)
    if (blueprint !== undefined) return blueprint
  }

  return null
}

// ---------------------------------------------------------------------------
// Reading the result
// ---------------------------------------------------------------------------

export function primaryGoal(candidates: readonly GoalCandidate[]): GoalCandidate | null {
  return candidates.find((candidate_) => candidate_.tier === 'primary') ?? null
}

export function inTier(
  candidates: readonly GoalCandidate[],
  tier: GoalTier,
): readonly GoalCandidate[] {
  return candidates
    .filter((candidate_) => candidate_.tier === tier)
    .sort((a, b) => b.confidence - a.confidence)
}

/**
 * What is worth putting in front of the customer, in order, and nothing more.
 *
 * Capped deliberately. The acceptance test in §21 produces eight candidates from one sentence,
 * and reciting eight is how a concierge turns back into a product menu. The rest stay in the
 * case as context, which is the point of recording them at all.
 */
export function worthRaising(
  candidates: readonly GoalCandidate[],
  limit = 3,
): readonly GoalCandidate[] {
  return [
    ...inTier(candidates, 'primary'),
    ...inTier(candidates, 'strong_related'),
    ...inTier(candidates, 'secondary'),
  ].slice(0, limit)
}

/** Right goal, wrong moment — kept so Saoirse can come back to it (§14). */
export function heldForLater(candidates: readonly GoalCandidate[]): readonly GoalCandidate[] {
  return inTier(candidates, 'deferred')
}

/** What tends to come next once a goal is done. Offered on completion, not before. */
export function followOnFor(
  id: GoalId,
  catalogue: Catalogue = goalCatalogue,
): readonly GoalBlueprint[] {
  const blueprint = catalogue.find((goal) => goal.id === id)
  if (blueprint === undefined) return []

  return blueprint.relationships.followOn
    .map((followOn) => catalogue.find((goal) => goal.id === followOn))
    .filter((goal): goal is GoalBlueprint => goal !== undefined)
}

/** Warnings the matched life events carry, so the caution travels with the suggestion. */
export function clusterNotes(context: GoalContext): readonly string[] {
  return matchedClusters(context)
    .map((cluster) => cluster.note)
    .filter((note): note is string => note !== null)
}

// ---------------------------------------------------------------------------
// Double counting (§10)
// ---------------------------------------------------------------------------

/**
 * The same money promised twice.
 *
 * Two plans both drawing on savings will each happily report the full balance as progress
 * towards their own target, and both will be wrong. The engine does not resolve this — how
 * somebody's €52,000 is divided between a deposit and an investment is their decision, not the
 * bank's (§10). It raises it so Saoirse can ask.
 */
export function contentionIn(context: GoalContext): readonly GoalContention[] {
  const live = context.plans.filter((plan) => plan.status === 'draft' || plan.status === 'active')
  const available = context.facts.number('assets.savingsBalance', 'household') ?? 0

  const contentions: GoalContention[] = []

  const competing = live.filter((plan) => {
    const blueprint = goalCatalogue.find((goal) => goal.id === plan.goal)
    return blueprint?.draws === 'savings' && plan.targetAmount !== null && plan.targetAmount > 0
  })

  if (competing.length >= 2) {
    const needed = competing.reduce((total, plan) => total + (plan.targetAmount ?? 0), 0)
    const names = competing.map((plan) => nameOf(plan.goal))

    contentions.push({
      resource: 'savings',
      goals: competing.map((plan) => plan.goal),
      needed,
      available,
      describe: `${names.join(' and ')} are both counting on the same savings.`,
    })
  }

  const borrowing = live.filter(
    (plan) => goalCatalogue.find((goal) => goal.id === plan.goal)?.draws === 'borrowing_capacity',
  )

  if (borrowing.length >= 2) {
    contentions.push({
      resource: 'borrowing_capacity',
      goals: borrowing.map((plan) => plan.goal),
      needed: 0,
      available: 0,
      describe: `${borrowing.map((plan) => nameOf(plan.goal)).join(' and ')} would both mean new borrowing.`,
    })
  }

  return contentions
}

/**
 * Whether adding this goal would put two plans in competition, asked before the plan exists.
 *
 * Checking after the fact would mean telling the customer about the clash in the same breath as
 * confirming the plan that caused it.
 */
export function wouldContend(
  context: GoalContext,
  goal: GoalId,
  targetAmount: number | null,
): boolean {
  const prospective: GoalContext = {
    ...context,
    plans: [...context.plans, { goal, status: 'draft', targetAmount, short: targetAmount }],
  }

  return contentionIn(prospective).length > contentionIn(context).length
}

function nameOf(id: GoalId): string {
  return goalCatalogue.find((goal) => goal.id === id)?.name ?? id.replaceAll('_', ' ')
}
