import { z } from 'zod'

/**
 * The fact catalogue. Every reusable piece of customer context is defined here exactly once:
 * its value schema, whether it belongs to a person or the household, how it may be reused,
 * how sensitive it is, and whether the model is allowed to extract it from conversation.
 *
 * §9 (shared customer context), §10 (provenance), §11 (reuse rules).
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Branded so a participant id can never be confused with an application or fact id. */
export type ParticipantId = string & { readonly brand: unique symbol }
export type ApplicationId = string & { readonly brand: unique symbol }
export type FactId = string & { readonly brand: unique symbol }
export type CaseId = string & { readonly brand: unique symbol }

export const asParticipantId = (value: string): ParticipantId => value as ParticipantId
export const asApplicationId = (value: string): ApplicationId => value as ApplicationId
export const asFactId = (value: string): FactId => value as FactId
export const asCaseId = (value: string): CaseId => value as CaseId

/**
 * Journeys are written in terms of roles; facts are stored against participants. The
 * requirement engine resolves one to the other, which is what stops the primary's income
 * satisfying the partner's income requirement.
 */
export type ParticipantRole = 'primary' | 'partner'

/** What a fact is about. `'household'` facts are shared by everyone on the case. */
export type FactSubject = ParticipantId | 'household'

// ---------------------------------------------------------------------------
// Provenance and reuse
// ---------------------------------------------------------------------------

/** §10 — where a value came from. `verified` is tracked separately from `source`. */
export const FACT_SOURCES = [
  'customer_stated',
  'partner_stated',
  'bank_held',
  'document_extracted',
  'document_verified',
  'system_derived',
] as const
export type FactSource = (typeof FACT_SOURCES)[number]

/**
 * §11 — how a known value may be used again.
 *
 * - `auto`    reuse silently
 * - `confirm` reuse, but show it and ask the customer to confirm it is still right
 * - `fresh`   always ask again for this application
 * - `never`   not reusable at all
 */
export const REUSE_POLICIES = ['auto', 'confirm', 'fresh', 'never'] as const
export type ReusePolicy = (typeof REUSE_POLICIES)[number]

/** `special` data is collected only through an explicit consented form (§7.5, Invariant 6). */
export type Sensitivity = 'standard' | 'special'

export type FactDefinition = {
  /** Validates any value written against this key. */
  readonly schema: z.ZodType
  /** Whether the value belongs to one person or the household. */
  readonly subject: 'person' | 'household'
  /** Default reuse policy. A journey requirement may tighten it, never loosen it. */
  readonly reuse: ReusePolicy
  readonly sensitivity: Sensitivity
  /**
   * May the model write this from conversation? `false` means the only route in is an
   * explicit structured form — `record_facts` rejects it outright (Invariant 6).
   */
  readonly extractable: boolean
  /** Short human label, for the admin case inspector and the reuse metric. */
  readonly label: string
}

// ---------------------------------------------------------------------------
// Value schemas used by more than one key
// ---------------------------------------------------------------------------

const euro = z.number().int().nonnegative()

/*
 * What a published mortgage rate depends on.
 *
 * These four are the question behind "what rate could I get": the table prices every one of
 * them separately, so a rate quoted without all four is a guess. Facts rather than something
 * the model carries in its head, because they are asked once and then reused across the
 * mortgage application and anything else that needs them.
 */
const mortgageCustomerType = z.enum([
  'first_time_buyer',
  'mover',
  'switcher',
  'existing_demo_mortgage',
  'buy_to_let_new',
])

/*
 * A0 is in the scale and not in the rate table — the bank added it in May 2026 and has not
 * priced it. Accepted here so the customer's actual answer can be recorded, and refused at the
 * point of quoting rather than quietly rounded down to A.
 */
const berBand = z.enum(['A0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'BER Exempt'])
const positiveEuro = z.number().int().positive()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const employmentStatus = z.enum([
  'employed_full_time',
  'employed_part_time',
  'self_employed',
  'contract',
  'retired',
  'not_working',
  /*
   * A student is not "not working". The goal clusters already read `student` from this key
   * without the schema admitting it, so the answer could be asked for and never recorded; the
   * current account rules now turn on it too (2026-10-18).
   */
  'student',
])

const maritalStatus = z.enum([
  'single',
  'married',
  'civil_partnership',
  'separated',
  'divorced',
  'widowed',
])

const tenure = z.enum(['renting', 'living_with_family', 'owner_occupier', 'other'])

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const factCatalogue = {
  // ---- Identity (§9) ----
  'identity.fullName': {
    schema: z.string().min(2).max(120),
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Full name',
  },
  'identity.dateOfBirth': {
    schema: isoDate,
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Date of birth',
  },
  'identity.address': {
    schema: z.string().min(6).max(300),
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Home address',
  },
  'identity.yearsAtAddress': {
    schema: z.number().int().nonnegative().max(100),
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Years at address',
  },
  'identity.email': {
    schema: z.email(),
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Email address',
  },
  'identity.mobile': {
    schema: z.string().min(7).max(20),
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Mobile number',
  },
  'identity.maritalStatus': {
    schema: maritalStatus,
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Marital status',
  },
  'identity.nationality': {
    schema: z.string().min(2).max(60),
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Nationality',
  },
  // Never reusable across journeys without a fresh ask: a national identifier is
  // re-keyed per application in the recorded journeys.
  //
  // Takeable in conversation (2026-10-05). It was not, which produced a dead end: the case
  // listed it as outstanding, nothing told Saoirse it could not be recorded, so Saoirse asked, the
  // customer answered, record_facts refused it and Saoirse had to retract. Ordinary banking data
  // is collected in the conversation and covered by the DPA; special-category health data is
  // not, and stays `extractable: false` below (§7.5, Invariant 6).
  'identity.ppsn': {
    schema: z.string().regex(/^\d{7}[A-Za-z]{1,2}$/, 'expected a PPS number'),
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'PPS number',
  },

  // ---- Household (§9) ----
  'household.buyingWith': {
    schema: z.enum(['alone', 'partner', 'other']),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Buying alone or with someone',
  },
  'household.dependantCount': {
    schema: z.number().int().nonnegative().max(20),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Number of dependants',
  },
  'household.financesManagedJointly': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Household finances managed jointly',
  },

  // ---- Employment (§9) ----
  'employment.status': {
    schema: employmentStatus,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Employment status',
  },
  'employment.employerName': {
    schema: z.string().min(2).max(160),
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Employer',
  },
  'employment.occupation': {
    schema: z.string().min(2).max(120),
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Occupation',
  },
  'employment.startDate': {
    schema: isoDate,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Employment start date',
  },

  // ---- Education ----
  /**
   * When they finished studying, which decides whether the graduate account applies.
   *
   * A year rather than a date, because that is how people say it ("I graduated in 2024") and
   * the eligibility it feeds is counted in years. The bounds catch a typed month or a two-digit
   * year; they say nothing about the person.
   */
  'education.graduatedYear': {
    schema: z.number().int().min(1950).max(2100),
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Year they graduated',
  },

  // ---- Income (§9) ----
  'income.annualBasic': {
    schema: positiveEuro,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Annual basic salary',
  },
  'income.annualVariable': {
    schema: euro,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Annual bonus or commission',
  },
  'income.otherAnnual': {
    schema: euro,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Other annual income',
  },
  /**
   * Take-home pay, which is not the gross salary and cannot be derived from it.
   *
   * The lending journey asks for net monthly income and Saoirse holds annual basic, gross. The
   * gap between them is tax, PRSI, USC, pension and whatever else a payslip carries, none of
   * which Saoirse knows. A figure estimated from the gross would be a made-up number on a credit
   * application, so this is asked once and then reused like anything else.
   */
  'income.netMonthly': {
    schema: positiveEuro,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Net monthly income',
  },
  /**
   * What the customer says their partner earns, before the partner is here to say it.
   *
   * "I earn 150k and she earns 100k" arrives in the first minute of a mortgage conversation,
   * usually before anybody has been invited. There was no partner to write `income.annualBasic`
   * against, so the write was refused, the model retried it on five successive turns, and the
   * second salary was kept nowhere while Saoirse spoke of two good incomes.
   *
   * Household-level because it is the customer's account of their household, not a fact about
   * a person who may not exist on the case yet. Hearsay: `never` reused, and no journey reads
   * it, because the partner states their own income when they join and that is the figure an
   * application needs. The label says whose word it rests on, so wherever it is shown, to the
   * model or in the inspector, the caveat travels with the number.
   */
  'income.partnerAnnualStated': {
    schema: positiveEuro,
    subject: 'household',
    reuse: 'never',
    sensitivity: 'standard',
    extractable: true,
    label: "Partner's annual salary, as the customer described it",
  },

  // ---- Expenditure (§9) ----
  'expenditure.monthlyRent': {
    schema: euro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Monthly rent',
  },
  'expenditure.monthlyChildcare': {
    schema: euro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Monthly childcare',
  },
  'expenditure.monthlyOther': {
    schema: euro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Other monthly outgoings',
  },

  // ---- Assets (§9) ----
  'assets.savingsBalance': {
    schema: euro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Savings',
  },
  'assets.depositAmount': {
    schema: euro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Deposit available',
  },
  'assets.giftedDeposit': {
    schema: euro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Gifted portion of deposit',
  },

  // ---- Liabilities (§9) ----
  'liabilities.monthlyLoanRepayments': {
    schema: euro,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Monthly loan repayments',
  },
  'liabilities.creditCardBalance': {
    schema: euro,
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Credit card balance',
  },

  // ---- Housing and the purchase (§9) ----
  /**
   * Where their salary lands, which is what decides the primary banking relationship.
   *
   * Not "who do you bank with" — most people hold accounts in several places and the answer to
   * that is a list. The salary is the one that matters: it is what the bank can see, what a
   * standing order can be set against, and what makes an application fillable from records
   * rather than from questions.
   *
   * Tenant-agnostic values, because `_shared/domain` does not know whose bank it is running in.
   */
  'banking.salaryPaidTo': {
    schema: z.enum(['this_bank', 'another_bank', 'not_working']),
    subject: 'person',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Where their salary is paid',
  },
  /**
   * Whether they already have a payment account in Ireland, anywhere.
   *
   * The first thing to know about somebody the bank has never met: "my first account in
   * Ireland" and "moving from another bank" are different conversations, and the basic bank
   * account's eligibility turns on exactly this. Person-level because two applicants can have
   * arrived from different places.
   */
  /**
   * Whether they already bank here. Bank-held on a linked customer, stated otherwise. It
   * decides where money moved here can land: an account they already hold, or one started on
   * this case, and if neither, Saoirse has to say so before offering a transfer.
   */
  'banking.existingCustomer': {
    schema: z.boolean(),
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Already banks here',
  },
  'banking.holdsIrishPaymentAccount': {
    schema: z.boolean(),
    subject: 'person',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Already holds a payment account in Ireland',
  },
  'housing.currentTenure': {
    schema: tenure,
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Current housing',
  },
  'housing.purchasePrice': {
    schema: positiveEuro,
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Property price',
  },
  'housing.propertyCounty': {
    schema: z.string().min(2).max(60),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Property county',
  },
  'housing.firstTimeBuyer': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'First-time buyer',
  },

  // ---- Goals and life events (§9) ----
  'goals.primaryObjective': {
    schema: z.string().min(3).max(300),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'What the customer is trying to do',
  },
  /**
   * What they are building towards, as opposed to what they already hold. A customer six
   * months from a deposit has a different need from one who has it, and without the target
   * there is no way to tell the two apart or to know when they have arrived.
   */
  'goals.savingsTarget': {
    schema: z.number().int().positive(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'What they are saving towards',
  },
  'goals.monthlySaving': {
    schema: z.number().int().nonnegative(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'How much they put away each month',
  },
  /** Roughly when they expect to be ready. Drives the follow-up, so it is a date not a mood. */
  /**
   * How they want to get there, once they have been asked.
   *
   * The fork the whole conversation turns on. Somebody buying a house either wants a plan for
   * it, with the products falling out of the plan, or wants the obvious account today and will
   * come back for the rest. Both are reasonable, the choice is theirs, and before this existed
   * nobody was asked: the conversation went from questions straight to a product card.
   *
   * A fact rather than a column because it is a thing the customer said about what they want,
   * and because they can change their mind by saying so.
   */
  'goals.approach': {
    schema: z.enum(['plan', 'product']),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Plan or straight to a product',
  },
  'goals.targetDate': {
    schema: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM or YYYY-MM-DD'),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'When they expect to be ready',
  },
  'lifeEvent.recentlyMarried': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Recently married',
  },
  'lifeEvent.newChild': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'New child',
  },

  /**
   * The remaining life events the goal catalogue's clusters are built on (§11).
   *
   * Each one is a circumstance that opens several possible goals at once rather than pointing
   * at a product: a lump sum is not an investment sale, and reduced hours is not a loan
   * opportunity. They are recorded as facts so goal discovery stays a condition over the case
   * rather than a phrase match on the conversation.
   */
  'lifeEvent.incomeChange': {
    schema: z.enum(['increase', 'decrease']),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Income has changed',
  },
  'lifeEvent.lumpSumAmount': {
    schema: positiveEuro,
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Lump sum received',
  },
  'lifeEvent.separating': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Separating or divorcing',
  },
  'lifeEvent.startingWork': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Starting work or just graduated',
  },
  'lifeEvent.retiringWithinYears': {
    schema: z.number().int().nonnegative().max(50),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Years until they expect to retire',
  },
  'lifeEvent.movingToIreland': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'auto',
    sensitivity: 'standard',
    extractable: true,
    label: 'Moving to Ireland',
  },

  // ---- Borrowing intent ----
  'mortgage.customerType': {
    schema: mortgageCustomerType,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Buyer type',
  },
  'mortgage.amountSought': {
    schema: euro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Mortgage amount sought',
  },
  /**
   * Whether the mortgage is going to be taken here.
   *
   * The discovery guide has asked "would they want the mortgage here" since stages landed, and
   * there was nowhere to put the answer, so it was asked and dropped every time. It decides
   * whether a €2,000 first-time-buyer bonus is reachable, which makes it the single most
   * valuable boolean in a first-home conversation.
   *
   * `confirm` rather than `auto`: it is an intention rather than a fact about the world, and
   * somebody who said yes in October may have shopped around by March.
   */
  'mortgage.withThisBank': {
    schema: z.boolean(),
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Intends to mortgage with this bank',
  },
  'mortgage.termYears': {
    schema: z.number().int().min(5).max(35),
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Mortgage term',
  },
  'property.ber': {
    schema: berBand,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Property BER',
  },

  // ---- Switching an existing mortgage ----
  /*
   * A switch is not a purchase. Case eb37e9b5 stored the lender and the rate end in the
   * transcript only, the house value as a purchase price and the rate end as a goal date, and
   * everything downstream read it as a first home. These give a switch somewhere to live.
   */
  'mortgage.currentLender': {
    schema: z.string().min(2).max(80),
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Current mortgage lender',
  },
  'mortgage.currentRatePct': {
    schema: z.number().min(0).max(20),
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Current mortgage rate (%)',
  },
  'mortgage.currentRateType': {
    schema: z.enum(['fixed', 'variable', 'tracker']),
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Current rate type',
  },
  'mortgage.currentRateEndsAt': {
    schema: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM or YYYY-MM-DD'),
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'When the current rate ends',
  },
  'property.value': {
    schema: positiveEuro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Property value',
  },
  'borrowing.requestedAmount': {
    schema: positiveEuro,
    subject: 'household',
    reuse: 'fresh',
    sensitivity: 'standard',
    extractable: true,
    label: 'Amount the customer wants to borrow',
  },
  /**
   * How soon they expect to be rid of it.
   *
   * The fact that decides whether a loan is even the right shape. Somebody borrowing €3,000 they
   * mean to clear by Christmas wants something without a term attached; the same €3,000 over
   * four years wants the opposite. Nothing else in the case distinguishes the two.
   */
  'borrowing.repaymentMonths': {
    schema: z.number().int().positive().max(480),
    subject: 'household',
    reuse: 'fresh',
    sensitivity: 'standard',
    extractable: true,
    label: 'How soon they expect to repay it',
  },
  'borrowing.purpose': {
    schema: z.string().min(3).max(200),
    subject: 'household',
    reuse: 'fresh',
    sensitivity: 'standard',
    extractable: true,
    label: 'Purpose of borrowing',
  },

  // ---- Protection (§7.5) ----
  // Cover shape is ordinary information. Health is not: it is `special`, not extractable,
  // and reachable only through the consented structured form (Invariant 6).
  'protection.coverAmount': {
    schema: positiveEuro,
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Cover amount',
  },
  'protection.coverTermYears': {
    schema: z.number().int().positive().max(60),
    subject: 'household',
    reuse: 'confirm',
    sensitivity: 'standard',
    extractable: true,
    label: 'Cover term',
  },
  'protection.health.smoker': {
    schema: z.boolean(),
    subject: 'person',
    reuse: 'never',
    sensitivity: 'special',
    extractable: false,
    label: 'Smoker',
  },
  'protection.health.heightCm': {
    schema: z.number().int().positive().max(260),
    subject: 'person',
    reuse: 'never',
    sensitivity: 'special',
    extractable: false,
    label: 'Height',
  },
  'protection.health.weightKg': {
    schema: z.number().int().positive().max(400),
    subject: 'person',
    reuse: 'never',
    sensitivity: 'special',
    extractable: false,
    label: 'Weight',
  },
  'protection.health.conditions': {
    schema: z.array(z.string().min(2).max(120)).max(20),
    subject: 'person',
    reuse: 'never',
    sensitivity: 'special',
    extractable: false,
    label: 'Medical conditions',
  },
} as const satisfies Record<string, FactDefinition>

export type FactCatalogue = typeof factCatalogue
export type FactKey = keyof FactCatalogue

/** The validated value type for a given key, inferred from its schema. */
export type FactValue<K extends FactKey> = z.infer<FactCatalogue[K]['schema']>

export const FACT_KEYS = Object.keys(factCatalogue) as readonly FactKey[]

// ---------------------------------------------------------------------------
// The stored fact
// ---------------------------------------------------------------------------

export type Fact = {
  readonly id: FactId
  readonly key: FactKey
  readonly subject: FactSubject
  readonly value: unknown
  readonly source: FactSource
  readonly verified: boolean
  /**
   * Which application this was captured for, or `null` for context gathered in general
   * conversation. Drives the questions-avoided metric (§53).
   */
  readonly capturedFor: ApplicationId | null
  /** Non-null once a newer fact replaces this one. Superseded facts never satisfy anything. */
  readonly supersededBy: FactId | null
  readonly capturedAt: string
}

// ---------------------------------------------------------------------------
// Catalogue access
// ---------------------------------------------------------------------------

export function isFactKey(value: string): value is FactKey {
  return Object.prototype.hasOwnProperty.call(factCatalogue, value)
}

export function factDefinition<K extends FactKey>(key: K): FactCatalogue[K] {
  return factCatalogue[key]
}

export type FactValueResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly string[] }

/**
 * Validates a value against its catalogue schema. Every write goes through this, so an
 * invalid value can never reach the database.
 */
export function parseFactValue(key: FactKey, value: unknown): FactValueResult {
  const result = factCatalogue[key].schema.safeParse(value)
  if (result.success) return { ok: true, value: result.data }

  /*
   * A date the model wrote the way a person says it.
   *
   * "01/01/1988", "11/2026" and "November 2026" were each refused for their format, and each
   * refusal cost a model round to say the same thing again in ISO (cases ad93c361, eb37e9b5).
   * The value is unambiguous; only its spelling was wrong. Tried only after the schema has
   * refused, so nothing that already parses is touched.
   */
  if (typeof value === 'string') {
    const normalised = normaliseDate(value)
    if (normalised !== null && normalised !== value) {
      const retry = factCatalogue[key].schema.safeParse(normalised)
      if (retry.success) return { ok: true, value: retry.data }
    }
  }

  return {
    ok: false,
    issues: result.error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    ),
  }
}

/** Invariant 6: the model may never write a fact the catalogue marks non-extractable. */
export function isModelExtractable(key: FactKey): boolean {
  return factCatalogue[key].extractable
}

export function isSpecialCategory(key: FactKey): boolean {
  return factCatalogue[key].sensitivity === 'special'
}

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  sept: '09',
  oct: '10',
  nov: '11',
  dec: '12',
}

/**
 * A date as a person writes it, as ISO. Null when it is not a date this recognises.
 *
 * Day-first, because this is Ireland: "01/02/1988" is the first of February. A month and a
 * year become YYYY-MM; a month name is accepted in full or in three letters. Anything looser
 * ("end of next year") stays with the model, which has the conversation and can ask.
 */
export function normaliseDate(value: string): string | null {
  const text = value.trim()

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  if (dmy !== null) {
    const [, day, month, year] = dmy
    return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const my = /^(\d{1,2})[/.-](\d{4})$/.exec(text)
  if (my !== null) {
    const [, month, year] = my
    return `${String(year)}-${String(month).padStart(2, '0')}`
  }

  const named = /^(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text)
  if (named !== null) {
    const [, day, name, year] = named
    const month = MONTHS[String(name).slice(0, 3).toLowerCase()]
    if (month === undefined) return null
    return day === undefined
      ? `${String(year)}-${month}`
      : `${String(year)}-${month}-${String(day).padStart(2, '0')}`
  }

  return null
}
