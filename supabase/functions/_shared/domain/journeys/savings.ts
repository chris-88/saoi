import { defineJourney } from '../journey.ts'

/**
 * §7 — a regular saver, opened on the way to something else.
 *
 * Short on purpose. A savings account is not a credit decision: there is no affordability to
 * assess and nothing to underwrite, so asking for the furniture of a mortgage application
 * would be theatre. What it does need is the target and the monthly amount, because those are
 * what make the plan — and the follow-up when the target is reached — possible at all.
 */
export const savings = defineJourney({
  product: 'savings',
  status: 'draft',
  source: null,
  displayName: 'Savings account',
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

    // The two that make it a plan rather than an account.
    {
      kind: 'fact',
      id: 'target',
      fact: 'goals.savingsTarget',
      subject: 'household',
      label: 'What you are saving towards',
    },
    {
      kind: 'fact',
      id: 'monthly',
      fact: 'goals.monthlySaving',
      subject: 'household',
      label: 'How much you can put away each month',
    },

    {
      kind: 'declaration',
      id: 'savings-declaration',
      subject: 'primary',
      label: 'Savings account declaration',
      fresh: true,
    },
  ],
  branches: [],
})
