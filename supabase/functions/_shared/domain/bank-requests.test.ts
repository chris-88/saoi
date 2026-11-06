import { describe, expect, it } from 'vitest'
import { asApplicationId, asParticipantId } from './facts.ts'
import { defineJourney, type Requirement } from './journey.ts'
import { evaluateJourney, type RequirementContext } from './requirements.ts'
import {
  bankRequirementId,
  isBankRequest,
  withBankRequests,
  type OpenRequest,
} from './bank-requests.ts'

const PRIMARY = asParticipantId('participant-primary')
const THIS_APP = asApplicationId('app-this')

const payslip: Requirement = {
  kind: 'document',
  id: 'payslip',
  subject: 'primary',
  label: 'Your latest payslip',
  documentType: 'payslip',
}

const journey = defineJourney({
  product: 'personal_loan',
  displayName: 'Personal loan',
  requirements: [payslip],
})

/** Everything the journey wants is in, which is where an application is when the bank asks. */
const complete = (): RequirementContext => ({
  applicationId: THIS_APP,
  participants: { primary: PRIMARY, partner: null },
  facts: [],
  confirmations: [],
  documents: [{ requirementId: 'payslip', verified: true }],
})

const request = (overrides: Partial<OpenRequest> = {}): OpenRequest => ({
  id: 'request-1',
  requirementId: bankRequirementId('one more payslip'),
  status: 'open',
  detail: 'one more payslip',
  ...overrides,
})

describe('bankRequirementId()', () => {
  it('turns the wording into a stable id that can never be a journey requirement', () => {
    expect(bankRequirementId('one more payslip')).toBe('bank:one-more-payslip')
    expect(bankRequirementId('  Proof of address, dated this year!  ')).toBe(
      'bank:proof-of-address-dated-this-year',
    )
  })

  it('still produces an id when the wording has nothing to slug', () => {
    expect(bankRequirementId('???')).toBe('bank:request')
  })

  it('keeps the id short however long the wording is', () => {
    const id = bankRequirementId('a '.repeat(200))
    expect(id.startsWith('bank:')).toBe(true)
    expect(id.length).toBeLessThanOrEqual('bank:'.length + 48)
  })
})

describe('isBankRequest()', () => {
  it('is anything the journey did not ask for', () => {
    expect(isBankRequest(journey, request())).toBe(true)
    expect(isBankRequest(journey, request({ requirementId: 'payslip' }))).toBe(false)
  })

  it('knows the journey’s branch requirements too, not only the base ones', () => {
    const branched = defineJourney({
      product: 'personal_loan',
      displayName: 'Personal loan',
      requirements: [],
      branches: [
        {
          id: 'self-employed',
          describe: 'Self-employed',
          when: () => false,
          requirements: [{ ...payslip, id: 'accounts', label: 'Two years of accounts' }],
        },
      ],
    })

    expect(isBankRequest(branched, request({ requirementId: 'accounts' }))).toBe(false)
  })
})

describe('withBankRequests()', () => {
  it('returns the evaluation untouched when the bank has asked for nothing', () => {
    const evaluation = evaluateJourney(journey, complete())
    expect(withBankRequests(journey, evaluation, [])).toBe(evaluation)
    expect(evaluation.complete).toBe(true)
  })

  it('makes an open bank request an outstanding, blocking document for the customer', () => {
    const evaluation = withBankRequests(journey, evaluateJourney(journey, complete()), [request()])

    expect(evaluation.outstanding).toHaveLength(1)
    const item = evaluation.outstanding[0]
    expect(item?.blocking).toBe(true)
    expect(item?.waitingOn).toBe('primary')
    expect(item?.reason).toBe('awaiting_document')
    expect(item?.requestId).toBe('request-1')
    expect(item?.requirement).toMatchObject({
      kind: 'document',
      id: 'bank:one-more-payslip',
      subject: 'primary',
      label: 'One more payslip',
      documentType: 'bank_request',
    })

    expect(evaluation.complete).toBe(false)
    expect(evaluation.waitingOn).toBe('primary')
    // What the journey itself settled is left alone.
    expect(evaluation.satisfied).toHaveLength(1)
  })

  it('does not duplicate a request that answers one of the journey’s own requirements', () => {
    const context: RequirementContext = { ...complete(), documents: [] }
    const before = evaluateJourney(journey, context)
    const after = withBankRequests(journey, before, [
      request({ requirementId: 'payslip', detail: 'Your latest payslip' }),
    ])

    expect(after).toBe(before)
    expect(after.outstanding.map((item) => item.requirement.id)).toEqual(['payslip'])
  })

  it('ignores a request that has been fulfilled or cancelled', () => {
    const evaluation = withBankRequests(journey, evaluateJourney(journey, complete()), [
      request({ id: 'request-1', status: 'fulfilled' }),
      request({ id: 'request-2', status: 'cancelled' }),
    ])

    expect(evaluation.outstanding).toHaveLength(0)
    expect(evaluation.complete).toBe(true)
  })

  it('lists the same ask once, however many open rows carry it', () => {
    const evaluation = withBankRequests(journey, evaluateJourney(journey, complete()), [
      request({ id: 'request-1' }),
      request({ id: 'request-2' }),
    ])

    expect(evaluation.outstanding).toHaveLength(1)
    expect(evaluation.outstanding[0]?.requestId).toBe('request-1')
  })

  it('labels a request with no wording honestly rather than with an empty string', () => {
    const evaluation = withBankRequests(journey, evaluateJourney(journey, complete()), [
      request({ detail: null }),
    ])

    expect(evaluation.outstanding[0]?.requirement.label).toBe('What the bank asked for')
  })
})
