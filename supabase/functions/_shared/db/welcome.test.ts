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
import { openedAccounts, welcomeCardFor, welcomedAccounts } from './welcome.ts'

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
  extra: Partial<Application> = {},
): Application => ({
  id: asApplicationId(`33333333-3333-4333-8333-00000000000${product.length % 10}`),
  product,
  state,
  resumeTo: null,
  ...extra,
})

function loaded(overrides: Partial<LoadedCase> = {}): LoadedCase {
  return {
    caseId: '44444444-4444-4444-8444-444444444444',
    kind: 'presenter',
    authLevel: 'authenticated',
    customerName: 'Aoife',
    lastSeenAt: null,
    participants: [{ id: PRIMARY, role: 'primary', displayName: 'Aoife' }],
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

const NONE: ReadonlySet<string> = new Set()
const OPENED = application('current_account', 'completed', { displayName: 'Current account' })

/** The card, narrowed, so a test can read its fields without repeating the type check. */
function welcome(theCase: LoadedCase, welcomed: ReadonlySet<string> = NONE) {
  const card = welcomeCardFor(theCase, welcomed)
  if (card === undefined || card.type !== 'account_opened') throw new Error('no welcome was owed')
  return card
}

describe('welcomeCardFor', () => {
  it('owes nothing until the bank has opened an account', () => {
    expect(welcomeCardFor(loaded(), NONE)).toBeUndefined()
    expect(
      welcomeCardFor(
        loaded({ applications: [application('current_account', 'under_review')] }),
        NONE,
      ),
    ).toBeUndefined()
    // Only an account is welcomed with an IBAN. A finished savings application is not one.
    expect(
      welcomeCardFor(loaded({ applications: [application('savings', 'completed')] }), NONE),
    ).toBeUndefined()
    expect(
      openedAccounts(loaded({ applications: [application('joint_account', 'completed')] })),
    ).toHaveLength(1)
  })

  it('welcomes the opened account by name, with a synthetic number formatted for reading', () => {
    const card = welcome(loaded({ applications: [OPENED] }))

    expect(card.applicationId).toBe(String(OPENED.id))
    expect(card.displayName).toBe('Current account')
    expect(card.iban).toMatch(/^IE\d{2} SAOI 0000 00\d{2} \d{4} \d{2}$/)
    expect(card.bic).toBe('SAOIIE2D')
    expect(card.cardTo).toBeNull()
    expect(card.next).toEqual([
      'Use this IBAN wherever money needs to reach you',
      'Your debit card is on its way, and online banking and the app are ready',
    ])
  })

  it('names the account from the journey when the row carries no name', () => {
    const card = welcome(loaded({ applications: [application('joint_account', 'completed')] }))
    expect(card.displayName).toBe('Joint current account')
  })

  it("addresses the card and the salary line from the primary applicant's own facts", () => {
    const employed = welcome(
      loaded({
        applications: [OPENED],
        facts: [
          fact('identity.address', PRIMARY, '14 Example Road, Dublin 8'),
          fact('employment.status', PRIMARY, 'employed_full_time'),
        ],
      }),
    )
    expect(employed.cardTo).toBe('14 Example Road, Dublin 8')
    expect(employed.next[0]).toBe('Give your employer this IBAN for your salary')

    const selfEmployed = welcome(
      loaded({
        applications: [OPENED],
        facts: [fact('employment.status', PRIMARY, 'self_employed')],
      }),
    )
    expect(selfEmployed.next[0]).toBe('Give your employer this IBAN for your salary')

    const retired = welcome(
      loaded({ applications: [OPENED], facts: [fact('employment.status', PRIMARY, 'retired')] }),
    )
    expect(retired.next[0]).toBe('Use this IBAN wherever money needs to reach you')
  })

  it("does not take the partner's address for the primary's", () => {
    const card = welcome(
      loaded({
        participants: [
          { id: PRIMARY, role: 'primary', displayName: 'Aoife' },
          { id: PARTNER, role: 'partner', displayName: 'Emma' },
        ],
        applications: [OPENED],
        facts: [fact('identity.address', PARTNER, '2 Somewhere Else, Cork')],
      }),
    )
    expect(card.cardTo).toBeNull()
  })

  it('adds the standing order when a savings account is on the case', () => {
    const card = welcome(loaded({ applications: [OPENED, application('savings', 'in_progress')] }))
    expect(card.next).toEqual([
      'Use this IBAN wherever money needs to reach you',
      'Set up a standing order into your savings',
      'Your debit card is on its way, and online banking and the app are ready',
    ])
  })

  it('welcomes each opened account once, whichever order the rows arrive in', () => {
    const joint = application('joint_account', 'completed')
    for (const applications of [
      [OPENED, joint],
      [joint, OPENED],
    ]) {
      const theCase = loaded({ applications })
      const first = welcome(theCase)
      const second = welcome(theCase, new Set([first.applicationId]))

      expect(first.applicationId).not.toBe(second.applicationId)
      expect([first.applicationId, second.applicationId].sort()).toEqual(
        [String(OPENED.id), String(joint.id)].sort(),
      )
      expect(
        welcomeCardFor(theCase, new Set([first.applicationId, second.applicationId])),
      ).toBeUndefined()
    }
  })
})

describe('savings held at a linked bank (open banking, simulated)', () => {
  const linked = (bank: string, accountType: 'current' | 'savings', balance: number) => ({
    id: `55555555-5555-4555-8555-00000000000${String(balance % 10)}`,
    bank,
    displayName: accountType === 'savings' ? 'Online Saver' : 'Current Account',
    accountType,
    iban: 'IE29AIBK93115212345678',
    balance,
    consentScope: ['balances', 'transactions', 'payments'],
    consentExpiresAt: '2027-01-20T00:00:00.000Z',
    createdAt: '2026-10-22T10:00:00.000Z',
    transactions: [],
  })

  it('puts moving the savings first, naming the figure and the bank', () => {
    const card = welcome(
      loaded({
        applications: [OPENED],
        facts: [fact('employment.status', PRIMARY, 'employed_full_time')],
        linkedAccounts: [linked('AIB', 'current', 2_340), linked('AIB', 'savings', 32_000)],
      }),
    )
    expect(card.next).toEqual([
      'Move your €32,000 from AIB into it',
      'Give your employer this IBAN for your salary',
      'Your debit card is on its way, and online banking and the app are ready',
    ])
  })

  it('says nothing about moving money when only a current account is linked, or it is empty', () => {
    const current = welcome(
      loaded({ applications: [OPENED], linkedAccounts: [linked('AIB', 'current', 2_340)] }),
    )
    expect(current.next[0]).toBe('Use this IBAN wherever money needs to reach you')
    const empty = welcome(
      loaded({ applications: [OPENED], linkedAccounts: [linked('AIB', 'savings', 0)] }),
    )
    expect(empty.next[0]).toBe('Use this IBAN wherever money needs to reach you')
  })
})

describe('welcomedAccounts', () => {
  it('reads the welcomed ids out of persisted card payloads and passes over everything else', () => {
    const welcomed = welcomedAccounts([
      { cards: [{ type: 'status', applications: [] }] },
      { cards: [{ type: 'account_opened', applicationId: 'a', displayName: 'Current account' }] },
      // Shapes the transcript could hold from before, or from a bad write. Never a reason to throw.
      { cards: [{ type: 'account_opened' }, 'not a card', null] },
      { cards: 'not an array' },
      { cards: [{ type: 'account_opened', applicationId: 'b' }] },
    ])
    expect([...welcomed].sort()).toEqual(['a', 'b'])
  })
})
