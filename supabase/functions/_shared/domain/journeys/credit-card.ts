import { defineJourney } from '../journey.ts'

/**
 * §7.3 — the reuse showcase. Every requirement here is something the mortgage conversation or
 * the bank already knows, so for an existing customer this journey should need almost nothing
 * asked afresh. Only the declaration is unavoidable.
 */
export const creditCard = defineJourney({
  product: 'credit_card',
  status: 'draft',
  source: null,
  displayName: 'Credit card',
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
      id: 'years-at-address',
      fact: 'identity.yearsAtAddress',
      subject: 'primary',
      label: 'Years at that address',
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
      id: 'dependants',
      fact: 'household.dependantCount',
      subject: 'household',
      label: 'Number of dependants',
    },
    {
      kind: 'fact',
      id: 'loan-repayments',
      fact: 'liabilities.monthlyLoanRepayments',
      subject: 'primary',
      label: 'Monthly loan repayments',
    },

    {
      kind: 'declaration',
      id: 'credit-declaration',
      subject: 'primary',
      label: 'Credit application declaration',
      fresh: true,
    },
  ],
})
