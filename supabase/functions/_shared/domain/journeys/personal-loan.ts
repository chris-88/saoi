import { defineJourney } from '../journey.ts'

/**
 * §7.4 — contextual decision support. Financial information is reused, but the amount and
 * purpose are always asked fresh, because they are specific to this borrowing request.
 *
 * This is the journey the `loan_vs_mortgage` advisory holds back (§6 Stage 8).
 */
export const personalLoan = defineJourney({
  product: 'personal_loan',
  status: 'draft',
  source: null,
  displayName: 'Personal loan',
  supportsPartner: false,
  requirements: [
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
      id: 'ppsn',
      fact: 'identity.ppsn',
      subject: 'primary',
      label: 'Your PPS number',
    },
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
    {
      kind: 'fact',
      id: 'other-outgoings',
      fact: 'expenditure.monthlyOther',
      subject: 'household',
      label: 'Other monthly outgoings',
    },

    // Specific to this request: the catalogue already marks both `fresh`.
    {
      kind: 'fact',
      id: 'amount',
      fact: 'borrowing.requestedAmount',
      subject: 'household',
      label: 'How much you want to borrow',
    },
    {
      kind: 'fact',
      id: 'purpose',
      fact: 'borrowing.purpose',
      subject: 'household',
      label: 'What the loan is for',
    },

    {
      kind: 'document',
      id: 'doc-bank-statement',
      subject: 'primary',
      label: 'Three months of bank statements',
      documentType: 'bank_statement',
    },
    {
      kind: 'declaration',
      id: 'loan-declaration',
      subject: 'primary',
      label: 'Loan application declaration',
      fresh: true,
    },
  ],
})
