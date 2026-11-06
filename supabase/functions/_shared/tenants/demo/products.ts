import type { Product } from '../../domain/journey.ts'
import type { ProductVariant } from '../../domain/quotes/types.ts'

/**
 * §51 — the seven products Saoirse can actually start, and the rates it calculates with.
 *
 * This used to be the whole catalogue, invented. The descriptions, eligibility and cautions
 * Saoirse speaks from now come from `knowledge-base.ts`, which is Demo Bank's illustrative synthetic
 * offering; what is left here is the part that pack deliberately does not carry.
 *
 * `variants` are still illustrative and still invented. The pack holds no mortgage rate table
 * and no protection premiums — it lists both under `not_authoritative_for` — so a card that
 * works out a repayment has to work it out from something. `kb-prompt.ts` renders them under a
 * heading that says so, separately from the real catalogue, because the two are not the same
 * kind of claim and putting them in one list would make them look it.
 */

export type IllustrativeTerm = {
  readonly label: string
  readonly value: string
}

export type ProductInfo = {
  readonly product: Product
  readonly name: string
  /** One sentence, in the customer's language rather than the bank's. */
  readonly oneLine: string
  readonly description: string
  /** Circumstances in which this is genuinely worth raising (§49: discovery, not cross-selling). */
  readonly relevantWhen: readonly string[]
  readonly eligibility: readonly string[]
  readonly illustrativeTerms: readonly IllustrativeTerm[]
  /** Present where the product has numbers worth comparing. Absent where it does not. */
  readonly variants?: readonly ProductVariant[]
  /** Anything Saoirse should be careful about when explaining this product. */
  readonly cautions: readonly string[]
}

export const demoProducts: Readonly<Record<Product, ProductInfo>> = {
  mortgage: {
    product: 'mortgage',
    name: 'Mortgage',
    oneLine: 'A loan secured on the home you are buying.',
    description:
      'A long-term loan to buy a property, repaid monthly over an agreed term. How much can be ' +
      'lent depends on income, existing commitments and the deposit available.',
    relevantWhen: [
      'The customer is buying a property.',
      'The customer is moving home or switching an existing mortgage.',
    ],
    eligibility: [
      'Applicants must be 18 or over.',
      'A deposit is required; first-time buyers typically need at least 10% of the purchase price.',
      'Lending is subject to assessment of income, outgoings and existing credit commitments.',
      'The property must be in the Republic of Ireland.',
    ],
    illustrativeTerms: [
      { label: 'Illustrative term', value: 'Up to 35 years' },
      { label: 'Illustrative maximum loan', value: '4 times combined gross annual income' },
    ],
    variants: [
      {
        id: 'fixed_4y',
        name: '4-year fixed',
        highlight: 'Lowest monthly',
        shape: 'borrowing',
        annualRate: 0.031,
        fixedYears: 4,
        maxMonths: 420,
        note: 'The rate is held for four years, then moves to the variable rate of the day.',
      },
      {
        id: 'fixed_1y',
        name: '1-year fixed',
        highlight: 'Most flexible',
        shape: 'borrowing',
        annualRate: 0.033,
        fixedYears: 1,
        maxMonths: 420,
        note: 'Only held for a year, so you can switch sooner without a break cost.',
      },
      {
        id: 'fixed_5y',
        name: '5-year fixed',
        highlight: 'Longest certainty',
        shape: 'borrowing',
        annualRate: 0.034,
        fixedYears: 5,
        maxMonths: 420,
        note: 'Five years of knowing exactly what you pay.',
      },
      {
        id: 'variable',
        name: 'Variable',
        shape: 'borrowing',
        annualRate: 0.039,
        maxMonths: 420,
        note: 'Moves with rates. Overpay or clear it early with no break cost.',
      },
    ],
    cautions: [
      'Never state or imply an approval decision. Assessment is done by the mortgage team.',
      'Do not estimate how much the customer can borrow.',
    ],
  },

  current_account: {
    product: 'current_account',
    name: 'Current account',
    oneLine: 'A day-to-day account in your own name.',
    description:
      'An everyday account for a salary to be paid into and bills to be paid out of. It is what ' +
      'makes a standing order possible, and what lets income and outgoings be read from records ' +
      'rather than asked for when somebody applies for something else.',
    relevantWhen: [
      'The customer is paid somewhere else and wants their day-to-day banking in one place.',
      'The customer wants saving or bills automated out of the account their salary lands in.',
      'The customer is starting out, or starting again, and has no everyday account.',
    ],
    eligibility: [
      'Applicants must be 18 or over and resident in the Republic of Ireland.',
      'Identity and address must be verified.',
    ],
    illustrativeTerms: [
      { label: 'Illustrative monthly maintenance fee', value: '€6' },
      { label: 'Illustrative overdraft', value: 'Subject to application' },
      { label: 'Switching', value: 'Your existing payments and direct debits can be moved across' },
    ],
    cautions: [
      'Never say a switch is instant or guaranteed. It is a process, and how long it takes is ' +
        'not something this catalogue states.',
      'Opening one is never a condition of anything else. Say what it makes possible, and leave ' +
        'it there.',
    ],
  },

  joint_account: {
    product: 'joint_account',
    name: 'Joint current account',
    oneLine: 'A day-to-day account in two names.',
    description:
      'A current account held by two people, both able to pay in, spend and see everything on ' +
      'the account. Commonly opened when a couple starts running household costs together.',
    relevantWhen: [
      'The customer manages, or wants to start managing, money together with someone else.',
      'The customer has recently married or moved in with a partner.',
    ],
    eligibility: [
      'Both applicants must be 18 or over and resident in the Republic of Ireland.',
      'Both applicants must complete identity verification.',
      'Both applicants must agree to the account terms.',
    ],
    illustrativeTerms: [
      { label: 'Illustrative monthly maintenance fee', value: '€6' },
      { label: 'Illustrative overdraft', value: 'Subject to application' },
    ],
    cautions: [
      'Both parties see all transactions. Mention this if the customer seems unsure about ' +
        'combining finances.',
    ],
  },

  credit_card: {
    product: 'credit_card',
    name: 'Credit card',
    oneLine: 'A card with a borrowing limit, repaid monthly.',
    description:
      'A revolving credit facility with an assigned limit. The balance can be repaid in full ' +
      'each month or carried, with interest charged on what is carried.',
    relevantWhen: [
      'The customer expects irregular or one-off costs.',
      'The customer has no card with us and wants a payment method with some flexibility.',
    ],
    eligibility: [
      'Applicants must be 18 or over with a regular income.',
      'Subject to credit assessment.',
      'The credit limit offered is set by that assessment, not chosen by the customer.',
    ],
    illustrativeTerms: [
      { label: 'Illustrative minimum repayment', value: '5% of the balance, or €5' },
      { label: 'Illustrative government stamp duty', value: '€30 a year' },
    ],
    variants: [
      {
        id: 'card_standard',
        name: 'Standard card',
        shape: 'revolving',
        annualRate: 0.229,
        note: 'Interest only on what is left unpaid at the end of the month.',
      },
      {
        id: 'card_low_rate',
        name: 'Low rate card',
        highlight: 'Cheapest to carry',
        shape: 'revolving',
        annualRate: 0.139,
        note: 'For a balance you expect to clear over months rather than weeks.',
      },
    ],
    cautions: [
      'Do not state the limit the customer will receive.',
      'If the customer is applying for a mortgage, mention that new credit forms part of the ' +
        'wider affordability picture.',
    ],
  },

  personal_loan: {
    product: 'personal_loan',
    name: 'Personal loan',
    oneLine: 'A fixed amount borrowed over a fixed term.',
    description:
      'A lump sum borrowed and repaid in equal monthly instalments over an agreed period. ' +
      'Often used for a specific, known cost.',
    relevantWhen: [
      'The customer has a specific cost in mind and a sense of the amount.',
      'The customer is furnishing or renovating a new home.',
    ],
    eligibility: [
      'Applicants must be 18 or over with a regular income.',
      'Subject to credit assessment.',
      'Minimum and maximum loan amounts apply.',
    ],
    illustrativeTerms: [{ label: 'Illustrative amount', value: '€2,000 to €75,000' }],
    variants: [
      {
        id: 'loan_3y',
        name: 'Over 3 years',
        highlight: 'Least interest',
        shape: 'borrowing',
        annualRate: 0.079,
        minAmount: 2_000,
        maxAmount: 75_000,
        minMonths: 36,
        maxMonths: 36,
      },
      {
        id: 'loan_5y',
        name: 'Over 5 years',
        highlight: 'Lowest monthly',
        shape: 'borrowing',
        annualRate: 0.085,
        minAmount: 2_000,
        maxAmount: 75_000,
        minMonths: 60,
        maxMonths: 60,
      },
      {
        id: 'loan_7y',
        name: 'Over 7 years',
        shape: 'borrowing',
        annualRate: 0.094,
        minAmount: 10_000,
        maxAmount: 75_000,
        minMonths: 84,
        maxMonths: 84,
        note: 'Only for larger amounts, and the longer term costs more overall.',
      },
    ],
    cautions: [
      'Where a mortgage application is active, additional borrowing affects affordability. ' +
        'The loan_vs_mortgage advisory covers this; explain it rather than pushing the loan.',
    ],
  },

  protection: {
    product: 'protection',
    name: 'Life assurance and family protection',
    oneLine: 'A payment to the people who depend on you, if you die during the cover term.',
    description:
      'Life cover pays an agreed amount if the insured person dies within the term of the ' +
      'policy. Mortgage protection is a form of this, sized to clear the outstanding mortgage.',
    relevantWhen: [
      'Someone depends financially on the customer, such as a child or a partner.',
      'The customer is taking on a mortgage.',
    ],
    eligibility: [
      'Applicants must be 18 or over.',
      'Cover is subject to health questions, which the customer answers themselves.',
      'Premiums depend on age, cover amount, term and the health information provided.',
    ],
    illustrativeTerms: [
      { label: 'Illustrative cover', value: '€100,000 to €1,000,000' },
      { label: 'Illustrative term', value: 'Up to 40 years, or the mortgage term' },
    ],
    cautions: [
      'NEVER infer health information from anything the customer has said, and never ask a ' +
        'health question in conversation. Health data is collected only through the consented ' +
        'structured form (§7.5).',
      'This is a sensitive subject. Do not use humour when discussing death, illness or ' +
        'dependants.',
    ],
  },

  savings: {
    product: 'savings',
    name: 'Savings account',
    oneLine: 'Somewhere to build a deposit, separate from day-to-day money.',
    description:
      'A regular savings account you pay into each month. Keeping the deposit apart from your current account makes it harder to dip into, and a steady record of saving is something a mortgage assessment looks at in your favour.',
    relevantWhen: [
      'they are saving towards a home deposit and are not there yet',
      'they hold savings elsewhere and want everything in one place',
      'they want the deposit kept separate from everyday spending',
    ],
    eligibility: [
      'Over 18 and resident in the Republic of Ireland',
      'A current account is not required to open one',
    ],
    illustrativeTerms: [
      { label: 'Monthly amount', value: 'From €50 to €2,500 a month' },
      { label: 'Access', value: 'Withdraw at any time without notice' },
      {
        label: 'Interest',
        value: 'Illustrative only — real rates come from the live product pages',
      },
    ],
    variants: [
      {
        id: 'save_instant',
        name: 'Instant access',
        highlight: 'Money stays available',
        shape: 'saving',
        annualRate: 0.02,
        note: 'Take it out whenever you need it.',
      },
      {
        id: 'save_regular',
        name: 'Regular saver',
        highlight: 'Best rate',
        shape: 'saving',
        annualRate: 0.03,
        note: 'A better rate for paying in every month without dipping into it.',
      },
      {
        id: 'save_fixed_1y',
        name: 'Fixed for a year',
        shape: 'saving',
        annualRate: 0.035,
        minMonths: 12,
        note: 'Locked away for a year, which is why it pays more.',
      },
    ],
    cautions: [
      "Moving savings from another bank is the customer's decision, not a recommendation to make for them. Explain what having it in one place does and does not change, and leave the choice with them.",
      'Saving towards a deposit is not the same as qualifying for a mortgage. Never imply that reaching a target guarantees an approval.',
    ],
  },
}

export const ALL_PRODUCTS: readonly ProductInfo[] = Object.values(demoProducts)

export function productInfo(product: Product): ProductInfo {
  return demoProducts[product]
}
