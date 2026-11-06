import type { GoalContext, LifeEventCluster } from './types.ts'

/**
 * Life-event clusters (§11).
 *
 * A cluster is not a plan and not a goal. It is the observation that one circumstance usually
 * opens several at once: a new baby is a broad financial transition, not an insurance trigger,
 * and treating it as the latter is exactly what this layer exists to prevent.
 *
 * So a cluster decides nothing. Matching one contributes evidence to the goals it names and
 * leaves the tiering to the engine, which is what keeps "we just had a baby" from producing six
 * plans nobody asked for (§13).
 *
 * The catalogue states cluster signals as phrases. These are the same circumstances expressed
 * as conditions over recorded facts, for the reason set out in `types.ts`.
 */

/** See `catalogue.ts`: a fact value is `unknown`, and coercing it would read "[object Object]". */
const status = (context: GoalContext): string => {
  const value = context.facts.get('identity.maritalStatus', 'primary')
  return typeof value === 'string' ? value : ''
}

const married = (context: GoalContext): boolean =>
  context.facts.boolean('lifeEvent.recentlyMarried', 'household') === true ||
  ['married', 'civil_partnership'].includes(status(context))

const renting = (context: GoalContext): boolean =>
  context.facts.get('housing.currentTenure', 'household') === 'renting'

export const lifeEventClusters: readonly LifeEventCluster[] = [
  {
    id: 'RECENTLY_MARRIED',
    name: 'Recently married or combining households',
    signals: [
      {
        id: 'recently-married',
        describe: 'they have recently married or entered a civil partnership',
        when: (context) => context.facts.boolean('lifeEvent.recentlyMarried', 'household') === true,
      },
      {
        id: 'finances-still-separate',
        describe: 'they are a couple keeping their money separate',
        when: (context) =>
          married(context) &&
          context.facts.boolean('household.financesManagedJointly', 'household') === false,
      },
    ],
    primary: ['shared_household_finances'],
    secondary: ['build_emergency_fund', 'family_protection', 'buy_first_home'],
    deferred: [],
    note: 'Do not assume joint banking is wanted. Ask how they want to handle shared and separate money.',
  },
  {
    id: 'NEW_BABY',
    name: 'New baby or growing family',
    signals: [
      {
        id: 'new-child',
        describe: 'there is a new child in the household',
        when: (context) => context.facts.boolean('lifeEvent.newChild', 'household') === true,
      },
      {
        id: 'childcare-costs',
        describe: 'they are paying for childcare',
        when: (context) =>
          (context.facts.number('expenditure.monthlyChildcare', 'household') ?? 0) > 0,
      },
    ],
    primary: ['prepare_for_baby'],
    secondary: [
      'family_protection',
      'income_resilience',
      'save_for_child',
      'build_emergency_fund',
      'move_home',
      'shared_household_finances',
    ],
    deferred: [],
    note: 'A broad financial transition, not an automatic insurance trigger.',
  },
  {
    id: 'FIRST_HOME_LIFE_STAGE',
    name: 'First-home life stage',
    signals: [
      {
        id: 'first-time-buyer',
        describe: 'they are a first-time buyer',
        when: (context) => context.facts.boolean('housing.firstTimeBuyer', 'household') === true,
      },
      {
        id: 'saving-a-deposit',
        describe: 'they are saving towards a deposit',
        when: (context) =>
          (context.facts.number('assets.depositAmount', 'household') ?? 0) > 0 ||
          // A switcher's house has a value, not a price; it is not a deposit being saved.
          (context.facts.number('housing.purchasePrice', 'household') !== null &&
            context.facts.get('mortgage.customerType', 'household') !== 'switcher'),
      },
      {
        id: 'renting-now',
        describe: 'they are renting',
        when: renting,
      },
    ],
    primary: ['buy_first_home'],
    secondary: [
      'shared_household_finances',
      'build_emergency_fund',
      'family_protection',
      'rebuild_savings_after_home_purchase',
    ],
    deferred: ['renovate_home', 'buy_car'],
    note: 'New unsecured borrowing may work against mortgage affordability.',
  },
  {
    id: 'GROWING_FAMILY_HOME_PRESSURE',
    name: 'Growing family needing more space',
    signals: [
      {
        id: 'children-and-not-buying-first',
        describe: 'they have children and already own their home',
        when: (context) =>
          (context.facts.number('household.dependantCount', 'household') ?? 0) > 0 &&
          context.facts.get('housing.currentTenure', 'household') === 'owner_occupier',
      },
    ],
    primary: ['move_home'],
    secondary: ['family_protection', 'build_emergency_fund', 'shared_household_finances'],
    deferred: [],
    note: null,
  },
  {
    id: 'GRADUATION_FIRST_JOB',
    name: 'Graduation and first job',
    signals: [
      {
        id: 'starting-work',
        describe: 'they are starting work or have just graduated',
        when: (context) => context.facts.boolean('lifeEvent.startingWork', 'household') === true,
      },
      {
        id: 'student-now',
        describe: 'they are a student',
        when: (context) => context.facts.get('employment.status', 'primary') === 'student',
      },
    ],
    primary: ['start_career'],
    secondary: ['organise_day_to_day_finances', 'build_emergency_fund', 'start_pension'],
    deferred: [],
    note: null,
  },
  {
    id: 'MAJOR_INCOME_INCREASE',
    name: 'Major income increase',
    signals: [
      {
        id: 'income-up',
        describe: 'their income has gone up',
        when: (context) => context.facts.get('lifeEvent.incomeChange', 'household') === 'increase',
      },
    ],
    primary: ['deal_with_income_change'],
    secondary: ['build_emergency_fund', 'reduce_debt', 'start_pension', 'start_investing'],
    deferred: [],
    note: null,
  },
  {
    id: 'INCOME_SHOCK',
    name: 'Income shock',
    signals: [
      {
        id: 'income-down',
        describe: 'their income has fallen',
        when: (context) => context.facts.get('lifeEvent.incomeChange', 'household') === 'decrease',
      },
      {
        id: 'out-of-work',
        describe: 'they are not currently working',
        when: (context) => context.facts.get('employment.status', 'primary') === 'unemployed',
      },
    ],
    primary: ['deal_with_income_change'],
    secondary: ['financial_difficulty_recovery', 'build_emergency_fund', 'reduce_debt'],
    deferred: [],
    note: 'Suppress discretionary borrowing and anything sales-led. Support comes first.',
  },
  {
    id: 'RELATIONSHIP_BREAKDOWN',
    name: 'Relationship breakdown',
    signals: [
      {
        id: 'separating',
        describe: 'they are separating',
        when: (context) => context.facts.boolean('lifeEvent.separating', 'household') === true,
      },
      {
        id: 'separated-status',
        describe: 'their marital status is separated or divorced',
        when: (context) => ['separated', 'divorced'].includes(status(context)),
      },
    ],
    primary: ['separate_finances'],
    secondary: ['organise_day_to_day_finances', 'build_emergency_fund', 'move_home'],
    deferred: [],
    note: 'A difficult time. Keep it practical and keep humour out of it.',
  },
  {
    id: 'LUMP_SUM_RECEIVED',
    name: 'Lump sum received',
    signals: [
      {
        id: 'lump-sum',
        describe: 'they have received a lump sum',
        when: (context) => (context.facts.number('lifeEvent.lumpSumAmount', 'household') ?? 0) > 0,
      },
    ],
    primary: ['manage_lump_sum'],
    secondary: [
      'build_emergency_fund',
      'reduce_debt',
      'start_investing',
      'start_pension',
      'buy_first_home',
    ],
    deferred: [],
    note: null,
  },
  {
    id: 'APPROACHING_RETIREMENT',
    name: 'Approaching retirement',
    signals: [
      {
        id: 'retiring-soon',
        describe: 'they expect to retire within ten years',
        when: (context) => {
          const years = context.facts.number('lifeEvent.retiringWithinYears', 'household')
          return years !== null && years <= 10
        },
      },
      {
        id: 'retired-already',
        describe: 'they are retired',
        when: (context) => context.facts.get('employment.status', 'primary') === 'retired',
      },
    ],
    primary: ['prepare_for_retirement'],
    secondary: ['reduce_debt', 'build_emergency_fund', 'transition_to_retirement'],
    deferred: [],
    note: null,
  },
]

export function clusterFor(id: string): LifeEventCluster | undefined {
  return lifeEventClusters.find((cluster) => cluster.id === id)
}
