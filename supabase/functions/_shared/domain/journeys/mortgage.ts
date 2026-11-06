import { defineJourney } from '../journey.ts'

/**
 * §7.1 — the anchor journey. Primary and secondary applicant, the richest financial
 * requirements, documents, and post-submission state changes.
 *
 * Information gathered here is what every other journey then reuses.
 *
 * Sized for a demonstration (2026-10-05). It carried 41 applicable requirements, which cannot
 * be completed in front of an audience — and because every admin move starts from
 * `received_by_bank`, an application that can never be submitted means the bank can never move
 * it, so the whole second half of §67 was unreachable. What was cut is the form-filling that
 * carries no part of the story: occupation, employment start date, bonus, childcare, and three
 * of the five documents. What was kept is everything the bank already holds (free to satisfy,
 * and the point of §53), everything the affordability conversation turns on, and enough of the
 * second applicant to show one answer landing in several applications.
 *
 * The recordings still have not been translated, so this stays `draft` either way.
 */
export const mortgage = defineJourney({
  product: 'mortgage',
  status: 'draft',
  source: null,
  displayName: 'Mortgage',
  supportsPartner: true,
  requirements: [
    // ---- Identity ----
    // Bank-held for a signed-in customer, so these cost nothing and are the clearest
    // demonstration of §53: the questions that never had to be asked.
    {
      kind: 'fact',
      id: 'name',
      fact: 'identity.fullName',
      subject: 'primary',
      label: 'Your full name',
    },
    {
      kind: 'fact',
      id: 'dob',
      fact: 'identity.dateOfBirth',
      subject: 'primary',
      label: 'Your date of birth',
    },
    {
      kind: 'fact',
      id: 'address',
      fact: 'identity.address',
      subject: 'primary',
      label: 'Your home address',
    },
    {
      kind: 'fact',
      id: 'marital-status',
      fact: 'identity.maritalStatus',
      subject: 'primary',
      label: 'Your marital status',
    },
    {
      kind: 'fact',
      id: 'ppsn',
      fact: 'identity.ppsn',
      subject: 'primary',
      label: 'Your PPS number',
    },

    // ---- Household ----
    {
      kind: 'fact',
      id: 'buying-with',
      fact: 'household.buyingWith',
      subject: 'household',
      label: 'Buying alone or with someone',
    },
    {
      kind: 'fact',
      id: 'dependants',
      fact: 'household.dependantCount',
      subject: 'household',
      label: 'Number of dependants',
    },

    // ---- Employment and income ----
    {
      kind: 'fact',
      id: 'employment-status',
      fact: 'employment.status',
      subject: 'primary',
      label: 'Your employment status',
    },
    {
      kind: 'fact',
      id: 'employer',
      fact: 'employment.employerName',
      subject: 'primary',
      label: 'Your employer',
    },
    {
      kind: 'fact',
      id: 'income-basic',
      fact: 'income.annualBasic',
      subject: 'primary',
      label: 'Your annual basic salary',
    },

    // ---- Assets and liabilities, whichever kind of mortgage ----
    {
      kind: 'fact',
      id: 'savings',
      fact: 'assets.savingsBalance',
      subject: 'household',
      label: 'Your savings',
    },
    {
      kind: 'fact',
      id: 'loan-repayments',
      fact: 'liabilities.monthlyLoanRepayments',
      subject: 'primary',
      label: 'Monthly loan repayments',
    },
    {
      kind: 'fact',
      id: 'card-balance',
      fact: 'liabilities.creditCardBalance',
      subject: 'primary',
      label: 'Credit card balance',
    },

    // ---- Documents ----
    // Two, not five. Each one is a file picker on camera, and the payslip alone carries the
    // verification beat.
    {
      kind: 'document',
      id: 'doc-payslip',
      subject: 'primary',
      label: 'Your most recent payslip',
      documentType: 'payslip',
      requiresVerification: true,
    },
    {
      kind: 'document',
      id: 'doc-id',
      subject: 'primary',
      label: 'Photo ID',
      documentType: 'photo_id',
    },

    // ---- Declaration ----
    {
      kind: 'declaration',
      id: 'mortgage-declaration',
      subject: 'primary',
      label: 'Mortgage application declaration',
      fresh: true,
    },
  ],
  branches: [
    /*
     * Buying and switching are the same journey with a different middle (§7.1).
     *
     * The purchase questions used to be base requirements, so a switcher was asked whether he
     * pays rent, what deposit he has and whether he is a first-time buyer, and was never asked
     * who his mortgage is with (case eb37e9b5). The buyer type decides which middle applies; an
     * unknown type is a purchase, because that is what every mortgage conversation was before
     * the switcher existed and nothing about it changes.
     */
    {
      id: 'purchase',
      describe:
        'Buying a home, so the price, the deposit and the current housing costs are assessed',
      when: (facts) => facts.get('mortgage.customerType', 'household') !== 'switcher',
      requirements: [
        {
          kind: 'fact',
          id: 'current-tenure',
          fact: 'housing.currentTenure',
          subject: 'household',
          label: 'Your current housing',
        },
        {
          kind: 'fact',
          id: 'rent',
          fact: 'expenditure.monthlyRent',
          subject: 'household',
          label: 'Monthly rent',
        },
        {
          kind: 'fact',
          id: 'deposit',
          fact: 'assets.depositAmount',
          subject: 'household',
          label: 'Deposit available',
        },
        {
          kind: 'fact',
          id: 'purchase-price',
          fact: 'housing.purchasePrice',
          subject: 'household',
          label: 'Property price',
        },
        {
          kind: 'fact',
          id: 'property-county',
          fact: 'housing.propertyCounty',
          subject: 'household',
          label: 'Where you are buying',
        },
        {
          kind: 'fact',
          id: 'first-time-buyer',
          fact: 'housing.firstTimeBuyer',
          subject: 'household',
          label: 'First-time buyer',
        },
      ],
    },
    {
      id: 'switcher',
      describe:
        'Switching an existing mortgage, so the current deal and the property\u2019s value are assessed',
      when: (facts) => facts.get('mortgage.customerType', 'household') === 'switcher',
      requirements: [
        {
          kind: 'fact',
          id: 'current-lender',
          fact: 'mortgage.currentLender',
          subject: 'household',
          label: 'Who your mortgage is with now',
        },
        {
          kind: 'fact',
          id: 'balance',
          fact: 'mortgage.amountSought',
          subject: 'household',
          label: 'Balance left on the mortgage',
        },
        {
          kind: 'fact',
          id: 'remaining-term',
          fact: 'mortgage.termYears',
          subject: 'household',
          label: 'Years left on the mortgage',
        },
        {
          kind: 'fact',
          id: 'current-rate',
          fact: 'mortgage.currentRatePct',
          subject: 'household',
          label: 'Your current rate',
        },
        {
          kind: 'fact',
          id: 'current-rate-ends',
          fact: 'mortgage.currentRateEndsAt',
          subject: 'household',
          label: 'When your current rate ends',
        },
        {
          kind: 'fact',
          id: 'property-value',
          fact: 'property.value',
          subject: 'household',
          label: 'What the property is worth',
        },
        // The bank's own checklist: statements showing the last twelve repayments.
        {
          kind: 'document',
          id: 'doc-mortgage-statements',
          subject: 'primary',
          label: 'Statements showing your last 12 mortgage repayments',
          documentType: 'bank_statement',
        },
      ],
    },
    {
      id: 'second-applicant',
      describe: 'Buying with a partner, so a second applicant is assessed too',
      when: (facts) => facts.get('household.buyingWith', 'household') === 'partner',
      requirements: [
        {
          kind: 'fact',
          id: 'partner-name',
          fact: 'identity.fullName',
          subject: 'partner',
          label: "Your partner's full name",
        },
        {
          kind: 'fact',
          id: 'partner-dob',
          fact: 'identity.dateOfBirth',
          subject: 'partner',
          label: "Your partner's date of birth",
        },
        {
          kind: 'fact',
          id: 'partner-ppsn',
          fact: 'identity.ppsn',
          subject: 'partner',
          label: "Your partner's PPS number",
        },
        {
          kind: 'fact',
          id: 'partner-employment-status',
          fact: 'employment.status',
          subject: 'partner',
          label: "Your partner's employment status",
        },
        {
          kind: 'fact',
          id: 'partner-income-basic',
          fact: 'income.annualBasic',
          subject: 'partner',
          label: "Your partner's annual basic salary",
        },
        {
          kind: 'declaration',
          id: 'partner-mortgage-declaration',
          subject: 'partner',
          label: 'Mortgage application declaration',
          fresh: true,
        },
      ],
    },
    {
      id: 'gifted-deposit',
      describe: 'Part of the deposit is a gift, so its source must be evidenced',
      when: (facts) => (facts.number('assets.giftedDeposit', 'household') ?? 0) > 0,
      requirements: [
        {
          kind: 'document',
          id: 'doc-gift-letter',
          subject: 'primary',
          label: 'Letter confirming the gifted deposit',
          documentType: 'bank_statement',
        },
      ],
    },
  ],
})
