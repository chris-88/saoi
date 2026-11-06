/**
 * Where a conversation has got to, computed rather than sensed.
 *
 * Everything else in this product follows one rule: the engine decides what is true and the
 * model decides how to say it. The conversation itself was the exception. Nothing knew whether
 * a customer had been understood yet, so nothing could say "not products, not yet", and a
 * transcript could run eight questions deep and then produce a product card with no goal, no
 * plan and no moment where anybody was asked what they actually wanted.
 *
 * So the arc is a state machine like any other. The stage is derived from the case, the
 * guidance for each stage is declared in one file, and the tools a turn is offered are the
 * tools that stage allows. A stage is never chosen by the model and never stored: it is read
 * off the case every turn, which means correcting a fact or changing their mind moves the
 * conversation back by itself.
 */

export const STAGES = [
  /** The first reply: react, say what this involves, and put the fork to them. */
  'opening',
  /** The fork is open and unanswered. Keep it open. */
  'direction',
  /** They want a plan, so now the discovery is worth doing. Life first, products later. */
  'discovering',
  /** Enough of the picture to put a plan together. Build it, show it, let them decide. */
  'planning',
  /**
   * The plan is theirs and the engine knows how their money should be arranged across
   * accounts. Show that, once, before offering anything one account at a time.
   */
  'arranging',
  /** Put the options in front of them: the kind of thing first, then the ones inside it. */
  'choosing',
  /** Something is started. Collect what it needs and get it submitted. */
  'applying',
] as const

export type Stage = (typeof STAGES)[number]

/** What the customer has chosen to do about their goal, when they have said. */
export type Approach = 'plan' | 'product'

export type StageContext = {
  /** How many times the customer has spoken. One means this is the first reply. */
  readonly customerTurns: number
  /**
   * Facts the primary goal still wants.
   *
   * Only consulted on the plan branch, where it decides whether there is enough of a picture
   * to put a plan together. It has no say over the fork: asking somebody whether they want a
   * plan costs them one sentence and does not require knowing anything about them.
   */
  readonly goalGaps: number
  /** `goals.approach`, once they have answered the fork. */
  readonly approach: Approach | null
  /** A plan they have kept, as opposed to one merely proposed. */
  readonly planAccepted: boolean
  /**
   * The savings engine has an arrangement for their money, from the facts held.
   *
   * Only true when there is a lump sum or a monthly amount to arrange and at least two
   * accounts that fit; one account is a recommendation, and the comparison card does those.
   */
  readonly arrangement: boolean
  /** It has already been put on screen. Derived from the persisted cards, never stored. */
  readonly arrangementShown: boolean
  /** Applications on the case, in any state. */
  readonly applications: number
}

/**
 * The stage, in order of precedence.
 *
 * Ordered rather than scored, so that reading the list tells you exactly what happens and a
 * test can cover every branch. First match wins.
 */
export function stageFor(context: StageContext): Stage {
  // Something is under way. Everything else is behind them.
  if (context.applications > 0) return 'applying'

  /*
   * A plan they kept, and money the engine knows how to arrange: that comes before any
   * single product is offered.
   *
   * This is the moment a live conversation got the wrong way round. Saoirse offered a choice of
   * two savings accounts, and the customer replied with the right answer worked out alone:
   * the lump sum locked away, €200 a month for the bonus, the rest where it earns most. The
   * bank should not need to be told. Once, because the card persists and the stage reads it.
   */
  if (context.planAccepted && context.arrangement && !context.arrangementShown) {
    return 'arranging'
  }

  // They have a plan they kept, or they said they just want the product. Either way, choose.
  if (context.planAccepted || context.approach === 'product') return 'choosing'

  /*
   * The plan branch, and the only branch that earns a discovery.
   *
   * This used to run before the fork, which is how a conversation about buying a first home
   * became four turns of mortgage qualification: price, deposit, monthly saving, salary
   * accounts, gifted deposit, incomes, existing loans. All reasonable questions, none of them
   * asked for by anybody. Somebody who only wanted a savings account had to sit through the
   * lot before being offered one.
   */
  if (context.approach === 'plan') {
    return context.goalGaps > MAX_GAPS_FOR_PLAN ? 'discovering' : 'planning'
  }

  // Nothing chosen yet. The first reply opens it; anything after that is still the fork.
  return context.customerTurns <= 1 ? 'opening' : 'direction'
}

/**
 * How much may still be unknown when a plan is put together.
 *
 * Two, measured against the goal catalogue. A plan is not an application: it needs enough of
 * the picture to be worth the paper, not every figure the eventual products will want. Holding
 * out for all of them turns the one branch somebody actively asked for into the interrogation
 * they were trying to avoid.
 */
export const MAX_GAPS_FOR_PLAN = 2

/** Whether a stage is allowed to put a product in front of somebody. */
export function mayOfferProducts(stage: Stage): boolean {
  return stage === 'arranging' || stage === 'choosing' || stage === 'applying'
}

/** Whether a stage is allowed to propose a plan. */
export function mayProposePlan(stage: Stage): boolean {
  return stage === 'planning'
}
