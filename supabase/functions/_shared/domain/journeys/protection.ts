import { defineJourney } from '../journey.ts'

/**
 * §7.5 — the materially different journey.
 *
 * Health information is never inferred from adjacent financial data. Every health requirement
 * sits behind a branch gated on an explicit consent confirmation, and every health fact is
 * marked `special`, `never` reusable and non-extractable in the catalogue, so `record_facts`
 * refuses it outright (Invariant 6).
 */
export const protection = defineJourney({
  product: 'protection',
  status: 'draft',
  source: null,
  displayName: 'Life assurance and family protection',
  supportsPartner: true,
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
      id: 'dependants',
      fact: 'household.dependantCount',
      subject: 'household',
      label: 'Number of dependants',
    },

    // The shape of the cover is ordinary information.
    {
      kind: 'fact',
      id: 'cover-amount',
      fact: 'protection.coverAmount',
      subject: 'household',
      label: 'Amount of cover',
    },
    {
      kind: 'fact',
      id: 'cover-term',
      fact: 'protection.coverTermYears',
      subject: 'household',
      label: 'Length of cover',
    },

    // The gate in front of everything sensitive.
    {
      kind: 'confirmation',
      id: 'health-consent',
      subject: 'primary',
      label: 'Consent to answer health questions',
      fresh: true,
    },

    {
      kind: 'declaration',
      id: 'protection-declaration',
      subject: 'primary',
      label: 'Protection application declaration',
      fresh: true,
    },
  ],
  branches: [
    {
      id: 'health-questions',
      describe: 'The customer has consented to health questions',
      when: (_facts, confirmed) => confirmed('health-consent'),
      requirements: [
        {
          kind: 'fact',
          id: 'smoker',
          fact: 'protection.health.smoker',
          subject: 'primary',
          label: 'Do you smoke',
        },
        {
          kind: 'fact',
          id: 'height',
          fact: 'protection.health.heightCm',
          subject: 'primary',
          label: 'Your height',
        },
        {
          kind: 'fact',
          id: 'weight',
          fact: 'protection.health.weightKg',
          subject: 'primary',
          label: 'Your weight',
        },
        {
          kind: 'fact',
          id: 'conditions',
          fact: 'protection.health.conditions',
          subject: 'primary',
          label: 'Any medical conditions',
        },
      ],
    },
    {
      id: 'joint-cover',
      describe: 'Cover includes a partner, who must consent and answer separately',
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
          kind: 'confirmation',
          id: 'partner-health-consent',
          subject: 'partner',
          label: 'Consent to answer health questions',
          fresh: true,
        },
        {
          kind: 'declaration',
          id: 'partner-protection-declaration',
          subject: 'partner',
          label: 'Protection application declaration',
          fresh: true,
        },
      ],
    },
    {
      id: 'partner-health-questions',
      describe: 'The partner has consented to health questions',
      when: (_facts, confirmed) => confirmed('partner-health-consent'),
      requirements: [
        {
          kind: 'fact',
          id: 'partner-smoker',
          fact: 'protection.health.smoker',
          subject: 'partner',
          label: 'Does your partner smoke',
        },
        {
          kind: 'fact',
          id: 'partner-conditions',
          fact: 'protection.health.conditions',
          subject: 'partner',
          label: 'Any medical conditions',
        },
      ],
    },
  ],
})
