import { describe, expect, it } from 'vitest'
import {
  clusterNotes,
  contentionIn,
  evaluateGoals,
  followOnFor,
  heldForLater,
  inTier,
  matchedClusters,
  primaryGoal,
  worthRaising,
  wouldContend,
} from './engine.ts'
import { goalCatalogue } from './catalogue.ts'
import { lifeEventClusters } from './clusters.ts'
import {
  GOAL_IDS,
  GOAL_THRESHOLDS,
  type GoalCandidate,
  type GoalContext,
  type GoalId,
} from './types.ts'
import { needCatalogue } from '../needs/catalogue.ts'
import { factCatalogue } from '../facts.ts'

/** A reader over a plain object, so a test can state the whole case in one literal. */
function contextOf(
  facts: Record<string, unknown>,
  extra: Partial<Omit<GoalContext, 'facts'>> = {},
): GoalContext {
  const read = (key: string, subject = 'household') => facts[`${key}:${subject}`] ?? facts[key]

  return {
    facts: {
      has: (key, subject) => read(key, subject) !== undefined,
      get: (key, subject) => read(key, subject),
      number: (key, subject) => {
        const value = read(key, subject)
        return typeof value === 'number' ? value : null
      },
      boolean: (key, subject) => {
        const value = read(key, subject)
        return typeof value === 'boolean' ? value : null
      },
    },
    applications: extra.applications ?? [],
    sensitiveDisclosure: extra.sensitiveDisclosure ?? false,
    plans: extra.plans ?? [],
    today: extra.today ?? '2026-10-06',
  }
}

const find = (candidates: readonly GoalCandidate[], id: GoalId) => {
  const match = candidates.find((candidate) => candidate.goal.id === id)
  if (match === undefined) throw new Error(`no candidate for ${id}`)
  return match
}

const ids = (candidates: readonly GoalCandidate[]) => candidates.map((c) => c.goal.id)

describe('the catalogue holds together', () => {
  it('defines every goal exactly once, and only ids the union knows', () => {
    const catalogued = goalCatalogue.map((goal) => goal.id)
    expect(new Set(catalogued).size).toBe(catalogued.length)
    for (const id of catalogued) expect(GOAL_IDS).toContain(id)
  })

  /** `other` is the escape hatch for an objective the catalogue does not cover (§18). */
  it('covers every goal id except the escape hatch', () => {
    const catalogued = new Set<string>(goalCatalogue.map((goal) => goal.id))
    expect(GOAL_IDS.filter((id) => !catalogued.has(id))).toEqual(['other'])
  })

  it('references only goals that exist', () => {
    const known = new Set<string>(goalCatalogue.map((goal) => goal.id))

    for (const goal of goalCatalogue) {
      const { related, prerequisites, followOn } = goal.relationships
      for (const id of [...related, ...prerequisites, ...followOn]) {
        expect(known, `${goal.id} -> ${id}`).toContain(id)
      }
      expect(related, `${goal.id} relates to itself`).not.toContain(goal.id)
    }
  })

  /**
   * A dangling need reference is a goal that looks like it routes to a product and does not.
   * Better to carry no linked need than one that resolves to nothing.
   */
  it('links only to needs that exist', () => {
    const known = new Set(needCatalogue.map((need) => need.id))
    for (const goal of goalCatalogue) {
      for (const id of goal.linkedNeeds) expect(known, `${goal.id} -> ${id}`).toContain(id)
    }
  })

  it('asks only for facts the catalogue defines', () => {
    for (const goal of goalCatalogue) {
      for (const key of goal.informationNeeded) expect(factCatalogue).toHaveProperty(key)
    }
    for (const goal of goalCatalogue) {
      for (const milestone of goal.milestones) {
        if (milestone.binding?.kind !== 'facts') continue
        for (const key of milestone.binding.keys) expect(factCatalogue).toHaveProperty(key)
      }
    }
  })

  it('completes on milestones it actually has', () => {
    for (const goal of goalCatalogue) {
      const milestoneIds = new Set(goal.milestones.map((milestone) => milestone.id))
      for (const id of goal.completion) expect(milestoneIds, `${goal.id}`).toContain(id)
    }
  })

  /** §15 — a check-in with no agenda is an engagement trigger, not a service. */
  it('gives every default check-in an agenda', () => {
    for (const goal of goalCatalogue) {
      for (const checkin of goal.checkins) {
        expect(checkin.agenda.length, `${goal.id}/${checkin.purpose}`).toBeGreaterThan(0)
      }
    }
  })

  it('points every cluster at goals that exist', () => {
    const known = new Set<string>(GOAL_IDS)
    for (const cluster of lifeEventClusters) {
      for (const id of [...cluster.primary, ...cluster.secondary, ...cluster.deferred]) {
        expect(known, `${cluster.id} -> ${id}`).toContain(id)
      }
    }
  })
})

describe('discovery is not activation (§6)', () => {
  it('recognises a goal from an explicit statement without creating anything', () => {
    const candidates = evaluateGoals(
      contextOf({ 'goals.primaryObjective': 'We want to buy our first home' }),
    )

    expect(find(candidates, 'buy_first_home').tier).toBe('primary')
    // Nothing in the engine can create a plan; the only evidence of one is the context it was
    // given. This is the whole of Invariant 1 as it applies here.
    expect(Object.keys(candidates[0] ?? {})).not.toContain('plan')
  })

  it('treats a goal with a plan as settled rather than a candidate again', () => {
    const candidates = evaluateGoals(
      contextOf(
        { 'goals.primaryObjective': 'buy our first home' },
        {
          plans: [{ goal: 'buy_first_home', status: 'active', targetAmount: 60_000, short: 8_000 }],
        },
      ),
    )

    expect(find(candidates, 'buy_first_home').tier).toBe('planned')
    expect(ids(worthRaising(candidates))).not.toContain('buy_first_home')
  })
})

describe('the customer decides what the conversation is about', () => {
  /**
   * Three goals can all be certain at once. Only one of them is why they got in touch, and it is
   * the one they said out loud — not whichever accumulated the most corroboration.
   */
  it('gives primary to the goal the customer named, not the best-evidenced one', () => {
    const candidates = evaluateGoals(
      contextOf({
        'goals.primaryObjective': 'we want to buy our first home',
        'lifeEvent.newChild': true,
        'household.dependantCount': 1,
        'expenditure.monthlyChildcare': 900,
        'identity.maritalStatus:primary': 'married',
        'household.financesManagedJointly': false,
      }),
    )

    expect(primaryGoal(candidates)?.goal.id).toBe('buy_first_home')
    expect(inTier(candidates, 'primary')).toHaveLength(1)
  })

  /**
   * A circumstance is not a declaration. Somebody having a new baby has told the bank a fact
   * about their life, not what they want to do about it — and "what they came in about" is a
   * claim about what they said.
   */
  it('has no primary goal when the customer has not named one', () => {
    const candidates = evaluateGoals(
      contextOf({ 'lifeEvent.newChild': true, 'expenditure.monthlyChildcare': 900 }),
    )

    expect(primaryGoal(candidates)).toBeNull()
    // Still plenty to work with: the goals are recognised, just not spoken for.
    expect(ids(worthRaising(candidates))).toContain('prepare_for_baby')
  })

  it('does not promote an unnamed goal when the one they named is already planned', () => {
    const candidates = evaluateGoals(
      contextOf(
        {
          'goals.primaryObjective': 'we want to buy our first home',
          'housing.firstTimeBuyer': true,
          'household.buyingWith': 'partner',
        },
        {
          plans: [{ goal: 'buy_first_home', status: 'active', targetAmount: 60_000, short: 8_000 }],
        },
      ),
    )

    expect(find(candidates, 'buy_first_home').tier).toBe('planned')
    expect(primaryGoal(candidates)).toBeNull()
    expect(find(candidates, 'shared_household_finances').tier).toBe('strong_related')
  })
})

describe('life-event clusters suggest, they do not decide (§11)', () => {
  it('matches a cluster from circumstances rather than phrases', () => {
    const matched = matchedClusters(contextOf({ 'lifeEvent.newChild': true }))
    expect(matched.map((cluster) => cluster.id)).toContain('NEW_BABY')
  })

  it('carries the cluster caution with the suggestion', () => {
    const notes = clusterNotes(
      contextOf({
        'identity.maritalStatus:primary': 'married',
        'household.financesManagedJointly': false,
      }),
    )
    expect(notes.join(' ')).toMatch(/do not assume joint banking/i)
  })

  /** §13 — six candidates is context. Six plans is a product push. */
  it('never raises more than a handful however much a life event implies', () => {
    const candidates = evaluateGoals(
      contextOf({
        'goals.primaryObjective': 'we just had our first baby',
        'lifeEvent.newChild': true,
        'household.dependantCount': 1,
        'expenditure.monthlyChildcare': 1_100,
        'identity.maritalStatus:primary': 'married',
        'household.financesManagedJointly': false,
      }),
    )

    const identified = candidates.filter((candidate) => candidate.tier !== 'latent')
    expect(identified.length).toBeGreaterThan(3)
    expect(worthRaising(candidates)).toHaveLength(3)
  })
})

describe('timing (§14)', () => {
  it('holds a renovation while the mortgage affordability is being assessed', () => {
    const candidates = evaluateGoals(
      contextOf(
        { 'goals.primaryObjective': 'we want to renovate the kitchen' },
        { applications: [{ product: 'mortgage', state: 'under_review' }] },
      ),
    )

    const renovate = find(candidates, 'renovate_home')
    expect(renovate.tier).toBe('deferred')
    expect(renovate.reason).toMatch(/affordability assessment/i)
    expect(renovate.revisitWhen).toBe('the mortgage completes')
    expect(ids(heldForLater(candidates))).toContain('renovate_home')
  })

  it('raises the same renovation once the mortgage is out of the way', () => {
    const candidates = evaluateGoals(
      contextOf(
        { 'goals.primaryObjective': 'we want to renovate the kitchen' },
        { applications: [{ product: 'mortgage', state: 'completed' }] },
      ),
    )

    expect(find(candidates, 'renovate_home').tier).toBe('primary')
  })

  it('defers rebuilding savings until there is something to rebuild from', () => {
    const candidates = evaluateGoals(
      contextOf(
        { 'goals.primaryObjective': 'build our savings back up' },
        { applications: [{ product: 'mortgage', state: 'submitted' }] },
      ),
    )

    expect(find(candidates, 'rebuild_savings_after_home_purchase').tier).toBe('deferred')
  })

  it('offers what comes next only as a follow-on, never alongside', () => {
    expect(followOnFor('buy_first_home').map((goal) => goal.id)).toEqual([
      'rebuild_savings_after_home_purchase',
      'renovate_home',
    ])
  })
})

describe('a disclosure is not an opportunity (Invariant 6, §13)', () => {
  it('suppresses protection on a turn the gate judged sensitive', () => {
    const candidates = evaluateGoals(
      contextOf(
        {
          'goals.primaryObjective': 'I was just diagnosed with something',
          'household.dependantCount': 2,
        },
        { sensitiveDisclosure: true },
      ),
    )

    const protection = find(candidates, 'family_protection')
    expect(protection.tier).toBe('suppressed')
    expect(protection.reason).toMatch(/disclosed in confidence/i)
    expect(ids(worthRaising(candidates))).not.toContain('family_protection')
  })

  it('still answers when the customer is the one asking about cover', () => {
    const candidates = evaluateGoals(
      contextOf(
        {
          'goals.primaryObjective': 'I want life cover in case anything happened to me',
          'household.dependantCount': 2,
        },
        { sensitiveDisclosure: true },
      ),
    )

    expect(find(candidates, 'family_protection').tier).toBe('primary')
  })

  it('puts support before credit when income has fallen', () => {
    const candidates = evaluateGoals(
      contextOf({
        'goals.primaryObjective': 'I want a loan to do up the kitchen',
        'lifeEvent.incomeChange': 'decrease',
      }),
    )

    expect(find(candidates, 'renovate_home').tier).toBe('suppressed')
    expect(find(candidates, 'renovate_home').reason).toMatch(/income has fallen/i)
  })
})

describe('the same money cannot be promised twice (§10)', () => {
  const twoSavingsPlans = contextOf(
    { 'assets.savingsBalance': 40_000 },
    {
      plans: [
        { goal: 'buy_first_home', status: 'active', targetAmount: 60_000, short: 20_000 },
        { goal: 'start_investing', status: 'active', targetAmount: 40_000, short: 0 },
      ],
    },
  )

  it('raises savings counted towards two goals at once', () => {
    const [contention] = contentionIn(twoSavingsPlans)
    expect(contention?.resource).toBe('savings')
    expect(contention?.goals).toEqual(['buy_first_home', 'start_investing'])
    expect(contention?.needed).toBe(100_000)
    expect(contention?.available).toBe(40_000)
    expect(contention?.describe).toMatch(/both counting on the same savings/i)
  })

  it('says nothing when only one goal draws on savings', () => {
    const single = contextOf(
      { 'assets.savingsBalance': 40_000 },
      {
        plans: [{ goal: 'buy_first_home', status: 'active', targetAmount: 60_000, short: 20_000 }],
      },
    )
    expect(contentionIn(single)).toEqual([])
  })

  it('ignores a plan the customer walked away from', () => {
    const abandoned = contextOf(
      { 'assets.savingsBalance': 40_000 },
      {
        plans: [
          { goal: 'buy_first_home', status: 'active', targetAmount: 60_000, short: 20_000 },
          { goal: 'start_investing', status: 'abandoned', targetAmount: 40_000, short: 0 },
        ],
      },
    )
    expect(contentionIn(abandoned)).toEqual([])
  })

  /** Asked before the plan exists, so the clash is not announced in the same breath as the plan. */
  it('can be asked before the second plan is created', () => {
    const one = contextOf(
      { 'assets.savingsBalance': 40_000 },
      {
        plans: [{ goal: 'buy_first_home', status: 'active', targetAmount: 60_000, short: 20_000 }],
      },
    )

    expect(wouldContend(one, 'start_investing', 40_000)).toBe(true)
    // Organising a budget costs nothing, so it competes with nothing.
    expect(wouldContend(one, 'organise_day_to_day_finances', null)).toBe(false)
  })

  it('notices two goals that would both mean new borrowing', () => {
    const borrowing = contextOf(
      {},
      {
        plans: [
          { goal: 'renovate_home', status: 'active', targetAmount: null, short: null },
          { goal: 'buy_car', status: 'draft', targetAmount: null, short: null },
        ],
      },
    )

    const [contention] = contentionIn(borrowing)
    expect(contention?.resource).toBe('borrowing_capacity')
    expect(contention?.describe).toMatch(/both mean new borrowing/i)
  })
})

/**
 * §21, the catalogue's own acceptance test.
 *
 * The figures in the document are illustrative, so the exact tier of every secondary candidate is
 * not fitted to — the needs engine made the same call about its worked example. What is asserted
 * is what the test is actually for: the right primary, the related goals recognised as more than
 * background, the rest identified without being pushed, the follow-ons held back, and above all
 * nothing activated.
 */
describe('§21: a new baby, separate money, and six months from a deposit', () => {
  const candidates = evaluateGoals(
    contextOf({
      'goals.primaryObjective':
        'my wife and I have a new baby, we keep our money separate, and we are about six months away from the deposit for our first home',
      'lifeEvent.newChild': true,
      'household.dependantCount': 1,
      'identity.maritalStatus:primary': 'married',
      'household.financesManagedJointly': false,
      'housing.firstTimeBuyer': true,
      'housing.purchasePrice': 600_000,
      'assets.depositAmount': 46_000,
      'goals.savingsTarget': 60_000,
      'goals.monthlySaving': 2_300,
      'housing.currentTenure': 'renting',
      'expenditure.monthlyRent': 1_800,
    }),
  )

  it('identifies buying the first home as the primary goal', () => {
    expect(primaryGoal(candidates)?.goal.id).toBe('buy_first_home')
  })

  it('recognises shared finances and the baby as strongly related', () => {
    for (const id of ['shared_household_finances', 'prepare_for_baby'] as const) {
      expect(['primary', 'strong_related'], id).toContain(find(candidates, id).tier)
    }
  })

  it('identifies protection, an emergency fund and saving for the child as context', () => {
    for (const id of ['family_protection', 'build_emergency_fund', 'save_for_child'] as const) {
      expect(find(candidates, id).tier, id).not.toBe('latent')
    }
  })

  it('holds renovating and a car until the house is done', () => {
    // The first-home cluster names both as things that come later, and new borrowing is the one
    // thing that can cost somebody the mortgage they are saving for.
    expect(find(candidates, 'renovate_home').tier).toBe('deferred')
    expect(find(candidates, 'buy_car').tier).toBe('deferred')
  })

  it('keeps rebuilding savings as a follow-on rather than raising it now', () => {
    // Nothing to rebuild from until the purchase completes, so it is not a candidate — it is
    // what comes next, and the engine knows that without having to mention it.
    expect(find(candidates, 'rebuild_savings_after_home_purchase').tier).toBe('latent')
    expect(followOnFor('buy_first_home').map((goal) => goal.id)).toContain(
      'rebuild_savings_after_home_purchase',
    )
  })

  it('does not activate any of them', () => {
    // Eight goals identified from one sentence, three worth mentioning, zero plans.
    expect(
      candidates.filter((candidate) => candidate.tier !== 'latent').length,
    ).toBeGreaterThanOrEqual(8)
    expect(worthRaising(candidates)).toHaveLength(3)
    expect(candidates.every((candidate) => candidate.tier !== 'planned')).toBe(true)
  })

  it('knows what it still has to ask about the primary goal', () => {
    // The price, the deposit and the saving rate are known; income is not, and affordability
    // cannot be understood without it.
    expect(primaryGoal(candidates)?.missing).toContain('income.annualBasic')
    expect(primaryGoal(candidates)?.missing).not.toContain('housing.purchasePrice')
  })
})

/**
 * Discovery depth — what `show_product_options` gates on.
 *
 * Reported from a live test: a customer opened with "I'm just looking to have a broad
 * conversation about my financial position", said they were married with a baby coming, renting
 * and €46,000 saved, and was shown a mortgage card in the same turn Saoirse was still asking them
 * what price range they had in mind. Being certain somebody needs a mortgage is not the same as
 * understanding their position, and the gate was only testing the first.
 */
describe('knowing what a goal needs before acting on it', () => {
  const understood = (candidate: GoalCandidate): boolean =>
    candidate.missing.length <= Math.floor(candidate.goal.informationNeeded.length / 2)

  it('is not satisfied by being certain what they need', () => {
    const early = evaluateGoals(
      contextOf({
        'goals.primaryObjective':
          'we want to understand mortgages and how we can build towards moving house',
        'housing.currentTenure': 'renting',
        'assets.depositAmount': 46_000,
        'lifeEvent.newChild': true,
        'identity.maritalStatus:primary': 'married',
      }),
    )

    const home = find(early, 'buy_first_home')
    // Certain, and nowhere near ready: nothing is known about income, price or timing.
    expect(home.confidence).toBeGreaterThanOrEqual(GOAL_THRESHOLDS.strong)
    expect(understood(home)).toBe(false)
    expect(home.missing).toContain('income.annualBasic')
    expect(home.missing).toContain('housing.purchasePrice')
  })

  it('is satisfied once the case can answer most of what the goal needs', () => {
    const later = evaluateGoals(
      contextOf({
        'goals.primaryObjective': 'we want to buy our first home',
        'housing.currentTenure': 'renting',
        'housing.purchasePrice': 600_000,
        'assets.depositAmount': 46_000,
        'goals.monthlySaving': 2_300,
        'income.annualBasic:primary': 92_000,
        'household.buyingWith': 'partner',
      }),
    )

    expect(understood(find(later, 'buy_first_home'))).toBe(true)
  })

  /** The question Saoirse asks next should be the one the goal is actually missing. */
  it('names what is still unknown, so the next question is not a guess', () => {
    const candidates = evaluateGoals(
      contextOf({
        'goals.primaryObjective': 'we want to buy our first home',
        'assets.depositAmount': 46_000,
      }),
    )

    expect(worthRaising(candidates, 1)[0]?.missing).toEqual(
      expect.arrayContaining([
        'housing.purchasePrice',
        'income.annualBasic',
        'goals.monthlySaving',
      ]),
    )
  })
})

/**
 * Case eb37e9b5: "Switch mortgage" from a homeowner with an €850,000 house was read as a first
 * home, because the first-home signal fired on the bare word "mortgage" and the life-stage
 * cluster read the house's value as a purchase price. The plan then had a deposit target.
 */
describe('switching is not buying', () => {
  const switcher = contextOf({
    'goals.primaryObjective': 'Switch mortgage',
    'mortgage.customerType': 'switcher',
    'housing.currentTenure': 'owner_occupier',
    'housing.purchasePrice': 850_000,
    'mortgage.amountSought': 300_000,
  })

  it('makes the switch the primary goal, and the first home nothing of the kind', () => {
    const candidates = evaluateGoals(switcher)
    expect(primaryGoal(candidates)?.goal.id).toBe('switch_mortgage')
    expect(find(candidates, 'buy_first_home').tier).not.toBe('primary')
    expect(find(candidates, 'buy_first_home').evidence.map((e) => e.describe)).not.toContain(
      'they said they want to buy a home',
    )
  })

  it('does not put a switcher in the first-home life stage on the strength of a house value', () => {
    expect(matchedClusters(switcher).map((cluster) => cluster.id)).not.toContain(
      'FIRST_HOME_LIFE_STAGE',
    )
  })

  it('still reads "we want a mortgage" as buying', () => {
    const buyer = contextOf({ 'goals.primaryObjective': 'We want a mortgage for our first place' })
    expect(primaryGoal(evaluateGoals(buyer))?.goal.id).toBe('buy_first_home')
  })

  it('asks for the current deal, not a deposit', () => {
    const missing = find(evaluateGoals(switcher), 'switch_mortgage').missing
    expect(missing).toContain('mortgage.currentLender')
    expect(missing).toContain('mortgage.currentRateEndsAt')
    expect(missing).not.toContain('assets.depositAmount')
    expect(find(evaluateGoals(switcher), 'switch_mortgage').goal.draws).toBeNull()
  })
})
