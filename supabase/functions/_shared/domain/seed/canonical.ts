import type { FactKey, FactSource } from '../facts.ts'
import type { Product } from '../journey.ts'

/**
 * The canonical presenter case (§43 reset, §46 demo customer).
 *
 * Invariant 10: synthetic data only. Nothing here corresponds to a real person, a real
 * Demo Bank customer record or a real national identifier.
 *
 * The customer is the §5 scenario: an existing Demo Bank customer with only a personal current
 * account, recently married, recently a parent, buying their first home with their spouse.
 */

export type SeedSubject = 'primary' | 'partner' | 'household'

export type SeedFact = {
  readonly key: FactKey
  readonly subject: SeedSubject
  readonly value: unknown
  readonly source: FactSource
  readonly verified: boolean
}

export type SeedPerson = {
  readonly label: string
  readonly fullName: string
  readonly firstName: string
  readonly dateOfBirth: string
  readonly email: string
  readonly mobile: string
}

/** The primary customer. */
export const canonicalCustomer = {
  /** Synthetic bank reference, used by the simulated login and the case inspector. */
  bankReference: 'DEMO-SYNTHETIC-000417',
  label: 'Primary customer',
  fullName: 'Aoife Ní Bhriain',
  firstName: 'Aoife',
  dateOfBirth: '1992-04-17',
  email: 'aoife.demo@example.invalid',
  mobile: '+353871000417',
  /** What the bank already holds for this customer (§5): one current account, nothing else. */
  existingProducts: ['personal_current_account'] as const,
} as const satisfies SeedPerson & Record<string, unknown>

/**
 * The spouse. The vision document calls her Sarah and the requirements call her Emma; the
 * requirements win (CLAUDE.md > Open items), so the seed uses Emma.
 */
export const canonicalPartner = {
  label: 'Spouse',
  fullName: 'Emma Ní Bhriain',
  firstName: 'Emma',
  dateOfBirth: '1991-11-02',
  email: 'emma.demo@example.invalid',
  mobile: '+353871000418',
} as const satisfies SeedPerson

/**
 * Facts the bank already holds, loaded on authentication (§6 Stage 5).
 *
 * `identity.maritalStatus` is deliberately stale: the bank still has "single" because the
 * customer married recently and never told it. When the customer mentions the wedding, the
 * new fact supersedes this one, which is what makes provenance visible on screen.
 *
 * Income is bank-held but unverified — inferred from salary credits, not evidenced — so the
 * mortgage's `confirm` policy still asks the customer to confirm it rather than assuming it.
 */
export const bankHeldFacts: readonly SeedFact[] = [
  {
    key: 'identity.fullName',
    subject: 'primary',
    value: canonicalCustomer.fullName,
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'identity.dateOfBirth',
    subject: 'primary',
    value: canonicalCustomer.dateOfBirth,
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'identity.address',
    subject: 'primary',
    value: '14 Seapoint Terrace, Dublin 8, D08 XY12',
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'identity.yearsAtAddress',
    subject: 'primary',
    value: 3,
    source: 'bank_held',
    verified: false,
  },
  {
    key: 'identity.email',
    subject: 'primary',
    value: canonicalCustomer.email,
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'identity.mobile',
    subject: 'primary',
    value: canonicalCustomer.mobile,
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'identity.nationality',
    subject: 'primary',
    value: 'Irish',
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'identity.ppsn',
    subject: 'primary',
    value: '9000417T',
    source: 'bank_held',
    verified: true,
  },
  // Stale on purpose. See the note above.
  {
    key: 'identity.maritalStatus',
    subject: 'primary',
    value: 'single',
    source: 'bank_held',
    verified: false,
  },
  {
    key: 'employment.status',
    subject: 'primary',
    value: 'employed_full_time',
    source: 'bank_held',
    verified: false,
  },
  {
    key: 'employment.employerName',
    subject: 'primary',
    value: 'Ardán Software Limited',
    source: 'bank_held',
    verified: false,
  },
  {
    key: 'income.annualBasic',
    subject: 'primary',
    value: 92_000,
    source: 'bank_held',
    verified: false,
  },
  {
    key: 'liabilities.creditCardBalance',
    subject: 'primary',
    value: 0,
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'liabilities.monthlyLoanRepayments',
    subject: 'primary',
    value: 0,
    source: 'bank_held',
    verified: true,
  },
  {
    key: 'banking.existingCustomer',
    subject: 'primary',
    value: true,
    source: 'bank_held',
    verified: true,
  },
]

/**
 * What the customer says in the opening exchange, for the "start from the conversation"
 * variant of the demo. Not pre-loaded into the presenter case: Saoirse discovers these live.
 */
export const discoverableFacts: readonly SeedFact[] = [
  {
    key: 'goals.primaryObjective',
    subject: 'household',
    value: 'Buying our first home',
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'identity.maritalStatus',
    subject: 'primary',
    value: 'married',
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'lifeEvent.recentlyMarried',
    subject: 'household',
    value: true,
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'lifeEvent.newChild',
    subject: 'household',
    value: true,
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'household.buyingWith',
    subject: 'household',
    value: 'partner',
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'household.dependantCount',
    subject: 'household',
    value: 1,
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'household.financesManagedJointly',
    subject: 'household',
    value: false,
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'housing.currentTenure',
    subject: 'household',
    value: 'renting',
    source: 'customer_stated',
    verified: false,
  },
  {
    key: 'housing.firstTimeBuyer',
    subject: 'household',
    value: true,
    source: 'customer_stated',
    verified: false,
  },
]

/**
 * The products Saoirse may raise for this case, in the order the §6 Stage 3 discovery reaches
 * them. The mortgage is the customer's own request; the rest are discovered.
 */
export const canonicalProductInterests: readonly {
  readonly product: Product
  readonly discovered: boolean
  readonly reason: string
}[] = [
  { product: 'mortgage', discovered: false, reason: 'What the customer came for.' },
  {
    product: 'joint_account',
    discovered: true,
    reason: 'Recently married and still managing money separately.',
  },
  {
    product: 'current_account',
    discovered: true,
    reason: 'Salary paid elsewhere, so nothing here can automate the saving.',
  },
  {
    product: 'protection',
    discovered: true,
    reason: 'A new child and a first mortgage between them.',
  },
  {
    product: 'credit_card',
    discovered: true,
    reason: 'Moving costs, and the customer has no card with us.',
  },
  {
    product: 'savings',
    discovered: true,
    reason: 'Still building the deposit, and holding savings with another bank.',
  },
  {
    product: 'personal_loan',
    discovered: true,
    reason: 'Expecting significant costs on moving in.',
  },
]

/** Everything the reset needs, in one object (§43). */
export const canonicalCase = {
  customer: canonicalCustomer,
  partner: canonicalPartner,
  bankHeldFacts,
  discoverableFacts,
  productInterests: canonicalProductInterests,
  /** Shown in the admin console so the presenter can tell the case apart from audience cases. */
  label: 'Canonical presenter case',
} as const
