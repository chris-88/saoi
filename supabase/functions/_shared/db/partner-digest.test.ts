import { describe, expect, it } from 'vitest'
import { goalCatalogue } from '../domain/goals/catalogue.ts'
import { needCatalogue } from '../domain/needs/catalogue.ts'
import {
  asApplicationId,
  asFactId,
  asParticipantId,
  type Fact,
  type FactKey,
  type FactSubject,
} from '../domain/facts.ts'
import type { Application } from '../domain/state-machine.ts'
import { slidersFor } from '../llm/persona.ts'
import type { LoadedCase } from './loaded-case.ts'
import { buildPartnerDigest } from './partner-digest.ts'

const PRIMARY = asParticipantId('11111111-1111-4111-8111-111111111111')
const PARTNER = asParticipantId('22222222-2222-4222-8222-222222222222')

let n = 0
const fact = (
  key: FactKey,
  subject: FactSubject,
  value: unknown,
  extra: Partial<Fact> = {},
): Fact => {
  n += 1
  return {
    id: asFactId(`f-${n}`),
    key,
    subject,
    value,
    source: 'customer_stated',
    verified: false,
    capturedFor: null,
    supersededBy: null,
    capturedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  }
}

const application = (
  product: Application['product'],
  state: Application['state'],
): Application => ({
  id: asApplicationId(`33333333-3333-4333-8333-00000000000${product.length % 10}`),
  product,
  state,
  resumeTo: null,
})

function loaded(overrides: Partial<LoadedCase> = {}): LoadedCase {
  return {
    caseId: '44444444-4444-4444-8444-444444444444',
    kind: 'customer',
    authLevel: 'authenticated',
    customerName: 'Aoife',
    lastSeenAt: null,
    participants: [
      { id: PRIMARY, role: 'primary', displayName: 'Aoife' },
      { id: PARTNER, role: 'partner', displayName: 'Emma' },
    ],
    overrides: [],
    goals: goalCatalogue,
    needs: needCatalogue,
    facts: [],
    applications: [],
    confirmations: [],
    documents: [],
    requests: [],
    productInterests: [],
    formApplications: [],
    linkedAccounts: [],
    transfers: [],
    messages: [],
    eventsSinceLastSeen: [],
    persona: slidersFor('default'),
    killSwitch: false,
    ...overrides,
  }
}

/**
 * Invariant 7, asserted rather than trusted.
 *
 * These are the tests that matter most in this file and possibly in the project: everything
 * else going wrong produces a worse demo, and this going wrong tells one person what the other
 * one earns. They are written as "the primary's value does not appear anywhere in the output",
 * not as "the facts array has two entries", because the leak that actually happens is a value
 * arriving somewhere nobody was checking.
 */
describe('what the partner can never see', () => {
  const withBothSides = () =>
    loaded({
      facts: [
        fact('income.annualBasic', PRIMARY, 92_000),
        fact('income.annualBasic', PARTNER, 41_500),
        fact('identity.ppsn', PRIMARY, '1234567AB'),
        fact('assets.depositAmount', 'household', 60_000),
      ],
    })

  it("leaves the primary's income out entirely", () => {
    const digest = buildPartnerDigest(withBothSides(), PARTNER)

    expect(JSON.stringify(digest)).not.toContain('92000')
    expect(JSON.stringify(digest)).not.toContain('92,000')
  })

  it("leaves the primary's identifiers out entirely", () => {
    const digest = buildPartnerDigest(withBothSides(), PARTNER)
    expect(JSON.stringify(digest)).not.toContain('1234567AB')
  })

  it("keeps the partner's own answers", () => {
    const digest = buildPartnerDigest(withBothSides(), PARTNER)
    expect(JSON.stringify(digest)).toContain('41500')
  })

  it('keeps household facts, which belong to both of them', () => {
    const digest = buildPartnerDigest(withBothSides(), PARTNER)
    expect(JSON.stringify(digest)).toContain('60000')
  })

  it('carries no conversation, plans, advisories or declined products', () => {
    const digest = buildPartnerDigest(
      loaded({ productInterests: [{ product: 'credit_card', status: 'declined', reason: 'no' }] }),
      PARTNER,
    )

    expect(digest.declinedProducts).toEqual([])
    expect(digest.advisories).toEqual([])
    expect(digest.eventsSinceLastSeen).toEqual([])
    expect(digest.plans).toBeUndefined()
    expect(digest.needs).toBeUndefined()
  })

  it('never names the primary, even as the customer', () => {
    const digest = buildPartnerDigest(withBothSides(), PARTNER, { partnerName: 'Emma' })

    expect(digest.customerName).toBe('Emma')
    expect(JSON.stringify(digest)).not.toContain('Aoife')
  })

  it('does not treat the partner as signed in', () => {
    // The case is authenticated because the primary signed in. The partner did not.
    expect(buildPartnerDigest(withBothSides(), PARTNER).authLevel).toBe('anonymous')
  })

  it('drops a superseded answer, like every other digest', () => {
    const digest = buildPartnerDigest(
      loaded({
        facts: [
          fact('income.annualBasic', PARTNER, 30_000, { supersededBy: asFactId('f-later') }),
          fact('income.annualBasic', PARTNER, 41_500),
        ],
      }),
      PARTNER,
    )

    expect(JSON.stringify(digest)).not.toContain('30000')
    expect(JSON.stringify(digest)).toContain('41500')
  })
})

describe('what the partner does see', () => {
  it('shows only applications their journey involves them in', () => {
    const digest = buildPartnerDigest(
      loaded({
        applications: [
          application('joint_account', 'waiting_partner'),
          // A solo product. The partner has no part in it and should not learn it exists.
          application('current_account', 'in_progress'),
        ],
      }),
      PARTNER,
    )

    expect(digest.applications.map((a) => a.product)).toEqual(['joint_account'])
  })

  it('reports an application by name and state', () => {
    const digest = buildPartnerDigest(
      loaded({ applications: [application('joint_account', 'waiting_partner')] }),
      PARTNER,
    )

    expect(digest.applications[0]?.displayName.length).toBeGreaterThan(0)
    expect(digest.applications[0]?.stateLabel.length).toBeGreaterThan(0)
  })
})
