import type { FactKey } from '../facts.ts'
import type { Product } from '../journey.ts'
import type { ApplicationState } from '../state-machine.ts'
import type {
  GoalBlueprint,
  GoalContext,
  GoalDeferral,
  GoalMilestone,
  GoalSuppression,
  MilestoneBinding,
  MilestoneCategory,
} from './types.ts'

/**
 * The goal blueprints, translated from `docs/goal-catalogue/saoi-goal-catalogue.json` v1.0.
 *
 * All twenty-six are here. Names, categories, descriptions, milestones, relationships,
 * check-ins and completion criteria come straight from the catalogue document, so the two can be
 * read side by side. What the document could not supply is written here instead:
 *
 *   - **Signals** are conditions over recorded facts, not the phrases the document lists (§5).
 *   - **Milestone bindings** say how the engine can tell a milestone has happened, so progress
 *     is computed rather than remembered (Invariant 3).
 *   - **Check-in agendas** are authored, because a check-in whose reason is invented at the
 *     moment of contact is an engagement trigger rather than a service (§15).
 *   - **Preconditions** in the document that are conditions rather than goals — "adequate
 *     liquidity", "home purchase complete" — are expressed as deferrals, which is what they
 *     are: the goal is right and the moment is not, and it comes back (§14).
 *
 * Two references in the document do not resolve and are dropped rather than invented: a related
 * goal `ENERGY_UPGRADE_HOME` that the catalogue never defines, and linked needs for which no
 * need exists yet in `needs/catalogue.ts`. A goal with no linked need is still understood and
 * tracked; it simply has no product route, which is true of most of them.
 */

// ---------------------------------------------------------------------------
// Reading the case
// ---------------------------------------------------------------------------

/**
 * What the customer said they are here for.
 *
 * This is the one place a goal is matched against language, and it is language that extraction
 * has already turned into a fact: `goals.primaryObjective` is the customer's own statement of
 * their objective, recorded deliberately. Testing it is reading a recorded answer, not scanning
 * a conversation for keywords — and a goal the customer states outright is the strongest
 * evidence there is (§5, explicit).
 */
/**
 * A fact's value as text, or empty when it is not text.
 *
 * `get` returns `unknown` because a fact's value is whatever its catalogue schema says. Coercing
 * that with `String()` turns a malformed row into the literal "[object Object]", which would then
 * match nothing and fail silently — the one failure mode this codebase keeps running into.
 */
const text = (context: GoalContext, key: FactKey, subject: 'household' | 'primary'): string => {
  const value = context.facts.get(key, subject)
  return typeof value === 'string' ? value : ''
}

const objective = (context: GoalContext): string => {
  const value = context.facts.get('goals.primaryObjective', 'household')
  return typeof value === 'string' ? value.toLowerCase() : ''
}

const stated =
  (pattern: RegExp) =>
  (context: GoalContext): boolean =>
    pattern.test(objective(context))

const borrowingFor =
  (pattern: RegExp) =>
  (context: GoalContext): boolean => {
    const purpose = context.facts.get('borrowing.purpose', 'household')
    return typeof purpose === 'string' && pattern.test(purpose.toLowerCase())
  }

const has =
  (key: FactKey, subject: 'household' | 'primary' = 'household') =>
  (context: GoalContext): boolean =>
    context.facts.has(key, subject)

const positive =
  (key: FactKey) =>
  (context: GoalContext): boolean =>
    (context.facts.number(key, 'household') ?? 0) > 0

const isTrue =
  (key: FactKey) =>
  (context: GoalContext): boolean =>
    context.facts.boolean(key, 'household') === true

const tenureIs =
  (value: string) =>
  (context: GoalContext): boolean =>
    context.facts.get('housing.currentTenure', 'household') === value

/**
 * Moving an existing mortgage, as opposed to taking one out.
 *
 * "Switch mortgage" contains the word mortgage, and for a week that made it a first home: a
 * deposit target derived from the house's value, a plan with nothing to save towards, and an
 * application that asked a homeowner whether he pays rent (case eb37e9b5). A switch is said in
 * its own words or recorded as a buyer type, and either one takes precedence over a purchase.
 */
const switching = (context: GoalContext): boolean =>
  /switch|remortgag|re-mortgag|rate (is |will be )?(ending|rolling|expir|running out)|better rate|cheaper rate/.test(
    objective(context),
  ) || context.facts.get('mortgage.customerType', 'household') === 'switcher'

const employmentIs =
  (...values: readonly string[]) =>
  (context: GoalContext): boolean =>
    values.includes(text(context, 'employment.status', 'primary'))

const married = (context: GoalContext): boolean =>
  isTrue('lifeEvent.recentlyMarried')(context) ||
  ['married', 'civil_partnership'].includes(text(context, 'identity.maritalStatus', 'primary'))

const hasDependants = (context: GoalContext): boolean =>
  (context.facts.number('household.dependantCount', 'household') ?? 0) > 0

const savings = (context: GoalContext): number =>
  context.facts.number('assets.savingsBalance', 'household') ??
  context.facts.number('assets.depositAmount', 'household') ??
  0

/** A product being pursued, as opposed to one merely mentioned. */
const pursuing = (context: GoalContext, product: string): boolean =>
  context.applications.some(
    (application) =>
      application.product === product &&
      application.state !== 'declined' &&
      application.state !== 'completed',
  )

/** A mortgage whose affordability is being assessed, which is what borrowing can upset. */
const mortgageInAssessment = (context: GoalContext): boolean =>
  context.applications.some(
    (application) =>
      application.product === 'mortgage' &&
      ['ready', 'submitted', 'under_review', 'info_required', 'approved'].includes(
        application.state,
      ),
  )

const underFinancialStress = (context: GoalContext): boolean =>
  context.facts.get('lifeEvent.incomeChange', 'household') === 'decrease' ||
  employmentIs('unemployed')(context)

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

/**
 * §13 and Invariant 6 — a disclosure is not an opportunity.
 *
 * Somebody mentioning an illness has told the bank something private. The exception is the
 * customer raising protection themselves, which is a question and deserves an answer.
 */
const healthNotCommercialised: GoalSuppression = {
  id: 'sensitive_health_noncommercialisation',
  describe: 'health was disclosed in confidence and cover was not what they asked about',
  when: (context) =>
    context.sensitiveDisclosure &&
    !/protect|cover|insur|if anything happen/i.test(objective(context)),
}

/** The catalogue is explicit: where essentials are at risk, support comes before credit. */
const supportBeforeCredit: GoalSuppression = {
  id: 'support_before_credit',
  describe: 'their income has fallen, so support matters more than new borrowing',
  when: underFinancialStress,
}

/** §14 — the worked example. Borrowing now could cost them the mortgage they are waiting on. */
const whileMortgageAssessed = (what: string): GoalDeferral => ({
  id: 'mortgage_affordability_in_assessment',
  describe: `${what} would show up in the mortgage affordability assessment that is in progress`,
  when: mortgageInAssessment,
  revisitWhen: 'the mortgage completes',
})

// ---------------------------------------------------------------------------
// Milestone shorthand
// ---------------------------------------------------------------------------

const milestone = (
  id: string,
  label: string,
  category: MilestoneCategory,
  required: boolean,
  binding: MilestoneBinding | null,
): GoalMilestone => ({ id, label, category, required, binding })

/** Reached once the case holds all of these. */
const knows = (...keys: readonly FactKey[]): MilestoneBinding => ({ kind: 'facts', keys })

/** A share of the plan's agreed target, so a blueprint needs no figures of its own. */
const saved = (fraction: number): MilestoneBinding => ({ kind: 'numeric', fraction })

const application = (product: Product, state: ApplicationState): MilestoneBinding => ({
  kind: 'application',
  product,
  state,
})

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const goalCatalogue: readonly GoalBlueprint[] = [
  // ---- Foundations --------------------------------------------------------
  {
    id: 'organise_day_to_day_finances',
    name: 'Get day-to-day finances organised',
    category: 'foundations',
    description: 'Create a stable view of income, spending, bills and everyday cashflow.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to get on top of their money',
        when: stated(
          /organis|all over the place|where my money goes|budget|on top of|track.*spend/,
        ),
      },
      {
        id: 'spending-unclear',
        strength: 'soft_inferred',
        describe: 'we know their income but nothing about their outgoings',
        when: (context) =>
          context.facts.has('income.annualBasic', 'primary') &&
          !context.facts.has('expenditure.monthlyOther', 'household'),
      },
    ],
    informationNeeded: [
      'income.annualBasic',
      'expenditure.monthlyRent',
      'expenditure.monthlyOther',
    ],
    milestones: [
      milestone(
        'CASHFLOW_UNDERSTOOD',
        'Cashflow understood',
        'financial',
        true,
        knows('income.annualBasic', 'expenditure.monthlyOther'),
      ),
      milestone(
        'BILLS_MAPPED',
        'Regular bills mapped',
        'process',
        true,
        knows('expenditure.monthlyRent', 'expenditure.monthlyOther'),
      ),
      milestone(
        'SPENDING_BUFFER_DEFINED',
        'Spending buffer defined',
        'financial',
        true,
        knows('goals.monthlySaving'),
      ),
    ],
    relationships: {
      related: ['build_emergency_fund', 'reduce_debt', 'shared_household_finances'],
      prerequisites: [],
      followOn: ['build_emergency_fund', 'save_for_defined_purchase'],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 1,
        purpose: 'Review the first month of organised cashflow',
        agenda: [
          'Compare what actually went out against what we expected',
          'Check nothing regular was missed',
          'Agree what the monthly buffer should be',
        ],
      },
    ],
    completion: ['CASHFLOW_UNDERSTOOD', 'BILLS_MAPPED', 'SPENDING_BUFFER_DEFINED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'build_emergency_fund',
    name: 'Build an emergency fund',
    category: 'foundations',
    description: 'Build an accessible reserve for unexpected costs or income disruption.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want a reserve for emergencies',
        when: stated(/emergency|rainy day|safety net|buffer|something goes wrong|cushion/),
      },
      {
        id: 'thin-reserve',
        strength: 'strong_inferred',
        describe: 'their savings would not cover three months of essentials',
        when: (context) => {
          const monthly =
            (context.facts.number('expenditure.monthlyRent', 'household') ?? 0) +
            (context.facts.number('expenditure.monthlyOther', 'household') ?? 0)
          return monthly > 0 && savings(context) < monthly * 3
        },
      },
      {
        id: 'income-fell',
        strength: 'soft_inferred',
        describe: 'their income has fallen',
        when: (context) => context.facts.get('lifeEvent.incomeChange', 'household') === 'decrease',
      },
    ],
    informationNeeded: [
      'expenditure.monthlyRent',
      'expenditure.monthlyOther',
      'assets.savingsBalance',
      'goals.monthlySaving',
    ],
    milestones: [
      milestone(
        'TARGET_DEFINED',
        'Emergency target defined',
        'financial',
        true,
        knows('goals.savingsTarget'),
      ),
      milestone('ONE_MONTH_BUFFER', 'One month of cover saved', 'financial', true, saved(1 / 3)),
      // The catalogue also lists a three-month marker. Three months of essentials is what the
      // target normally is, so it would fire at the same moment as reaching it — two identical
      // lines on the customer's plan. The target itself carries the meaning.
      milestone('TARGET_REACHED', 'Emergency target reached', 'financial', true, saved(1)),
    ],
    relationships: {
      related: ['organise_day_to_day_finances', 'income_resilience', 'family_protection'],
      prerequisites: [],
      followOn: ['start_investing'],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 1,
        purpose: 'Check emergency-fund progress',
        agenda: ['See where the balance is', 'Check the monthly amount still suits them'],
      },
      {
        kind: 'event',
        event: 'savings_target_reached',
        purpose: 'Decide what the reserve frees them up to do next',
        agenda: [
          'Confirm the reserve is where they want it',
          'Ask whether anything they parked is worth picking up',
        ],
      },
    ],
    completion: ['TARGET_REACHED'],
    suppressions: [],
    deferrals: [],
    draws: 'savings',
  },
  {
    id: 'reduce_debt',
    name: 'Reduce expensive debt',
    category: 'foundations',
    description: 'Stabilise cashflow and reduce expensive or problematic borrowing.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to clear debt',
        when: stated(/debt|pay.*off|clear.*loan|credit card.*balance|owe/),
      },
      {
        id: 'card-balance',
        strength: 'strong_inferred',
        describe: 'they are carrying a credit card balance',
        when: positive('liabilities.creditCardBalance'),
      },
      {
        id: 'repayments-heavy',
        strength: 'soft_inferred',
        describe: 'loan repayments take a sizeable share of their income',
        when: (context) => {
          const annual = context.facts.number('income.annualBasic', 'primary')
          const monthlyRepayments =
            context.facts.number('liabilities.monthlyLoanRepayments', 'household') ?? 0
          return annual !== null && annual > 0 && monthlyRepayments * 12 > annual * 0.15
        },
      },
    ],
    informationNeeded: [
      'liabilities.creditCardBalance',
      'liabilities.monthlyLoanRepayments',
      'income.annualBasic',
    ],
    milestones: [
      milestone(
        'DEBTS_INVENTORIED',
        'Debts understood',
        'process',
        true,
        knows('liabilities.creditCardBalance', 'liabilities.monthlyLoanRepayments'),
      ),
      milestone(
        'PLAN_DEFINED',
        'Repayment plan defined',
        'process',
        true,
        knows('goals.monthlySaving'),
      ),
      milestone('PRIORITY_DEBT_CLEARED', 'Priority debt cleared', 'financial', true, null),
      milestone('DEBT_GOAL_REACHED', 'Debt goal reached', 'financial', true, null),
    ],
    relationships: {
      related: ['organise_day_to_day_finances', 'build_emergency_fund'],
      prerequisites: [],
      followOn: [],
      conflicts: ['new_discretionary_borrowing'],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['DEBT_GOAL_REACHED'],
    suppressions: [],
    deferrals: [],
    draws: 'savings',
  },

  // ---- Saving -------------------------------------------------------------
  {
    id: 'save_for_defined_purchase',
    name: 'Save for something specific',
    category: 'saving',
    description: 'Build a known amount by a target date for a specific purpose.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they are saving for something specific',
        // Not a home deposit: that is `buy_first_home`, which does far more than hold a target.
        when: (context) =>
          stated(/sav(e|ing) for|put away for|wedding|holiday|new car|a trip/)(context) &&
          !positive('housing.purchasePrice')(context),
      },
      {
        id: 'target-named',
        strength: 'strong_inferred',
        describe: 'they have named an amount they are saving towards',
        when: (context) =>
          positive('goals.savingsTarget')(context) &&
          !context.facts.has('housing.purchasePrice', 'household'),
      },
      {
        id: 'date-named',
        strength: 'soft_inferred',
        describe: 'they have a date in mind',
        when: has('goals.targetDate'),
      },
    ],
    informationNeeded: [
      'goals.savingsTarget',
      'goals.targetDate',
      'assets.savingsBalance',
      'goals.monthlySaving',
    ],
    milestones: [
      milestone(
        'TARGET_DEFINED',
        'Savings target defined',
        'financial',
        true,
        knows('goals.savingsTarget'),
      ),
      milestone('SAVINGS_25', 'A quarter saved', 'financial', true, saved(0.25)),
      milestone('SAVINGS_50', 'Halfway there', 'financial', true, saved(0.5)),
      milestone('SAVINGS_75', 'Three quarters saved', 'financial', true, saved(0.75)),
      milestone('SAVINGS_100', 'Target funded', 'financial', true, saved(1)),
    ],
    relationships: {
      related: ['build_emergency_fund'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 1,
        purpose: 'Check savings progress',
        agenda: ['See where the balance is', 'Check the date still looks right'],
      },
    ],
    completion: ['SAVINGS_100'],
    suppressions: [],
    deferrals: [],
    draws: 'savings',
  },
  {
    id: 'rebuild_savings_after_home_purchase',
    name: 'Rebuild savings after buying',
    category: 'saving',
    description: 'Re-establish liquidity after deposit, moving and completion costs.',
    signals: [
      {
        id: 'bought-recently',
        strength: 'strong_inferred',
        describe: 'they have completed a home purchase',
        when: (context) =>
          context.applications.some(
            (application) =>
              application.product === 'mortgage' && application.state === 'completed',
          ),
      },
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to build their savings back up',
        when: stated(/build.*savings back|rebuild|wiped out|nothing left after/),
      },
    ],
    informationNeeded: ['assets.savingsBalance', 'expenditure.monthlyOther', 'goals.monthlySaving'],
    milestones: [
      milestone(
        'POST_MOVE_POSITION_UNDERSTOOD',
        'Cash position after the move understood',
        'financial',
        true,
        knows('assets.savingsBalance'),
      ),
      milestone(
        'NEW_TARGET_DEFINED',
        'New reserve target defined',
        'financial',
        true,
        knows('goals.savingsTarget'),
      ),
      milestone('BUFFER_REBUILT', 'Buffer rebuilt', 'financial', true, saved(1)),
    ],
    relationships: {
      related: ['buy_first_home', 'move_home', 'build_emergency_fund'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['BUFFER_REBUILT'],
    suppressions: [],
    deferrals: [
      {
        id: 'purchase_not_complete',
        describe: 'the home purchase has not completed yet, so there is nothing to rebuild from',
        when: (context) =>
          pursuing(context, 'mortgage') &&
          !context.applications.some(
            (application) =>
              application.product === 'mortgage' && application.state === 'completed',
          ),
        revisitWhen: 'the purchase completes',
      },
    ],
    draws: 'savings',
  },

  // ---- Housing ------------------------------------------------------------
  {
    id: 'buy_first_home',
    name: 'Buy our first home',
    category: 'housing',
    description: 'Move from deposit preparation into mortgage readiness, purchase and completion.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they said they want to buy a home',
        // "mortgage" counts only when it is not a switch of one they already have.
        when: (context) =>
          stated(/first home|buy.*(home|house|place)|get on the ladder/)(context) ||
          (stated(/mortgage/)(context) && !switching(context)),
      },
      {
        id: 'first-time-buyer',
        strength: 'strong_inferred',
        describe: 'they are a first-time buyer',
        when: isTrue('housing.firstTimeBuyer'),
      },
      {
        id: 'price-in-mind',
        strength: 'strong_inferred',
        describe: 'they have a purchase price in mind',
        when: positive('housing.purchasePrice'),
      },
      {
        id: 'deposit-building',
        strength: 'strong_inferred',
        describe: 'they are putting money aside for a deposit',
        when: positive('assets.depositAmount'),
      },
      {
        id: 'renting-now',
        strength: 'soft_inferred',
        describe: 'they are renting',
        when: tenureIs('renting'),
      },
    ],
    informationNeeded: [
      'housing.purchasePrice',
      'goals.targetDate',
      'assets.depositAmount',
      'goals.monthlySaving',
      'income.annualBasic',
      'liabilities.monthlyLoanRepayments',
      'household.buyingWith',
    ],
    milestones: [
      milestone(
        'AFFORDABILITY_UNDERSTOOD',
        'Affordability understood',
        'financial',
        true,
        knows('income.annualBasic', 'housing.purchasePrice'),
      ),
      milestone(
        'DEPOSIT_TARGET_DEFINED',
        'Deposit target defined',
        'financial',
        true,
        knows('goals.savingsTarget'),
      ),
      milestone('DEPOSIT_TARGET_REACHED', 'Deposit target reached', 'financial', true, saved(1)),
      milestone(
        'MORTGAGE_READY',
        'Mortgage readiness complete',
        'process',
        true,
        application('mortgage', 'ready'),
      ),
      milestone(
        'MORTGAGE_SUBMITTED',
        'Mortgage submitted',
        'process',
        true,
        application('mortgage', 'submitted'),
      ),
      milestone(
        'MORTGAGE_APPROVED',
        'Mortgage approved',
        'process',
        true,
        application('mortgage', 'approved'),
      ),
      milestone('PROPERTY_SELECTED', 'Property selected', 'life', true, null),
      milestone(
        'PROTECTION_IN_PLACE',
        'Mortgage protection in place',
        'process',
        true,
        application('protection', 'completed'),
      ),
      milestone('HOME_INSURANCE_IN_PLACE', 'Home insurance in place', 'process', true, null),
      milestone(
        'HOME_PURCHASE_COMPLETE',
        'Home purchase completed',
        'life',
        true,
        application('mortgage', 'completed'),
      ),
    ],
    relationships: {
      related: ['shared_household_finances', 'build_emergency_fund', 'family_protection'],
      prerequisites: [],
      followOn: ['rebuild_savings_after_home_purchase', 'renovate_home'],
      conflicts: ['new_unsecured_borrowing_before_mortgage_complete'],
    },
    linkedNeeds: [
      'first_home_mortgage',
      'save_home_deposit',
      'mortgage_protection',
      'home_insurance',
    ],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 1,
        purpose: 'Review deposit progress',
        agenda: ['See where the deposit is', 'Check nothing has changed with income or outgoings'],
      },
      {
        kind: 'event',
        event: 'savings_target_reached',
        purpose: 'Mortgage readiness review',
        agenda: [
          'Check how the deposit is going',
          'Confirm income and outgoings have not changed',
          'Decide whether to start the mortgage application',
          'Revisit anything we parked',
        ],
      },
    ],
    completion: ['HOME_PURCHASE_COMPLETE'],
    suppressions: [],
    deferrals: [],
    draws: 'savings',
  },
  {
    id: 'move_home',
    name: 'Move home',
    category: 'housing',
    description: 'Plan the sale and purchase of a new principal home.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to move',
        when: stated(/mov(e|ing) (home|house)|trad(e|ing) up|bigger (house|place)|sell.*buy/),
      },
      {
        id: 'owner-outgrowing',
        strength: 'strong_inferred',
        describe: 'they own their home and have children',
        when: (context) => tenureIs('owner_occupier')(context) && hasDependants(context),
      },
      {
        id: 'not-first-time',
        strength: 'soft_inferred',
        describe: 'they are buying but not for the first time',
        when: (context) =>
          positive('housing.purchasePrice')(context) &&
          context.facts.boolean('housing.firstTimeBuyer', 'household') === false,
      },
    ],
    informationNeeded: [
      'housing.purchasePrice',
      'income.annualBasic',
      'goals.targetDate',
      'assets.savingsBalance',
    ],
    milestones: [
      milestone(
        'EQUITY_UNDERSTOOD',
        'Equity position understood',
        'financial',
        true,
        knows('assets.savingsBalance'),
      ),
      milestone(
        'MOVE_AFFORDABILITY_UNDERSTOOD',
        'Move affordability understood',
        'financial',
        true,
        knows('income.annualBasic', 'housing.purchasePrice'),
      ),
      milestone('SALE_PLAN_DEFINED', 'Sale and purchase sequence agreed', 'process', true, null),
      milestone(
        'MORTGAGE_ROUTE_READY',
        'Mortgage route ready',
        'process',
        true,
        application('mortgage', 'ready'),
      ),
      milestone(
        'MOVE_COMPLETED',
        'Move completed',
        'life',
        true,
        application('mortgage', 'completed'),
      ),
    ],
    relationships: {
      related: ['family_protection'],
      prerequisites: [],
      followOn: ['renovate_home', 'rebuild_savings_after_home_purchase'],
      conflicts: ['new_unsecured_borrowing_before_mortgage_complete'],
    },
    linkedNeeds: ['first_home_mortgage', 'mortgage_protection', 'home_insurance'],
    checkins: [],
    completion: ['MOVE_COMPLETED'],
    suppressions: [],
    deferrals: [],
    draws: 'savings',
  },
  {
    id: 'switch_mortgage',
    name: 'Switch our mortgage',
    category: 'housing',
    description: 'Move an existing mortgage to a better rate, counting the costs of the move.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they said they want to switch their mortgage',
        when: (context) =>
          /switch|remortgag|re-mortgag|rate (is |will be )?(ending|rolling|expir|running out)|better rate|cheaper rate/.test(
            objective(context),
          ),
      },
      {
        id: 'switcher-type',
        strength: 'strong_inferred',
        describe: 'they are a switcher',
        when: (context) => context.facts.get('mortgage.customerType', 'household') === 'switcher',
      },
      {
        id: 'owner-with-a-lender',
        strength: 'soft_inferred',
        describe: 'they own their home and have a mortgage elsewhere',
        when: (context) =>
          tenureIs('owner_occupier')(context) && has('mortgage.currentLender')(context),
      },
    ],
    // No deposit and no purchase price: a switch is priced on what is owed, what the home is
    // worth, and what the current deal costs.
    informationNeeded: [
      'mortgage.currentLender',
      'mortgage.amountSought',
      'mortgage.termYears',
      'mortgage.currentRatePct',
      'mortgage.currentRateEndsAt',
      'property.value',
      'income.annualBasic',
    ],
    milestones: [
      milestone(
        'CURRENT_DEAL_UNDERSTOOD',
        'Current deal understood',
        'financial',
        true,
        knows('mortgage.currentLender', 'mortgage.amountSought', 'mortgage.currentRatePct'),
      ),
      milestone(
        'COMPARISON_DONE',
        'Rates compared over the fixed period',
        'financial',
        true,
        knows('mortgage.termYears', 'property.value'),
      ),
      milestone('COSTS_COUNTED', 'Switching costs counted', 'financial', true, null),
      milestone(
        'DECISION_MADE',
        'Decided whether to switch',
        'life',
        true,
        knows('mortgage.withThisBank'),
      ),
      milestone(
        'SWITCH_SUBMITTED',
        'Switcher application submitted',
        'process',
        true,
        application('mortgage', 'submitted'),
      ),
      milestone(
        'SWITCH_APPROVED',
        'Switcher mortgage approved',
        'process',
        true,
        application('mortgage', 'approved'),
      ),
      milestone(
        'PROTECTION_ASSIGNED',
        'Mortgage protection and buildings cover in place',
        'process',
        true,
        null,
      ),
      milestone(
        'SWITCH_COMPLETE',
        'Old mortgage repaid, new one live',
        'life',
        true,
        application('mortgage', 'completed'),
      ),
    ],
    relationships: {
      related: ['family_protection', 'renovate_home'],
      prerequisites: [],
      followOn: ['build_emergency_fund', 'renovate_home'],
      conflicts: ['new_unsecured_borrowing_before_mortgage_complete'],
    },
    linkedNeeds: ['switch_mortgage', 'mortgage_protection', 'home_insurance'],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 1,
        purpose: 'Check the switch against the rate end date',
        agenda: [
          'Confirm when the current rate ends and whether a break fee applies',
          'See whether the comparison still holds at the published rates',
          'Check the solicitor, valuation and insurance are moving',
        ],
      },
    ],
    completion: ['SWITCH_COMPLETE'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'renovate_home',
    name: 'Renovate our home',
    category: 'housing',
    description: 'Plan, budget and fund home improvement or retrofit works.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to do work on the house',
        when: stated(
          /renovat|extension|do up|kitchen|attic conversion|retrofit|insulat|improve.*house/,
        ),
      },
      {
        id: 'borrowing-for-works',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to borrow for home improvements',
        when: borrowingFor(/renovat|kitchen|extension|attic|improv|retrofit|insulat/),
      },
      {
        id: 'owner-occupier',
        strength: 'soft_inferred',
        describe: 'they own their home',
        when: tenureIs('owner_occupier'),
      },
    ],
    informationNeeded: [
      'borrowing.requestedAmount',
      'borrowing.purpose',
      'assets.savingsBalance',
      'goals.targetDate',
    ],
    milestones: [
      milestone('WORK_SCOPE_DEFINED', 'Scope defined', 'process', true, knows('borrowing.purpose')),
      milestone('QUOTES_OBTAINED', 'Quotes obtained', 'process', true, null),
      milestone(
        'FUNDING_PLAN_DEFINED',
        'Funding plan defined',
        'financial',
        true,
        knows('borrowing.requestedAmount'),
      ),
      milestone('WORK_STARTED', 'Works started', 'life', true, null),
      milestone('WORK_COMPLETED', 'Works completed', 'life', true, null),
    ],
    relationships: {
      related: ['build_emergency_fund'],
      prerequisites: [],
      followOn: [],
      conflicts: ['active_mortgage_affordability'],
    },
    linkedNeeds: ['home_improvement_borrowing'],
    checkins: [],
    completion: ['WORK_COMPLETED'],
    suppressions: [supportBeforeCredit],
    deferrals: [whileMortgageAssessed('New borrowing for the work')],
    draws: 'borrowing_capacity',
  },

  // ---- Family -------------------------------------------------------------
  {
    id: 'shared_household_finances',
    name: 'Organise money together',
    category: 'family',
    description: 'Create a shared structure for bills, spending, saving and joint goals.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to organise money with their partner',
        when: stated(/joint|together|shar(e|ed).*(money|account|finances)|combin/),
      },
      {
        id: 'finances-separate',
        strength: 'strong_inferred',
        describe: 'they are a couple keeping their money separate',
        when: (context) =>
          married(context) &&
          context.facts.boolean('household.financesManagedJointly', 'household') === false,
      },
      {
        id: 'buying-together',
        strength: 'strong_inferred',
        describe: 'they are buying a home with someone',
        when: (context) => context.facts.get('household.buyingWith', 'household') === 'partner',
      },
      {
        id: 'recently-married',
        strength: 'soft_inferred',
        describe: 'they recently married',
        when: married,
      },
    ],
    informationNeeded: [
      'household.buyingWith',
      'household.financesManagedJointly',
      'expenditure.monthlyRent',
    ],
    milestones: [
      milestone(
        'MODEL_DEFINED',
        'Agreed how to handle shared money',
        'process',
        true,
        knows('household.financesManagedJointly'),
      ),
      milestone(
        'JOINT_ACCOUNT_READY',
        'Joint account ready',
        'process',
        false,
        application('joint_account', 'completed'),
      ),
      milestone('SHARED_BILLS_MOVED', 'Shared bills moved across', 'process', false, null),
    ],
    relationships: {
      related: ['buy_first_home', 'prepare_for_baby', 'family_protection'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: ['shared_household_finances'],
    checkins: [],
    completion: ['MODEL_DEFINED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'prepare_for_baby',
    name: 'Get ready for the baby',
    category: 'family',
    description: 'Understand parental-leave, childcare, household and dependant impacts.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they mentioned a baby on the way or just arrived',
        when: stated(/baby|pregnan|expecting|maternity|paternity|parental leave|newborn/),
      },
      {
        id: 'new-child',
        strength: 'explicit',
        describe: 'there is a new child in the household',
        when: isTrue('lifeEvent.newChild'),
      },
      {
        id: 'childcare-costs',
        strength: 'soft_inferred',
        describe: 'they are paying for childcare',
        when: positive('expenditure.monthlyChildcare'),
      },
    ],
    informationNeeded: [
      'income.annualBasic',
      'expenditure.monthlyChildcare',
      'expenditure.monthlyOther',
      'assets.savingsBalance',
      'protection.coverAmount',
    ],
    milestones: [
      milestone(
        'BABY_BUDGET_UNDERSTOOD',
        'Baby budget understood',
        'financial',
        true,
        knows('expenditure.monthlyChildcare', 'expenditure.monthlyOther'),
      ),
      milestone(
        'LEAVE_IMPACT_UNDERSTOOD',
        'Parental-leave impact understood',
        'financial',
        true,
        knows('income.annualBasic'),
      ),
      milestone(
        'EMERGENCY_RESERVE_REVIEWED',
        'Emergency reserve reviewed',
        'financial',
        true,
        knows('assets.savingsBalance'),
      ),
      milestone('PROTECTION_REVIEWED', 'Protection reviewed', 'process', false, null),
      milestone(
        'CHILD_SAVING_DECISION',
        'Decided about saving for the child',
        'process',
        false,
        null,
      ),
    ],
    relationships: {
      related: [
        'family_protection',
        'income_resilience',
        'save_for_child',
        'shared_household_finances',
        'move_home',
      ],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: ['family_protection', 'child_saving', 'shared_household_finances'],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 3,
        purpose: 'Review household finances now the baby has arrived',
        agenda: [
          'Check how the real costs compare with what we expected',
          'See whether the reserve is still where they want it',
          'Ask whether anything we parked is worth picking up',
        ],
      },
    ],
    completion: ['BABY_BUDGET_UNDERSTOOD', 'LEAVE_IMPACT_UNDERSTOOD', 'EMERGENCY_RESERVE_REVIEWED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'save_for_child',
    name: 'Save for our child',
    category: 'family',
    description: "Build money over time for a child's future or education.",
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to save for a child',
        when: stated(
          /sav(e|ing) for (my|our|the) (child|kid|son|daughter|children)|child.*(savings|future)|for them when/,
        ),
      },
      {
        id: 'has-children',
        strength: 'soft_inferred',
        describe: 'they have children',
        when: hasDependants,
      },
    ],
    informationNeeded: [
      'household.dependantCount',
      'goals.savingsTarget',
      'goals.monthlySaving',
      'goals.targetDate',
    ],
    milestones: [
      milestone(
        'CHILD_GOAL_DEFINED',
        'Child saving goal defined',
        'financial',
        true,
        knows('goals.savingsTarget'),
      ),
      milestone(
        'CONTRIBUTION_STARTED',
        'Contributions started',
        'process',
        true,
        application('savings', 'completed'),
      ),
      milestone('ANNUAL_REVIEW', 'Annual review completed', 'process', false, null),
    ],
    relationships: {
      related: ['prepare_for_baby', 'fund_education', 'start_investing'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: ['child_saving'],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 12,
        purpose: 'Review the child saving goal',
        agenda: ['See how it has built up', 'Check the monthly amount still suits them'],
      },
    ],
    completion: ['CONTRIBUTION_STARTED'],
    suppressions: [],
    deferrals: [],
    draws: 'savings',
  },
  {
    id: 'family_protection',
    name: 'Protect the family',
    category: 'family',
    description:
      'Understand who depends on household income and whether financial protection is adequate.',
    signals: [
      {
        id: 'asked-for-it',
        declaration: true,
        strength: 'explicit',
        describe: 'they asked about protecting their family',
        when: stated(/protect|life (cover|insurance)|if anything happened|look after them|cover/),
      },
      {
        id: 'has-dependants',
        strength: 'strong_inferred',
        describe: 'people depend on their income',
        when: hasDependants,
      },
      {
        id: 'new-child',
        strength: 'strong_inferred',
        describe: 'there is a new child',
        when: isTrue('lifeEvent.newChild'),
      },
      {
        id: 'mortgage-in-flight',
        strength: 'soft_inferred',
        describe: 'they are taking on a mortgage',
        when: (context) => pursuing(context, 'mortgage'),
      },
    ],
    informationNeeded: ['household.dependantCount', 'income.annualBasic', 'protection.coverAmount'],
    milestones: [
      milestone(
        'DEPENDANTS_UNDERSTOOD',
        'Dependants understood',
        'process',
        true,
        knows('household.dependantCount'),
      ),
      milestone(
        'EXISTING_COVER_REVIEWED',
        'Existing cover reviewed',
        'process',
        true,
        knows('protection.coverAmount'),
      ),
      milestone(
        'PROTECTION_GAP_UNDERSTOOD',
        'Protection gap understood',
        'financial',
        true,
        knows('income.annualBasic', 'protection.coverAmount'),
      ),
      milestone(
        'PROTECTION_DECISION',
        'Protection decision made',
        'process',
        false,
        application('protection', 'completed'),
      ),
    ],
    relationships: {
      related: ['prepare_for_baby', 'buy_first_home', 'income_resilience'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: ['family_protection', 'mortgage_protection'],
    checkins: [],
    completion: ['PROTECTION_DECISION'],
    suppressions: [healthNotCommercialised],
    deferrals: [],
    draws: null,
  },
  {
    id: 'income_resilience',
    name: 'Protect our income',
    category: 'family',
    description: 'Understand how the household would cope if an earner could not work.',
    signals: [
      {
        id: 'asked-for-it',
        declaration: true,
        strength: 'explicit',
        describe: 'they asked what would happen if they could not work',
        when: stated(/could(n't| not) work|income protection|sick pay|out of work|lost my job/),
      },
      {
        id: 'single-income-dependants',
        strength: 'strong_inferred',
        describe: 'people depend on one income and savings are thin',
        when: (context) => hasDependants(context) && savings(context) < 5_000,
      },
      {
        id: 'income-fell',
        strength: 'soft_inferred',
        describe: 'their income has already fallen once',
        when: (context) => context.facts.get('lifeEvent.incomeChange', 'household') === 'decrease',
      },
    ],
    informationNeeded: [
      'income.annualBasic',
      'expenditure.monthlyOther',
      'assets.savingsBalance',
      'protection.coverAmount',
    ],
    milestones: [
      milestone(
        'INCOME_RISK_UNDERSTOOD',
        'Income dependency understood',
        'process',
        true,
        knows('income.annualBasic', 'household.dependantCount'),
      ),
      milestone('BENEFITS_REVIEWED', 'Employer benefits reviewed', 'process', true, null),
      milestone(
        'RESILIENCE_GAP_DEFINED',
        'Resilience gap defined',
        'financial',
        true,
        knows('expenditure.monthlyOther', 'assets.savingsBalance'),
      ),
      milestone('PROTECTION_DECISION', 'Protection decision made', 'process', true, null),
    ],
    relationships: {
      related: ['build_emergency_fund', 'family_protection'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: ['family_protection'],
    checkins: [],
    completion: ['PROTECTION_DECISION'],
    suppressions: [healthNotCommercialised],
    deferrals: [],
    draws: null,
  },

  // ---- Life transitions ---------------------------------------------------
  {
    id: 'start_career',
    name: 'Start out after college',
    category: 'life_transition',
    description: 'Move from student finances into salary, everyday banking and early planning.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they are starting their first job',
        when: stated(/first job|graduat|just finished college|starting work|new job/),
      },
      {
        id: 'starting-work',
        strength: 'explicit',
        describe: 'they are starting work',
        when: isTrue('lifeEvent.startingWork'),
      },
      {
        id: 'student-now',
        strength: 'strong_inferred',
        describe: 'they are a student',
        when: employmentIs('student'),
      },
    ],
    informationNeeded: ['employment.startDate', 'income.annualBasic', 'expenditure.monthlyRent'],
    milestones: [
      milestone(
        'SALARY_BANKING_READY',
        'Salary banking ready',
        'process',
        true,
        knows('employment.startDate'),
      ),
      milestone(
        'FIRST_MONTH_BUDGETED',
        'First working month budgeted',
        'financial',
        true,
        knows('income.annualBasic', 'expenditure.monthlyRent'),
      ),
      milestone(
        'EMERGENCY_SAVING_STARTED',
        'Emergency saving started',
        'process',
        false,
        application('savings', 'completed'),
      ),
      milestone(
        'PENSION_POSITION_UNDERSTOOD',
        'Pension position understood',
        'process',
        false,
        null,
      ),
    ],
    relationships: {
      related: ['organise_day_to_day_finances', 'build_emergency_fund', 'start_pension'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['SALARY_BANKING_READY', 'FIRST_MONTH_BUDGETED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'deal_with_income_change',
    name: 'Work out the new numbers',
    category: 'life_transition',
    description: 'Re-plan finances after a promotion, job change, reduced hours or redundancy.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'their income has changed',
        when: stated(
          /pay ris|promot|redundan|reduced hours|new salary|bonus|income.*(up|down|changed)/,
        ),
      },
      {
        id: 'income-changed',
        strength: 'explicit',
        describe: 'their income has changed',
        when: has('lifeEvent.incomeChange'),
      },
    ],
    informationNeeded: ['income.annualBasic', 'expenditure.monthlyOther', 'assets.savingsBalance'],
    milestones: [
      milestone(
        'NEW_CASHFLOW_UNDERSTOOD',
        'New cashflow understood',
        'financial',
        true,
        knows('income.annualBasic', 'expenditure.monthlyOther'),
      ),
      milestone('GOALS_RECALCULATED', 'Affected plans recalculated', 'process', true, null),
      milestone(
        'PLAN_UPDATED',
        'Saving and debt plan updated',
        'process',
        true,
        knows('goals.monthlySaving'),
      ),
    ],
    relationships: {
      related: ['organise_day_to_day_finances', 'build_emergency_fund', 'start_pension'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['NEW_CASHFLOW_UNDERSTOOD', 'PLAN_UPDATED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'financial_difficulty_recovery',
    name: 'Get back on steady ground',
    category: 'life_transition',
    description: 'Stabilise immediate obligations, stop deterioration and rebuild resilience.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they are struggling to keep up',
        when: stated(
          /strugg|arrears|behind on|can'?t (afford|keep up|pay)|missed.*payment|in trouble/,
        ),
      },
      {
        id: 'stress-signals',
        strength: 'strong_inferred',
        describe: 'their income has fallen and there is little behind them',
        when: (context) => underFinancialStress(context) && savings(context) < 1_000,
      },
    ],
    informationNeeded: [
      'income.annualBasic',
      'expenditure.monthlyOther',
      'liabilities.monthlyLoanRepayments',
    ],
    milestones: [
      milestone(
        'POSITION_UNDERSTOOD',
        'Immediate position understood',
        'process',
        true,
        knows('income.annualBasic', 'expenditure.monthlyOther'),
      ),
      milestone('SUPPORT_STARTED', 'Support route started', 'process', true, null),
      milestone('ARREARS_STABILISED', 'Arrears stabilised', 'financial', true, null),
      milestone('BUDGET_STABILISED', 'Budget stabilised', 'financial', true, null),
    ],
    relationships: {
      related: ['reduce_debt', 'build_emergency_fund'],
      prerequisites: [],
      followOn: [],
      conflicts: ['new_discretionary_borrowing'],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['BUDGET_STABILISED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'separate_finances',
    name: 'Separate our finances',
    category: 'life_transition',
    description: 'Untangle shared banking and rebuild an individual financial position.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they are separating',
        // Deliberately narrow. "We keep our money separate" is a couple asking to combine
        // their finances, and a looser pattern read it as the opposite.
        when: stated(/separating|divorc|split(ting)? up|breaking up|mov(ed|ing) out/),
      },
      {
        id: 'separating',
        strength: 'explicit',
        describe: 'they are separating',
        when: isTrue('lifeEvent.separating'),
      },
      {
        id: 'separated-status',
        strength: 'strong_inferred',
        describe: 'their marital status is separated or divorced',
        when: (context) =>
          ['separated', 'divorced'].includes(text(context, 'identity.maritalStatus', 'primary')),
      },
    ],
    informationNeeded: [
      'income.annualBasic',
      'expenditure.monthlyRent',
      'household.dependantCount',
    ],
    milestones: [
      milestone('SHARED_POSITION_MAPPED', 'Shared position mapped', 'process', true, null),
      milestone(
        'INDIVIDUAL_CASHFLOW_DEFINED',
        'Individual cashflow understood',
        'financial',
        true,
        knows('income.annualBasic', 'expenditure.monthlyRent'),
      ),
      milestone('BANKING_SEPARATED', 'Banking separated', 'process', true, null),
      milestone('NEW_GOALS_DEFINED', 'New personal goals defined', 'process', false, null),
    ],
    relationships: {
      related: ['organise_day_to_day_finances', 'build_emergency_fund', 'move_home'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['BANKING_SEPARATED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'manage_lump_sum',
    name: 'Decide what to do with a lump sum',
    category: 'life_transition',
    description:
      'Allocate a one-off sum across immediate needs, debt, savings and long-term goals.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they have come into a sum of money',
        when: stated(/inherit|lump sum|windfall|sold.*(house|business|shares)|came into/),
      },
      {
        id: 'lump-sum',
        strength: 'explicit',
        describe: 'they have received a lump sum',
        when: positive('lifeEvent.lumpSumAmount'),
      },
    ],
    informationNeeded: [
      'lifeEvent.lumpSumAmount',
      'liabilities.creditCardBalance',
      'assets.savingsBalance',
      'goals.targetDate',
    ],
    milestones: [
      milestone(
        'IMMEDIATE_NEEDS_RINGFENCED',
        'Immediate needs ring-fenced',
        'financial',
        true,
        knows('lifeEvent.lumpSumAmount'),
      ),
      milestone(
        'LIQUIDITY_DEFINED',
        'How much to keep accessible decided',
        'financial',
        true,
        knows('assets.savingsBalance'),
      ),
      milestone(
        'DEBT_REVIEWED',
        'Debt position reviewed',
        'process',
        true,
        knows('liabilities.creditCardBalance', 'liabilities.monthlyLoanRepayments'),
      ),
      milestone('ALLOCATION_DEFINED', 'Short- and long-term split agreed', 'process', true, null),
    ],
    relationships: {
      related: [
        'build_emergency_fund',
        'reduce_debt',
        'start_investing',
        'start_pension',
        'buy_first_home',
      ],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['ALLOCATION_DEFINED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },

  // ---- Wealth -------------------------------------------------------------
  {
    id: 'start_investing',
    name: 'Start investing',
    category: 'wealth',
    description:
      'Decide whether genuinely long-term surplus cash should enter an investment suitability journey.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they asked about investing',
        when: stated(/invest|stocks|shares|funds|markets|grow my money/),
      },
      {
        id: 'surplus-sitting',
        strength: 'soft_inferred',
        describe: 'they are holding a large balance with no near-term purpose',
        when: (context) =>
          savings(context) > 25_000 && !context.facts.has('goals.savingsTarget', 'household'),
      },
    ],
    informationNeeded: ['assets.savingsBalance', 'goals.targetDate', 'expenditure.monthlyOther'],
    milestones: [
      milestone(
        'SHORT_TERM_NEEDS_CONFIRMED',
        'Short-term cash needs separated',
        'financial',
        true,
        knows('assets.savingsBalance', 'expenditure.monthlyOther'),
      ),
      milestone(
        'HORIZON_DEFINED',
        'Investment horizon defined',
        'financial',
        true,
        knows('goals.targetDate'),
      ),
      milestone('SUITABILITY_STARTED', 'Suitability assessment started', 'process', true, null),
      milestone('INVESTMENT_DECISION', 'Investment decision made', 'process', true, null),
    ],
    relationships: {
      related: ['build_emergency_fund', 'start_pension', 'save_for_child'],
      prerequisites: ['build_emergency_fund'],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['INVESTMENT_DECISION'],
    suppressions: [
      {
        id: 'liquidity_first',
        describe: 'money they may need soon should not be invested, and their reserve is thin',
        when: (context) => {
          const monthly =
            (context.facts.number('expenditure.monthlyRent', 'household') ?? 0) +
            (context.facts.number('expenditure.monthlyOther', 'household') ?? 0)
          return monthly > 0 && savings(context) < monthly * 3
        },
      },
      {
        id: 'saving_for_something_soon',
        describe: 'this money is already earmarked for something nearer term',
        when: (context) =>
          positive('goals.savingsTarget')(context) &&
          savings(context) < (context.facts.number('goals.savingsTarget', 'household') ?? 0),
      },
    ],
    deferrals: [],
    draws: 'savings',
  },

  // ---- Retirement ---------------------------------------------------------
  {
    id: 'start_pension',
    name: 'Start or improve a pension',
    category: 'retirement',
    description: 'Understand existing provision, target retirement and whether action is needed.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they asked about a pension',
        when: stated(/pension|retirement sav|avc|prsa/),
      },
      {
        id: 'working-no-pension',
        strength: 'soft_inferred',
        describe: 'they are working and we know nothing about a pension',
        when: (context) => employmentIs('employed_full_time', 'self_employed')(context),
      },
    ],
    informationNeeded: [
      'identity.dateOfBirth',
      'income.annualBasic',
      'lifeEvent.retiringWithinYears',
    ],
    milestones: [
      milestone(
        'PENSION_POSITION_UNDERSTOOD',
        'Pension position understood',
        'process',
        true,
        knows('identity.dateOfBirth', 'income.annualBasic'),
      ),
      milestone(
        'RETIREMENT_GOAL_DEFINED',
        'Retirement goal defined',
        'financial',
        true,
        knows('lifeEvent.retiringWithinYears'),
      ),
      milestone('PROJECTED_GAP_UNDERSTOOD', 'Projected gap understood', 'financial', true, null),
      milestone('PENSION_ACTION', 'Pension action taken', 'process', false, null),
    ],
    relationships: {
      related: ['start_investing', 'prepare_for_retirement'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 12,
        purpose: 'Review pension progress',
        agenda: [
          'Check contributions against the goal',
          'Confirm the retirement age they have in mind',
        ],
      },
    ],
    completion: ['PROJECTED_GAP_UNDERSTOOD'],
    suppressions: [supportBeforeCredit],
    deferrals: [],
    draws: null,
  },
  {
    id: 'prepare_for_retirement',
    name: 'Prepare for retirement',
    category: 'retirement',
    description: 'Build a clear picture of retirement income, expenditure, debt and timing.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they are thinking about retiring',
        when: stated(/retir|finish work|wind down|can i afford to stop/),
      },
      {
        id: 'retiring-soon',
        strength: 'strong_inferred',
        describe: 'they expect to retire within ten years',
        when: (context) => {
          const years = context.facts.number('lifeEvent.retiringWithinYears', 'household')
          return years !== null && years <= 10
        },
      },
    ],
    informationNeeded: [
      'lifeEvent.retiringWithinYears',
      'income.annualBasic',
      'expenditure.monthlyOther',
      'assets.savingsBalance',
    ],
    milestones: [
      milestone(
        'RETIREMENT_DATE_DEFINED',
        'Retirement date defined',
        'life',
        true,
        knows('lifeEvent.retiringWithinYears'),
      ),
      milestone('INCOME_ESTIMATED', 'Retirement income estimated', 'financial', true, null),
      milestone(
        'EXPENDITURE_ESTIMATED',
        'Retirement spending estimated',
        'financial',
        true,
        knows('expenditure.monthlyOther'),
      ),
      milestone('GAP_UNDERSTOOD', 'Retirement gap understood', 'financial', true, null),
      milestone('OPTIONS_REVIEW', 'Retirement options reviewed', 'process', true, null),
    ],
    relationships: {
      related: ['start_pension', 'transition_to_retirement', 'reduce_debt'],
      prerequisites: [],
      followOn: ['transition_to_retirement'],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [
      {
        kind: 'scheduled',
        everyMonths: 12,
        purpose: 'Review retirement readiness',
        agenda: [
          'Check the income picture',
          'Check anything owed at retirement',
          'Confirm the date still holds',
        ],
      },
    ],
    completion: ['GAP_UNDERSTOOD', 'OPTIONS_REVIEW'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'transition_to_retirement',
    name: 'Move into retirement',
    category: 'retirement',
    description: 'Turn retirement resources into a sustainable income and cashflow plan.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they are retiring now',
        when: stated(/retiring (this|next) (year|month)|drawing.*pension|annuity|arf/),
      },
      {
        id: 'retired',
        strength: 'strong_inferred',
        describe: 'they are retired',
        when: employmentIs('retired'),
      },
    ],
    informationNeeded: ['expenditure.monthlyOther', 'assets.savingsBalance', 'income.otherAnnual'],
    milestones: [
      milestone('OPTIONS_UNDERSTOOD', 'Retirement options understood', 'process', true, null),
      milestone('INCOME_ROUTE_SELECTED', 'Income route selected', 'process', true, null),
      milestone(
        'CASH_RESERVE_DEFINED',
        'Cash reserve defined',
        'financial',
        true,
        knows('assets.savingsBalance', 'expenditure.monthlyOther'),
      ),
      milestone('RETIREMENT_INCOME_STARTED', 'Retirement income started', 'financial', true, null),
    ],
    relationships: {
      related: ['prepare_for_retirement', 'organise_day_to_day_finances'],
      prerequisites: ['prepare_for_retirement'],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['RETIREMENT_INCOME_STARTED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },

  // ---- Education and major purchases --------------------------------------
  {
    id: 'fund_education',
    name: 'Pay for education',
    category: 'education',
    description: 'Prepare for tuition and related costs using savings and borrowing where needed.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they need to fund education',
        when: stated(/college|tuition|fees|university|course|masters|back to study/),
      },
      {
        id: 'borrowing-for-study',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to borrow for education',
        when: borrowingFor(/college|tuition|fees|course|study|education/),
      },
    ],
    informationNeeded: [
      'goals.savingsTarget',
      'goals.targetDate',
      'assets.savingsBalance',
      'borrowing.requestedAmount',
    ],
    milestones: [
      milestone(
        'COST_ESTIMATED',
        'Cost estimated',
        'financial',
        true,
        knows('goals.savingsTarget'),
      ),
      milestone(
        'AVAILABLE_FUNDING_MAPPED',
        'Available funding mapped',
        'process',
        true,
        knows('assets.savingsBalance'),
      ),
      milestone('GAP_DEFINED', 'Funding gap defined', 'financial', true, null),
      milestone('FUNDING_IN_PLACE', 'Funding in place', 'financial', true, saved(1)),
    ],
    relationships: {
      related: ['save_for_child'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['FUNDING_IN_PLACE'],
    suppressions: [supportBeforeCredit],
    deferrals: [],
    draws: 'savings',
  },
  {
    id: 'buy_car',
    name: 'Buy a car',
    category: 'major_purchase',
    description: 'Plan and fund a vehicle purchase, and understand the effect on other goals.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to buy a car',
        when: stated(/\bcar\b|vehicle|van\b|motor/),
      },
      {
        id: 'borrowing-for-car',
        declaration: true,
        strength: 'explicit',
        describe: 'they want to borrow for a car',
        when: borrowingFor(/\bcar\b|vehicle|van\b|motor/),
      },
    ],
    informationNeeded: [
      'borrowing.requestedAmount',
      'assets.savingsBalance',
      'goals.targetDate',
      'income.annualBasic',
    ],
    milestones: [
      milestone(
        'CAR_BUDGET_DEFINED',
        'Budget defined',
        'financial',
        true,
        knows('borrowing.requestedAmount'),
      ),
      milestone(
        'FUNDING_MIX_DEFINED',
        'How to fund it decided',
        'process',
        true,
        knows('assets.savingsBalance'),
      ),
      milestone('VEHICLE_PURCHASED', 'Car bought', 'life', true, null),
    ],
    relationships: {
      related: ['save_for_defined_purchase'],
      prerequisites: [],
      followOn: [],
      conflicts: ['active_mortgage_affordability'],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['VEHICLE_PURCHASED'],
    suppressions: [supportBeforeCredit],
    deferrals: [whileMortgageAssessed('Car finance')],
    draws: 'borrowing_capacity',
  },

  // ---- International ------------------------------------------------------
  {
    id: 'move_to_ireland',
    name: 'Move to Ireland',
    category: 'international',
    description: 'Set up practical banking and financial arrangements for relocating to Ireland.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they are moving to Ireland',
        when: stated(/mov(e|ing) to ireland|relocat|new to ireland|just arrived/),
      },
      {
        id: 'moving-here',
        strength: 'explicit',
        describe: 'they are moving to Ireland',
        when: isTrue('lifeEvent.movingToIreland'),
      },
    ],
    informationNeeded: ['identity.address', 'employment.startDate', 'income.annualBasic'],
    milestones: [
      milestone(
        'IRISH_BANKING_READY',
        'Irish banking ready',
        'process',
        true,
        knows('identity.address'),
      ),
      milestone(
        'SALARY_READY',
        'Salary arrangements ready',
        'process',
        true,
        knows('employment.startDate'),
      ),
      milestone('FX_REVIEWED', 'International money needs reviewed', 'process', false, null),
    ],
    relationships: {
      related: ['organise_day_to_day_finances', 'international_money'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['IRISH_BANKING_READY', 'SALARY_READY'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
  {
    id: 'international_money',
    name: 'Manage money across borders',
    category: 'international',
    description: 'Handle recurring or one-off foreign-currency transfers, income or obligations.',
    signals: [
      {
        id: 'said-so',
        declaration: true,
        strength: 'explicit',
        describe: 'they move money between countries',
        when: stated(
          /transfer.*(abroad|overseas|home)|foreign currency|exchange rate|send money to|paid in (dollars|sterling|pounds)/,
        ),
      },
      {
        id: 'non-irish',
        strength: 'soft_inferred',
        describe: 'their nationality is not Irish',
        when: (context) => {
          const nationality = context.facts.get('identity.nationality', 'primary')
          return typeof nationality === 'string' && !/^ir(ish|eland)$/i.test(nationality.trim())
        },
      },
    ],
    informationNeeded: ['identity.nationality'],
    milestones: [
      milestone('FX_NEED_DEFINED', 'International money need defined', 'process', true, null),
      milestone('ROUTE_SELECTED', 'Route selected', 'process', true, null),
      milestone('FIRST_PAYMENT_COMPLETED', 'First payment completed', 'process', false, null),
    ],
    relationships: {
      related: ['move_to_ireland', 'fund_education'],
      prerequisites: [],
      followOn: [],
      conflicts: [],
    },
    linkedNeeds: [],
    checkins: [],
    completion: ['ROUTE_SELECTED'],
    suppressions: [],
    deferrals: [],
    draws: null,
  },
]

export function blueprintFor(id: string): GoalBlueprint | undefined {
  return goalCatalogue.find((goal) => goal.id === id)
}
