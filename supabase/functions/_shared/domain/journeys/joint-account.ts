import { defineJourney } from '../journey.ts'

/**
 * §7.2 — the multi-party journey. A joint account inherently needs two applicants, so the
 * partner requirements sit in the base set rather than behind a branch: this journey is the
 * one that demonstrates invitation and partner completion (§6 Stage 9).
 */
export const jointAccount = defineJourney({
  product: 'joint_account',
  status: 'draft',
  source: null,
  displayName: 'Joint current account',
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
      id: 'ppsn',
      fact: 'identity.ppsn',
      subject: 'primary',
      label: 'Your PPS number',
    },
    {
      kind: 'fact',
      id: 'email',
      fact: 'identity.email',
      subject: 'primary',
      label: 'Your email address',
    },
    {
      kind: 'fact',
      id: 'mobile',
      fact: 'identity.mobile',
      subject: 'primary',
      label: 'Your mobile number',
    },
    {
      kind: 'fact',
      id: 'employment-status',
      fact: 'employment.status',
      subject: 'primary',
      label: 'Your employment status',
    },

    // The second applicant. One answer from the partner satisfies these and the mortgage's
    // equivalents at the same time (§6 Stage 9).
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
      id: 'partner-address',
      fact: 'identity.address',
      subject: 'partner',
      label: "Your partner's home address",
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
      id: 'partner-email',
      fact: 'identity.email',
      subject: 'partner',
      label: "Your partner's email address",
    },
    {
      kind: 'fact',
      id: 'partner-employment-status',
      fact: 'employment.status',
      subject: 'partner',
      label: "Your partner's employment status",
    },
    {
      kind: 'document',
      id: 'partner-doc-id',
      subject: 'partner',
      label: "Your partner's photo ID",
      documentType: 'photo_id',
    },

    {
      kind: 'declaration',
      id: 'terms',
      subject: 'primary',
      label: 'Joint account terms and conditions',
      fresh: true,
    },
    {
      kind: 'declaration',
      id: 'partner-terms',
      subject: 'partner',
      label: 'Joint account terms and conditions',
      fresh: true,
    },
  ],
})
