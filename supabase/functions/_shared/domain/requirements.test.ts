import { describe, expect, it } from 'vitest'
import {
  asApplicationId,
  asFactId,
  asParticipantId,
  type ApplicationId,
  type Fact,
  type FactKey,
  type FactSource,
  type FactSubject,
} from './facts.ts'
import { defineJourney, type Requirement } from './journey.ts'
import {
  confirmationsForReview,
  evaluateJourney,
  evidenceCovers,
  outstanding,
  readyForReview,
  type AccountEvidence,
  type RequirementContext,
} from './requirements.ts'

const PRIMARY = asParticipantId('participant-primary')
const PARTNER = asParticipantId('participant-partner')
const THIS_APP = asApplicationId('app-this')
const OTHER_APP = asApplicationId('app-other')

let factCounter = 0

function fact(
  key: FactKey,
  subject: FactSubject,
  value: unknown,
  options: {
    capturedFor?: ApplicationId | null
    source?: FactSource
    verified?: boolean
    supersededBy?: string | null
  } = {},
): Fact {
  factCounter += 1
  return {
    id: asFactId(`fact-${factCounter}`),
    key,
    subject,
    value,
    source: options.source ?? 'customer_stated',
    verified: options.verified ?? false,
    capturedFor: options.capturedFor === undefined ? THIS_APP : options.capturedFor,
    supersededBy: options.supersededBy ? asFactId(options.supersededBy) : null,
    capturedAt: '2026-09-30T10:00:00.000Z',
  }
}

function context(overrides: Partial<RequirementContext> = {}): RequirementContext {
  return {
    applicationId: THIS_APP,
    participants: { primary: PRIMARY, partner: null },
    facts: [],
    confirmations: [],
    documents: [],
    ...overrides,
  }
}

function journeyWith(...requirements: Requirement[]) {
  return defineJourney({
    product: 'credit_card',
    displayName: 'Test journey',
    supportsPartner: requirements.some((r) => r.subject === 'partner'),
    requirements,
  })
}

const incomeOf = (subject: 'primary' | 'partner'): Requirement => ({
  kind: 'fact',
  id: `income-${subject}`,
  fact: 'income.annualBasic',
  subject,
  label: 'Annual basic salary',
})

describe('outstanding()', () => {
  it('reports a missing fact as outstanding and blocking', () => {
    const journey = journeyWith(incomeOf('primary'))
    const items = outstanding(journey, context())

    expect(items).toHaveLength(1)
    expect(items[0]?.reason).toBe('missing')
    expect(items[0]?.blocking).toBe(true)
    expect(items[0]?.waitingOn).toBe('primary')
  })

  it('treats a fact captured for this application as satisfied', () => {
    const journey = journeyWith(incomeOf('primary'))
    const items = outstanding(
      journey,
      context({ facts: [fact('income.annualBasic', PRIMARY, 92_000)] }),
    )

    expect(items).toEqual([])
  })

  it('does not let the primary satisfy the partner (subject matching)', () => {
    const journey = journeyWith(incomeOf('primary'), incomeOf('partner'))
    const items = outstanding(
      journey,
      context({
        participants: { primary: PRIMARY, partner: PARTNER },
        facts: [fact('income.annualBasic', PRIMARY, 92_000)],
      }),
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.requirement.id).toBe('income-partner')
    expect(items[0]?.waitingOn).toBe('partner')
  })

  it('satisfies a household requirement from a household fact', () => {
    const journey = journeyWith({
      kind: 'fact',
      id: 'dependants',
      fact: 'household.dependantCount',
      subject: 'household',
      label: 'Dependants',
    })

    expect(
      outstanding(journey, context({ facts: [fact('household.dependantCount', 'household', 1)] })),
    ).toEqual([])
  })

  it('ignores a superseded fact', () => {
    const journey = journeyWith(incomeOf('primary'))
    const items = outstanding(
      journey,
      context({
        facts: [fact('income.annualBasic', PRIMARY, 80_000, { supersededBy: 'fact-newer' })],
      }),
    )

    expect(items[0]?.reason).toBe('missing')
  })

  it('reports a partner requirement as awaiting the partner before one has joined', () => {
    const journey = journeyWith(incomeOf('partner'))
    const items = outstanding(
      journey,
      context({ participants: { primary: PRIMARY, partner: null } }),
    )

    expect(items[0]?.reason).toBe('awaiting_partner')
    expect(items[0]?.waitingOn).toBe('partner')
  })

  it('never blocks on an optional requirement', () => {
    const journey = journeyWith({
      kind: 'fact',
      id: 'other-income',
      fact: 'income.otherAnnual',
      subject: 'primary',
      label: 'Other income',
      optional: true,
    })
    const items = outstanding(journey, context())

    expect(items).toHaveLength(1)
    expect(items[0]?.blocking).toBe(false)
    expect(evaluateJourney(journey, context()).complete).toBe(true)
  })
})

describe('reuse policy', () => {
  const addressRequirement = (reuse?: 'auto' | 'confirm' | 'fresh' | 'never'): Requirement => ({
    kind: 'fact',
    id: 'address',
    fact: 'identity.address',
    subject: 'primary',
    label: 'Home address',
    ...(reuse === undefined ? {} : { reuse }),
  })

  const knownElsewhere = () =>
    fact('identity.address', PRIMARY, '12 Sample Street, Dublin 4', { capturedFor: OTHER_APP })

  it('auto: reuses a fact captured for another application silently', () => {
    // identity.fullName is `auto` in the catalogue. identity.address is not — see the
    // "cannot loosen" case below.
    const journey = journeyWith({
      kind: 'fact',
      id: 'name',
      fact: 'identity.fullName',
      subject: 'primary',
      label: 'Full name',
    })
    const evaluation = evaluateJourney(
      journey,
      context({
        facts: [fact('identity.fullName', PRIMARY, 'Test Person', { capturedFor: OTHER_APP })],
      }),
    )

    expect(evaluation.outstanding).toEqual([])
    expect(evaluation.satisfied[0]?.reused).toBe(true)
  })

  it('confirm is the catalogue default for address, even when a journey asks for auto', () => {
    const journey = journeyWith(addressRequirement('auto'))
    const items = outstanding(journey, context({ facts: [knownElsewhere()] }))

    expect(items[0]?.reason).toBe('needs_confirmation')
  })

  it('confirm: asks the customer to confirm a value captured elsewhere', () => {
    const journey = journeyWith(addressRequirement('confirm'))
    const items = outstanding(journey, context({ facts: [knownElsewhere()] }))

    expect(items).toHaveLength(1)
    expect(items[0]?.reason).toBe('needs_confirmation')
    expect(items[0]?.knownFact?.value).toBe('12 Sample Street, Dublin 4')
  })

  it('confirm: is satisfied once confirmed for this application', () => {
    const journey = journeyWith(addressRequirement('confirm'))
    const evaluation = evaluateJourney(
      journey,
      context({ facts: [knownElsewhere()], confirmations: ['address'] }),
    )

    expect(evaluation.outstanding).toEqual([])
    expect(evaluation.satisfied[0]?.reused).toBe(true)
  })

  it('confirm: needs no separate confirmation when the fact was captured for this application', () => {
    const journey = journeyWith(addressRequirement('confirm'))
    const evaluation = evaluateJourney(
      journey,
      context({ facts: [fact('identity.address', PRIMARY, '12 Sample Street, Dublin 4')] }),
    )

    expect(evaluation.outstanding).toEqual([])
    expect(evaluation.satisfied[0]?.reused).toBe(false)
  })

  it('fresh: will not accept a fact captured for another application', () => {
    const journey = journeyWith(addressRequirement('fresh'))
    const items = outstanding(journey, context({ facts: [knownElsewhere()] }))

    expect(items).toHaveLength(1)
    expect(items[0]?.reason).toBe('needs_fresh')
  })

  it('fresh: is satisfied by a fact captured for this application', () => {
    const journey = journeyWith(addressRequirement('fresh'))
    expect(
      outstanding(
        journey,
        context({ facts: [fact('identity.address', PRIMARY, '12 Sample Street, Dublin 4')] }),
      ),
    ).toEqual([])
  })

  it('a requirement may tighten the catalogue policy', () => {
    // identity.fullName is `auto` in the catalogue.
    const journey = journeyWith({
      kind: 'fact',
      id: 'name',
      fact: 'identity.fullName',
      subject: 'primary',
      label: 'Full name',
      reuse: 'fresh',
    })
    const items = outstanding(
      journey,
      context({
        facts: [fact('identity.fullName', PRIMARY, 'Test Person', { capturedFor: OTHER_APP })],
      }),
    )

    expect(items[0]?.reason).toBe('needs_fresh')
  })

  it('a requirement cannot loosen the catalogue policy', () => {
    // protection.health.smoker is `never` in the catalogue; the requirement asks for `auto`.
    const journey = journeyWith({
      kind: 'fact',
      id: 'smoker',
      fact: 'protection.health.smoker',
      subject: 'primary',
      label: 'Smoker',
      reuse: 'auto',
    })
    const items = outstanding(
      journey,
      context({
        facts: [fact('protection.health.smoker', PRIMARY, false, { capturedFor: OTHER_APP })],
      }),
    )

    expect(items[0]?.reason).toBe('needs_fresh')
  })
})

describe('declarations, confirmations and documents', () => {
  it('a declaration is outstanding until confirmed for this application', () => {
    const journey = journeyWith({
      kind: 'declaration',
      id: 'credit-declaration',
      subject: 'primary',
      label: 'Credit declaration',
      fresh: true,
    })

    expect(outstanding(journey, context())[0]?.reason).toBe('awaiting_declaration')
    expect(outstanding(journey, context({ confirmations: ['credit-declaration'] }))).toEqual([])
  })

  it('a document is outstanding until one is supplied', () => {
    const journey = journeyWith({
      kind: 'document',
      id: 'payslip',
      subject: 'primary',
      label: 'Latest payslip',
      documentType: 'payslip',
    })

    expect(outstanding(journey, context())[0]?.reason).toBe('awaiting_document')
    expect(
      outstanding(journey, context({ documents: [{ requirementId: 'payslip', verified: false }] })),
    ).toEqual([])
  })

  it('a document requiring verification is not satisfied by an unverified upload', () => {
    const journey = journeyWith({
      kind: 'document',
      id: 'payslip',
      subject: 'primary',
      label: 'Latest payslip',
      documentType: 'payslip',
      requiresVerification: true,
    })

    expect(
      outstanding(journey, context({ documents: [{ requirementId: 'payslip', verified: false }] })),
    ).toHaveLength(1)
    expect(
      outstanding(journey, context({ documents: [{ requirementId: 'payslip', verified: true }] })),
    ).toEqual([])
  })

  /** So a card can say the document was checked rather than only received. */
  it('a satisfied document carries whether it has been checked', () => {
    const journey = journeyWith({
      kind: 'document',
      id: 'photo-id',
      subject: 'primary',
      label: 'Photo ID',
      documentType: 'photo_id',
    })

    const received = evaluateJourney(
      journey,
      context({ documents: [{ requirementId: 'photo-id', verified: false }] }),
    )
    expect(received.satisfied[0]?.document).toEqual({ verified: false })

    const checked = evaluateJourney(
      journey,
      context({ documents: [{ requirementId: 'photo-id', verified: true }] }),
    )
    expect(checked.satisfied[0]?.document).toEqual({ verified: true })
  })
})

describe('what the linked accounts show stands in for a document (open banking, simulated)', () => {
  const payslip: Requirement = {
    kind: 'document',
    id: 'payslip',
    subject: 'primary',
    label: 'Two recent payslips',
    documentType: 'payslip',
  }
  const statement: Requirement = {
    kind: 'document',
    id: 'statement',
    subject: 'primary',
    label: 'Three months of bank statements',
    documentType: 'bank_statement',
  }
  const photoId: Requirement = {
    kind: 'document',
    id: 'photo-id',
    subject: 'primary',
    label: 'Photo ID',
    documentType: 'photo_id',
  }

  const evidence = (over: Partial<AccountEvidence> = {}): AccountEvidence => ({
    salaryObserved: { monthly: 4_100, annualised: 49_200, employer: 'Acme Ltd', months: 3 },
    rentObserved: { monthly: 1_800 },
    savingsObserved: 32_000,
    daysOfHistory: 90,
    ...over,
  })

  it('a payslip is met by pay seen arriving for at least two months', () => {
    const journey = journeyWith(payslip)
    const met = evaluateJourney(journey, context({ accountEvidence: evidence() }))
    expect(met.outstanding).toEqual([])
    expect(met.satisfied[0]).toMatchObject({ reused: true, reason: 'account_data', fact: null })

    const oneMonth = evidence({
      salaryObserved: { monthly: 4_100, annualised: 49_200, employer: 'Acme Ltd', months: 1 },
    })
    expect(outstanding(journey, context({ accountEvidence: oneMonth }))[0]?.reason).toBe(
      'awaiting_document',
    )
    expect(
      outstanding(journey, context({ accountEvidence: evidence({ salaryObserved: null }) }))[0]
        ?.reason,
    ).toBe('awaiting_document')
  })

  it('a statement is met by sixty days of history, and not by fifty-nine', () => {
    const journey = journeyWith(statement)
    expect(
      outstanding(journey, context({ accountEvidence: evidence({ daysOfHistory: 60 }) })),
    ).toEqual([])
    expect(
      outstanding(journey, context({ accountEvidence: evidence({ daysOfHistory: 59 }) }))[0]
        ?.reason,
    ).toBe('awaiting_document')
  })

  it('never covers a document that is not in a transaction feed', () => {
    expect(
      outstanding(journeyWith(photoId), context({ accountEvidence: evidence() }))[0]?.reason,
    ).toBe('awaiting_document')
  })

  it('changes nothing when nothing is linked', () => {
    expect(outstanding(journeyWith(payslip, statement), context())).toHaveLength(2)
  })

  it('an upload still counts as the upload, so a checked document stays checked', () => {
    const uploaded = evaluateJourney(
      journeyWith(payslip),
      context({
        accountEvidence: evidence(),
        documents: [{ requirementId: 'payslip', verified: true }],
      }),
    )
    expect(uploaded.satisfied[0]).toMatchObject({ reused: false, document: { verified: true } })
    expect(uploaded.satisfied[0]?.reason).toBeUndefined()
  })

  it('evidenceCovers says the same thing on its own', () => {
    expect(evidenceCovers(payslip, evidence())).toBe(true)
    expect(evidenceCovers(statement, evidence({ daysOfHistory: 10 }))).toBe(false)
    expect(evidenceCovers(payslip, undefined)).toBe(false)
  })
})

describe('branches', () => {
  const journey = defineJourney({
    product: 'mortgage',
    displayName: 'Mortgage',
    supportsPartner: true,
    requirements: [
      {
        kind: 'fact',
        id: 'buying-with',
        fact: 'household.buyingWith',
        subject: 'household',
        label: 'Buying alone or with someone',
      },
    ],
    branches: [
      {
        id: 'joint-application',
        describe: 'Buying with a partner',
        when: (facts) => facts.get('household.buyingWith', 'household') === 'partner',
        requirements: [
          {
            kind: 'fact',
            id: 'partner-income',
            fact: 'income.annualBasic',
            subject: 'partner',
            label: "Partner's annual basic salary",
          },
        ],
      },
    ],
  })

  it('omits branch requirements when the condition is not met', () => {
    const items = outstanding(
      journey,
      context({ facts: [fact('household.buyingWith', 'household', 'alone')] }),
    )

    expect(items).toEqual([])
  })

  it('includes branch requirements when the condition is met', () => {
    const items = outstanding(
      journey,
      context({
        participants: { primary: PRIMARY, partner: PARTNER },
        facts: [fact('household.buyingWith', 'household', 'partner')],
      }),
    )

    expect(items.map((i) => i.requirement.id)).toEqual(['partner-income'])
  })

  it('does not evaluate a branch whose driving fact is still unknown', () => {
    const items = outstanding(journey, context())

    expect(items.map((i) => i.requirement.id)).toEqual(['buying-with'])
  })
})

describe('evaluateJourney()', () => {
  it('reports who the application is waiting on, preferring the customer', () => {
    const journey = journeyWith(incomeOf('primary'), incomeOf('partner'))
    const evaluation = evaluateJourney(
      journey,
      context({ participants: { primary: PRIMARY, partner: PARTNER } }),
    )

    expect(evaluation.waitingOn).toBe('primary')
    expect(evaluation.complete).toBe(false)
  })

  it('waits on the partner once the customer has nothing left to do', () => {
    const journey = journeyWith(incomeOf('primary'), incomeOf('partner'))
    const evaluation = evaluateJourney(
      journey,
      context({
        participants: { primary: PRIMARY, partner: PARTNER },
        facts: [fact('income.annualBasic', PRIMARY, 92_000)],
      }),
    )

    expect(evaluation.waitingOn).toBe('partner')
  })

  it('is complete when every blocking requirement is satisfied', () => {
    const journey = journeyWith(incomeOf('primary'))
    const evaluation = evaluateJourney(
      journey,
      context({ facts: [fact('income.annualBasic', PRIMARY, 92_000)] }),
    )

    expect(evaluation.complete).toBe(true)
    expect(evaluation.waitingOn).toBeNull()
  })
})

/**
 * §48 — the review card is where declarations are made, so an application must be able to
 * reach it while they are still outstanding. Otherwise the card could never be shown.
 */
describe('readyForReview()', () => {
  const journey = journeyWith(incomeOf('primary'), {
    kind: 'declaration',
    id: 'declaration',
    subject: 'primary',
    label: 'Declaration',
    fresh: true,
  })

  it('is false while real information is still missing', () => {
    expect(readyForReview(evaluateJourney(journey, context()))).toBe(false)
  })

  it('is true when only the end-of-journey confirmations remain', () => {
    const evaluation = evaluateJourney(
      journey,
      context({ facts: [fact('income.annualBasic', PRIMARY, 92_000)] }),
    )

    expect(evaluation.complete).toBe(false)
    expect(readyForReview(evaluation)).toBe(true)
    expect(confirmationsForReview(evaluation).map((i) => i.requirement.id)).toEqual(['declaration'])
  })

  it('counts a value awaiting reuse confirmation as an end-of-journey confirmation (§11)', () => {
    const confirmJourney = journeyWith({
      kind: 'fact',
      id: 'address',
      fact: 'identity.address',
      subject: 'primary',
      label: 'Home address',
    })
    const evaluation = evaluateJourney(
      confirmJourney,
      context({
        facts: [fact('identity.address', PRIMARY, '12 Sample Street', { capturedFor: OTHER_APP })],
      }),
    )

    expect(readyForReview(evaluation)).toBe(true)
    expect(confirmationsForReview(evaluation)[0]?.knownFact?.value).toBe('12 Sample Street')
  })

  it('is still false when a document is outstanding, since that is not a confirmation', () => {
    const docJourney = journeyWith({
      kind: 'document',
      id: 'payslip',
      subject: 'primary',
      label: 'Payslip',
      documentType: 'payslip',
    })

    expect(readyForReview(evaluateJourney(docJourney, context()))).toBe(false)
  })
})
