import { defineJourney } from '../journey.ts'

/**
 * §7.2 — a current account in one name.
 *
 * The joint account was built first because it is the one that demonstrates invitation and
 * partner completion, which left somebody on their own being told the only current account on
 * offer was a joint one. That is a gap in the catalogue reading as a gap in the bank.
 *
 * Deliberately the shortest journey here. Opening a current account is the least that any of
 * these asks of somebody, and padding it out to look substantial would misrepresent it — there
 * is no income check and nothing to assess, because nothing is being lent.
 */
export const currentAccount = defineJourney({
  product: 'current_account',
  status: 'draft',
  source: null,
  displayName: 'Current account',
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

    {
      kind: 'document',
      id: 'photo-id',
      subject: 'primary',
      label: 'Photo ID',
      documentType: 'photo_id',
    },
    {
      kind: 'document',
      id: 'address-proof',
      subject: 'primary',
      label: 'Proof of address',
      documentType: 'proof_of_address',
    },

    {
      kind: 'declaration',
      id: 'terms',
      subject: 'primary',
      label: 'Current account terms and conditions',
      fresh: true,
    },
  ],
})
