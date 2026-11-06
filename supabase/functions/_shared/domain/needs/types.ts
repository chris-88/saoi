import type { FactReader } from '../journey.ts'
import type { Product } from '../journey.ts'
import type { ApplicationState } from '../state-machine.ts'

/**
 * The Needs Engine — conversation to customer need to relevant option.
 *
 * Saoirse detects needs, not keywords. A customer saying "we just had a baby" is evidence that may
 * contribute to several needs — family protection, shared finances, saving for a child — and
 * what gets asked, surfaced or held back is decided here rather than by the model.
 *
 * This is the same split the rest of the domain uses: the engine decides what is true and what
 * is appropriate, the model decides how to say it (Invariant 3).
 */

/**
 * Four of these are computed from evidence every time, and four are remembered because the
 * customer or the bank decided something. Nothing that was decided is ever re-derived, and
 * nothing derived is ever stored.
 */
export const COMPUTED_NEED_STATES = ['latent', 'clarify', 'ready_to_surface', 'suppressed'] as const
export const RECORDED_NEED_STATES = ['surfaced', 'accepted', 'declined', 'deferred'] as const

export const NEED_STATES = [...COMPUTED_NEED_STATES, ...RECORDED_NEED_STATES] as const

export type ComputedNeedState = (typeof COMPUTED_NEED_STATES)[number]
export type RecordedNeedState = (typeof RECORDED_NEED_STATES)[number]
export type NeedState = (typeof NEED_STATES)[number]

/** How much a single piece of evidence is worth on its own. */
export const SIGNAL_STRENGTHS = {
  /** The customer said it. "I want a mortgage." */
  explicit: 1.0,
  /** Circumstances strongly associated with the need; normally clarify before surfacing. */
  strong_inferred: 0.7,
  /** Supporting context, never enough alone. "We got married last month." */
  soft_inferred: 0.35,
} as const

export type SignalStrength = keyof typeof SIGNAL_STRENGTHS

export const NEED_PRIORITIES = ['low', 'medium', 'high', 'very_high'] as const
export type NeedPriority = (typeof NEED_PRIORITIES)[number]

/** Everything the engine is allowed to look at. Facts and state, never raw conversation. */
export type NeedContext = {
  readonly facts: FactReader
  readonly applications: readonly {
    readonly product: Product
    readonly state: ApplicationState
  }[]
  /**
   * §50 — the gate judged this turn a sensitive disclosure.
   *
   * Not a fact, and deliberately so: a health disclosure is the one thing the catalogue
   * refuses to record (Invariant 6), so nothing in the case can evidence it. The gate sees the
   * message and the engine sees only this flag, which is enough to know that now is not the
   * moment to sell anybody protection.
   */
  readonly sensitiveDisclosure: boolean
  /** What the customer or the bank has already settled about a need. */
  readonly decisions: readonly {
    readonly needId: string
    readonly state: RecordedNeedState
  }[]
}

/**
 * A condition over the case, not a phrase to match.
 *
 * The catalogue describes signals as things a customer might say; matching those strings would
 * make this a keyword engine, which is the one thing the design rules out. So a signal is a
 * predicate over facts the extraction step has already recorded — which is also what makes
 * "why did this need appear" answerable with something better than a guess.
 */
export type NeedSignal = {
  readonly id: string
  readonly strength: SignalStrength
  /** In the customer's terms. This is what the audit trail shows. */
  readonly describe: string
  readonly when: (context: NeedContext) => boolean
}

/** A reason not to surface something, however well evidenced it is. */
export type NeedSuppression = {
  readonly id: string
  readonly describe: string
  readonly when: (context: NeedContext) => boolean
}

/**
 * A reason to hold a need rather than drop it. The need stays, its moment does not.
 *
 * Distinct from suppression: a deferred need is still relevant and the customer may still
 * choose it — a mortgage in assessment does not make a kitchen loan a bad idea, it makes now a
 * bad time to commit to one. §7, §12.
 */
export type NeedDeferral = {
  readonly id: string
  readonly describe: string
  readonly when: (context: NeedContext) => boolean
}

export type NeedDefinition = {
  readonly id: string
  readonly name: string
  readonly family: string
  /** §13 — protection and health. Never inferred commercially from a disclosure. */
  readonly sensitive: boolean
  readonly priority: NeedPriority
  readonly signals: readonly NeedSignal[]
  /** Asked in order, skipping any the case can already answer. */
  readonly clarifying: readonly {
    readonly question: string
    readonly answeredWhen: (context: NeedContext) => boolean
  }[]
  /**
   * Products with a journey, so the need can become an application. A need with none is
   * explained and nothing more, which is most of them.
   */
  readonly products: readonly Product[]
  /** Approved wording. Saoirse phrases around it; Saoirse does not invent the claim (§51). */
  readonly framing: string
  readonly suppressions: readonly NeedSuppression[]
  readonly deferrals: readonly NeedDeferral[]
}

export type NeedEvidence = {
  readonly signal: string
  readonly strength: SignalStrength
  readonly describe: string
}

export type NeedCandidate = {
  readonly need: NeedDefinition
  readonly state: NeedState
  /** 0 to 1. Combined across signals; see `combineConfidence`. */
  readonly confidence: number
  readonly evidence: readonly NeedEvidence[]
  /** Set when the state is `suppressed` or `deferred`, so the reason can be explained. */
  readonly reason: string | null
  /** The next thing worth asking, or null when nothing is outstanding. */
  readonly nextQuestion: string | null
}

/** POC defaults (§5). Not permanent policy; the engine reads them from here. */
export const NEED_THRESHOLDS = {
  clarify: 0.5,
  surface: 0.75,
} as const
