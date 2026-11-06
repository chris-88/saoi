import { needCatalogue } from './catalogue.ts'
import {
  NEED_THRESHOLDS,
  SIGNAL_STRENGTHS,
  type NeedCandidate,
  type NeedContext,
  type NeedDefinition,
  type NeedEvidence,
  type NeedState,
  type SignalStrength,
} from './types.ts'

/**
 * Evidence to confidence.
 *
 * Noisy-or: each signal independently fails to establish the need, and the need is established
 * if any of them succeeds. Several weak signals therefore add up without any one of them being
 * decisive, and nothing can exceed certainty however much evidence arrives.
 *
 * The alternatives both misbehave. A maximum ignores corroboration entirely — marriage plus
 * separate finances plus shared costs would score exactly the same as marriage alone. A sum
 * passes 1.0 on three soft signals and keeps going.
 *
 * Calibration: the design's worked example (§14) puts marriage, separate finances and shared
 * costs at about 0.85; this gives 0.87. Its other figures are illustrative rather than derived,
 * so they are not fitted to.
 */
export function combineConfidence(strengths: readonly SignalStrength[]): number {
  let notEstablished = 1

  for (const strength of strengths) {
    notEstablished *= 1 - SIGNAL_STRENGTHS[strength]
  }

  // Rounded because these are compared against thresholds and shown to people; carrying
  // floating-point noise into "0.7500000000000001 > 0.75" helps nobody.
  return Math.round((1 - notEstablished) * 1000) / 1000
}

/**
 * Every need the catalogue knows about, with its state, its evidence and its reason.
 *
 * Returns all of them rather than only the interesting ones: "why is this not being offered"
 * is as much a question the bank has to answer as "why is it" (§15).
 */
export function evaluateNeeds(
  context: NeedContext,
  /** Defaulted so every existing caller keeps working; `saoirse-turn` passes the overlaid catalogue. */
  catalogue: readonly NeedDefinition[] = needCatalogue,
): readonly NeedCandidate[] {
  return catalogue.map((need): NeedCandidate => {
    const matched = need.signals.filter((signal) => signal.when(context))

    const evidence: NeedEvidence[] = matched.map((signal) => ({
      signal: signal.id,
      strength: signal.strength,
      describe: signal.describe,
    }))

    const confidence = combineConfidence(matched.map((signal) => signal.strength))

    const unanswered = need.clarifying.find((item) => !item.answeredWhen(context))
    const nextQuestion = unanswered?.question ?? null

    // What the customer or the bank has already settled outranks anything derived. A declined
    // need does not come back because the evidence got stronger (§8, declined_product_cooling).
    const decided = context.decisions.find((decision) => decision.needId === need.id)
    if (decided) {
      return { need, state: decided.state, confidence, evidence, reason: null, nextQuestion }
    }

    // Suppression beats evidence outright: the need may be real and still must not be raised.
    const suppressed = need.suppressions.find((rule) => rule.when(context))
    if (suppressed) {
      return {
        need,
        state: 'suppressed',
        confidence,
        evidence,
        reason: suppressed.describe,
        nextQuestion: null,
      }
    }

    // Deferral is about timing, so it only applies to something that would otherwise be
    // offered. A latent need is not deferred, it is simply not established yet.
    const state = stateFor(confidence)
    if (state === 'ready_to_surface') {
      const deferred = need.deferrals.find((rule) => rule.when(context))
      if (deferred) {
        return {
          need,
          state: 'deferred',
          confidence,
          evidence,
          reason: deferred.describe,
          nextQuestion,
        }
      }
    }

    return { need, state, confidence, evidence, reason: null, nextQuestion }
  })
}

function stateFor(confidence: number): NeedState {
  if (confidence >= NEED_THRESHOLDS.surface) return 'ready_to_surface'
  if (confidence >= NEED_THRESHOLDS.clarify) return 'clarify'
  return 'latent'
}

/**
 * The single most useful thing to ask about next, or nothing.
 *
 * Best-evidenced first, because the question most likely to be worth asking is the one about
 * the need the case already half-supports. Suppressed needs are never asked about — asking is
 * surfacing by another route.
 */
export function nextToClarify(candidates: readonly NeedCandidate[]): NeedCandidate | null {
  const askable = candidates
    .filter((candidate) => candidate.state === 'clarify' && candidate.nextQuestion !== null)
    .sort((a, b) => b.confidence - a.confidence)

  return askable[0] ?? null
}

/** Ready now, best first. What Saoirse may actually offer. */
export function readyToSurface(candidates: readonly NeedCandidate[]): readonly NeedCandidate[] {
  const order = { very_high: 0, high: 1, medium: 2, low: 3 } as const

  return candidates
    .filter((candidate) => candidate.state === 'ready_to_surface')
    .sort((a, b) => order[a.need.priority] - order[b.need.priority] || b.confidence - a.confidence)
}

/** Relevant, but not now — kept so the customer can still choose it (§7). */
export function deferred(candidates: readonly NeedCandidate[]): readonly NeedCandidate[] {
  return candidates.filter((candidate) => candidate.state === 'deferred')
}
