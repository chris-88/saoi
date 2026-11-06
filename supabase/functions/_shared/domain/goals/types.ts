import type { FactKey } from '../facts.ts'
import type { FactReader, Product } from '../journey.ts'
import type { ApplicationState } from '../state-machine.ts'
import type { SignalStrength } from '../needs/types.ts'
import type { PlanStatus } from '../plans/types.ts'

/**
 * The Goal Engine — where the customer is trying to get to.
 *
 * Banking organises customers around products. Needs added intent: what is required. A goal
 * adds destination, which is what makes a mortgage, a joint account, a savings account and a
 * deferred loan one objective rather than five unrelated applications.
 *
 *     Life circumstance → Goal → Milestones → Needs → Actions → Products → Applications
 *
 * Three rules shape everything here.
 *
 * A blueprint is not a plan (§18). The catalogue holds reusable definitions; a customer's plan
 * is a separate stored object that references one. Nothing customer-specific belongs in this
 * folder.
 *
 * Discovery is not activation (§6). The engine may be certain a goal applies and still have no
 * business creating a plan — that needs the customer to say yes, which is an event, not an
 * inference (Invariant 1).
 *
 * Signals are conditions, not phrases (§5). The catalogue document describes signals as things
 * a customer might say; matching those strings would make this a keyword engine. Extraction
 * turns language into facts, and this turns facts into goals.
 */

/**
 * Which revision of the catalogue document this folder was translated from.
 *
 * The console shows it because "where did this come from" is a fair question about a list of
 * twenty-six objectives, and the honest answer is a document rather than anybody's judgement
 * on the day. `docs/goal-catalogue/README.md`.
 */
export const GOAL_CATALOGUE_VERSION = '1.0'

export const GOAL_CATEGORIES = [
  'foundations',
  'saving',
  'housing',
  'family',
  'education',
  'major_purchase',
  'life_transition',
  'wealth',
  'retirement',
  'international',
] as const

export type GoalCategory = (typeof GOAL_CATEGORIES)[number]

/**
 * Every goal in catalogue v1.0, plus `other`.
 *
 * `other` is not in the catalogue and is deliberately kept: a customer's objective does not
 * have to be one of twenty-six, and a plan for something unlisted is better than a plan filed
 * under the nearest wrong heading. It has no blueprint, so it carries no milestones.
 */
export const GOAL_IDS = [
  // foundations
  'organise_day_to_day_finances',
  'build_emergency_fund',
  'reduce_debt',
  // saving
  'save_for_defined_purchase',
  'rebuild_savings_after_home_purchase',
  // housing
  'buy_first_home',
  'move_home',
  'switch_mortgage',
  'renovate_home',
  // family
  'shared_household_finances',
  'prepare_for_baby',
  'save_for_child',
  'family_protection',
  'income_resilience',
  // life transitions
  'start_career',
  'deal_with_income_change',
  'financial_difficulty_recovery',
  'separate_finances',
  // wealth
  'manage_lump_sum',
  'start_investing',
  // retirement
  'start_pension',
  'prepare_for_retirement',
  'transition_to_retirement',
  // education and major purchases
  'fund_education',
  'buy_car',
  // international
  'move_to_ireland',
  'international_money',

  'other',
] as const

export type GoalId = (typeof GOAL_IDS)[number]

export function isGoalId(value: unknown): value is GoalId {
  return typeof value === 'string' && (GOAL_IDS as readonly string[]).includes(value)
}

/**
 * What kind of thing a milestone is (§8).
 *
 * Separate from `MilestoneKind` in the plans domain, which says how the engine can tell it has
 * happened. A deposit target is `financial` in kind and `numeric` in mechanism; a baby being
 * born is `life` in kind and only the customer can confirm it.
 */
export const MILESTONE_CATEGORIES = ['financial', 'life', 'process'] as const
export type MilestoneCategory = (typeof MILESTONE_CATEGORIES)[number]

/**
 * How the engine can tell a milestone has been reached, with no stored progress anywhere.
 *
 * `fraction` is of the plan's agreed target rather than an absolute figure, because a blueprint
 * has no idea what anybody's deposit is. A target of €60,000 with `fraction: 0.5` becomes
 * "deposit reaches €30,000" when the plan is created.
 */
export type MilestoneBinding =
  | { readonly kind: 'numeric'; readonly fraction: number }
  | { readonly kind: 'application'; readonly product: Product; readonly state: ApplicationState }
  | { readonly kind: 'date' }
  /**
   * Reached once the case can answer all of these.
   *
   * Most milestones in the catalogue are of the form "equity position understood", "debts
   * understood", "pension position understood" — which is not a tick box, it is whether the
   * information exists. Binding them to fact keys makes them computed rather than remembered,
   * the same way application requirements are (Invariant 3), and means progress on a plan moves
   * as the conversation happens instead of waiting for somebody to mark it.
   */
  | { readonly kind: 'facts'; readonly keys: readonly FactKey[] }

export type GoalMilestone = {
  readonly id: string
  readonly label: string
  readonly category: MilestoneCategory
  readonly required: boolean
  /**
   * Null when nothing in the case can evidence it, which makes it the customer's to confirm.
   * A milestone the engine cannot evaluate is still worth having on the plan — "property
   * selected" is real progress — it is simply not something the bank gets to decide.
   */
  readonly binding: MilestoneBinding | null
}

/**
 * Something that may work against another active objective (§7).
 *
 * Named rather than inferred, so the conflict Saoirse raises is always one the catalogue states.
 */
export const CONFLICT_IDS = [
  'new_unsecured_borrowing_before_mortgage_complete',
  'active_mortgage_affordability',
  'new_discretionary_borrowing',
] as const

export type ConflictId = (typeof CONFLICT_IDS)[number]

export type GoalRelationships = {
  /** Commonly occur alongside this goal. */
  readonly related: readonly GoalId[]
  /** Normally resolved first. */
  readonly prerequisites: readonly GoalId[]
  /** Commonly relevant once this one completes. */
  readonly followOn: readonly GoalId[]
  readonly conflicts: readonly ConflictId[]
}

/**
 * A planned reason to speak again, as a default the customer can change (§15).
 *
 * The agenda is written here, with the blueprint, and copied onto the plan when the check-in is
 * created. A check-in whose reason is invented at the moment of contact is an engagement
 * trigger wearing a different hat, so a blueprint check-in without an agenda is not a
 * check-in — hence a required field rather than an optional one.
 */
export type GoalCheckin =
  | {
      readonly kind: 'scheduled'
      readonly everyMonths: number
      readonly purpose: string
      readonly agenda: readonly string[]
    }
  | {
      readonly kind: 'event'
      readonly event: string
      readonly purpose: string
      readonly agenda: readonly string[]
    }

/** A condition over the case that is evidence for a goal. Never a phrase to match (§5). */
export type GoalSignal = {
  readonly id: string
  readonly strength: SignalStrength
  /** In the customer's terms. This is what the audit trail and the console show. */
  readonly describe: string
  readonly when: (context: GoalContext) => boolean
  /**
   * The customer naming this goal themselves, as opposed to circumstances implying it.
   *
   * This is what decides which of several well-evidenced goals is the primary one. Someone who
   * has a new baby, separate finances and a deposit half saved has three real goals; the one
   * they came to talk about is the one they said out loud, and ranking by confidence would pick
   * whichever happened to have the most corroboration instead (§21).
   */
  readonly declaration?: true
}

/** A reason not to raise a goal, however well evidenced. */
export type GoalSuppression = {
  readonly id: string
  readonly describe: string
  readonly when: (context: GoalContext) => boolean
}

/**
 * A reason the goal is right and now is wrong (§14).
 *
 * Distinct from suppression: a deferred goal is remembered and returned to, which is the whole
 * concierge claim. Renovating is not a bad idea because a mortgage is being assessed; it is a
 * bad time to commit to borrowing for it.
 */
export type GoalDeferral = {
  readonly id: string
  readonly describe: string
  readonly when: (context: GoalContext) => boolean
  /** What has to happen before it is worth raising again. */
  readonly revisitWhen: string
}

export type GoalBlueprint = {
  readonly id: GoalId
  readonly name: string
  readonly category: GoalCategory
  readonly description: string
  readonly signals: readonly GoalSignal[]
  /** Fact keys the goal needs before it can be planned properly, in the order worth asking. */
  readonly informationNeeded: readonly FactKey[]
  readonly milestones: readonly GoalMilestone[]
  readonly relationships: GoalRelationships
  /** Implemented needs this goal routes to. A goal with none is understood and tracked only. */
  readonly linkedNeeds: readonly string[]
  readonly checkins: readonly GoalCheckin[]
  /** Milestone ids whose achievement completes the goal. */
  readonly completion: readonly string[]
  readonly suppressions: readonly GoalSuppression[]
  readonly deferrals: readonly GoalDeferral[]
  /**
   * Which financial resource the goal draws on, for the double-counting check (§10). Null when
   * it competes for nothing — understanding your cashflow costs no money.
   */
  readonly draws: 'savings' | 'borrowing_capacity' | null
}

/**
 * A common circumstance that creates several possible goals (§11).
 *
 * A life event is not a plan. It is a reason to consider a handful of goals, and the engine
 * treats it as exactly that: matching a cluster contributes evidence to its candidates and
 * decides nothing.
 */
export type LifeEventCluster = {
  readonly id: string
  readonly name: string
  readonly signals: readonly {
    readonly id: string
    readonly describe: string
    readonly when: (context: GoalContext) => boolean
  }[]
  readonly primary: readonly GoalId[]
  readonly secondary: readonly GoalId[]
  readonly deferred: readonly GoalId[]
  /** Carried into the digest so the warning travels with the suggestion. */
  readonly note: string | null
}

/** Everything the engine may look at. Facts, applications and plan decisions — never conversation. */
export type GoalContext = {
  readonly facts: FactReader
  readonly applications: readonly {
    readonly product: Product
    readonly state: ApplicationState
  }[]
  /**
   * §50 — the gate judged this turn a sensitive disclosure. Not a fact, because a health
   * disclosure is the one thing the fact catalogue refuses to record (Invariant 6).
   */
  readonly sensitiveDisclosure: boolean
  /** Plans that already exist. A goal with a plan is settled, not a candidate. */
  readonly plans: readonly {
    readonly goal: GoalId
    readonly status: PlanStatus
    readonly targetAmount: number | null
    readonly short: number | null
  }[]
  readonly today: string
}

/**
 * Where a candidate stands. Ordered most to least pressing, which is also the order the digest
 * presents them in.
 *
 * `planned` is listed as a tier rather than an absence so the console can show that the goal
 * was recognised and acted on, instead of it silently disappearing from the list.
 */
export const GOAL_TIERS = [
  'primary',
  'strong_related',
  'secondary',
  'latent',
  'deferred',
  'suppressed',
  'planned',
] as const

export type GoalTier = (typeof GOAL_TIERS)[number]

export type GoalEvidence = {
  readonly signal: string
  readonly strength: SignalStrength
  readonly describe: string
}

export type GoalCandidate = {
  readonly goal: GoalBlueprint
  readonly tier: GoalTier
  /** 0 to 1, combined across signals by the same noisy-or the Needs Engine uses. */
  readonly confidence: number
  readonly evidence: readonly GoalEvidence[]
  /** Clusters that contributed. Shown as "because you mentioned a new baby". */
  readonly clusters: readonly string[]
  /** Set when deferred or suppressed, so the reason can be explained rather than guessed. */
  readonly reason: string | null
  /** Set when deferred: what has to happen before this is worth raising again. */
  readonly revisitWhen: string | null
  /** Fact keys the goal still needs before it could be planned properly. */
  readonly missing: readonly FactKey[]
}

/**
 * Two goals reaching for the same money (§10).
 *
 * Not a thing the engine resolves. The customer decides what their €40,000 is for; the engine's
 * job is to notice that it has been promised twice and say so.
 */
export type GoalContention = {
  readonly resource: 'savings' | 'borrowing_capacity'
  readonly goals: readonly GoalId[]
  readonly needed: number
  readonly available: number
  readonly describe: string
}

/** POC thresholds, matching the Needs Engine so the two agree about what "established" means. */
export const GOAL_THRESHOLDS = {
  secondary: 0.5,
  strong: 0.75,
} as const
