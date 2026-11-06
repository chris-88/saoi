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
import { buildCaseDigest, NARRATABLE_EVENTS } from './digest.ts'
import { awaitingSection } from '../llm/conversation.ts'
import type { LoadedCase } from './loaded-case.ts'

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
    kind: 'presenter',
    authLevel: 'authenticated',
    customerName: 'Aoife',
    lastSeenAt: null,
    participants: [{ id: PRIMARY, role: 'primary', displayName: 'Aoife' }],
    // No overlay: these tests are about the digest, not about what an admin reworded.
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

describe('facts in the digest', () => {
  it('renders values for reading rather than dumping them raw', () => {
    const digest = buildCaseDigest(
      loaded({
        facts: [
          fact('income.annualBasic', PRIMARY, 92_000),
          fact('housing.firstTimeBuyer', 'household', true),
          fact('household.dependantCount', 'household', 1),
        ],
      }),
    )

    expect(digest.facts.map((f) => f.value)).toEqual(['92,000', 'yes', '1'])
  })

  it('never puts special-category data in front of the model (Invariant 6)', () => {
    const digest = buildCaseDigest(
      loaded({
        facts: [
          fact('protection.health.smoker', PRIMARY, false),
          fact('protection.health.conditions', PRIMARY, ['asthma']),
          fact('income.annualBasic', PRIMARY, 92_000),
        ],
      }),
    )

    expect(digest.facts).toHaveLength(1)
    expect(digest.facts[0]?.label).toBe('Annual basic salary')
  })

  it('omits a superseded fact, so a corrected value is never shown twice', () => {
    const digest = buildCaseDigest(
      loaded({
        facts: [
          fact('income.annualBasic', PRIMARY, 80_000, { supersededBy: asFactId('newer') }),
          fact('income.annualBasic', PRIMARY, 92_000),
        ],
      }),
    )

    expect(digest.facts).toHaveLength(1)
    expect(digest.facts[0]?.value).toBe('92,000')
  })

  it("marks the partner's facts as theirs", () => {
    const digest = buildCaseDigest(
      loaded({
        participants: [
          { id: PRIMARY, role: 'primary', displayName: 'Aoife' },
          { id: PARTNER, role: 'partner', displayName: 'Emma' },
        ],
        facts: [fact('income.annualBasic', PARTNER, 54_000)],
      }),
    )

    expect(digest.facts[0]?.label).toMatch(/partner/i)
  })

  it('carries provenance through, so reuse can be explained', () => {
    const digest = buildCaseDigest(
      loaded({
        facts: [
          fact('income.annualBasic', PRIMARY, 92_000, { source: 'bank_held', verified: true }),
        ],
      }),
    )

    expect(digest.facts[0]?.source).toBe('bank_held')
    expect(digest.facts[0]?.verified).toBe(true)
  })
})

describe('applications in the digest', () => {
  it('states what is outstanding, computed rather than remembered (Invariant 3)', () => {
    const digest = buildCaseDigest(
      loaded({ applications: [application('credit_card', 'in_progress')] }),
    )

    expect(digest.applications).toHaveLength(1)
    expect(digest.applications[0]?.outstanding.length).toBeGreaterThan(0)
    expect(digest.applications[0]?.stateLabel).toBe('In progress')
  })

  it('shrinks the outstanding list as facts arrive', () => {
    const before = buildCaseDigest(
      loaded({ applications: [application('credit_card', 'in_progress')] }),
    )
    const after = buildCaseDigest(
      loaded({
        applications: [application('credit_card', 'in_progress')],
        facts: [
          fact('identity.fullName', PRIMARY, 'Aoife Ní Bhriain'),
          fact('identity.dateOfBirth', PRIMARY, '1992-04-17'),
          fact('household.dependantCount', 'household', 1),
        ],
      }),
    )

    expect(after.applications[0]?.outstanding.length).toBeLessThan(
      before.applications[0]?.outstanding.length ?? 0,
    )
  })

  it('carries the advisory when a loan runs alongside a mortgage (§6 Stage 8)', () => {
    const digest = buildCaseDigest(
      loaded({
        applications: [
          application('mortgage', 'in_progress'),
          application('personal_loan', 'in_progress'),
        ],
      }),
    )

    expect(digest.advisories).toHaveLength(1)
    expect(digest.advisories[0]?.title).toMatch(/mortgage/i)
  })

  it('is empty when no participant has been created yet', () => {
    expect(buildCaseDigest(loaded({ participants: [] })).applications).toEqual([])
  })
})

describe('customer agency (§49)', () => {
  it('lists declined products so they are not raised again', () => {
    const digest = buildCaseDigest(
      loaded({
        productInterests: [
          { product: 'personal_loan', status: 'declined', reason: null },
          { product: 'mortgage', status: 'accepted', reason: null },
        ],
      }),
    )

    expect(digest.declinedProducts).toEqual(['personal_loan'])
  })
})

describe('what changed since last time (§36)', () => {
  it('describes known events in the customer’s language', () => {
    const digest = buildCaseDigest(
      loaded({
        eventsSinceLastSeen: [
          {
            type: 'application_approved',
            createdAt: '2026-10-01T09:00:00Z',
            payload: { applicationName: 'Your credit card' },
          },
          {
            type: 'information_requested',
            createdAt: '2026-10-01T09:05:00Z',
            payload: { applicationName: 'Your mortgage', detail: 'one more payslip' },
          },
        ],
      }),
    )

    expect(digest.eventsSinceLastSeen).toEqual([
      'Your credit card was approved.',
      'Your mortgage: the team asked for one more payslip.',
    ])
  })

  it('omits an event type nobody has written copy for, rather than guessing', () => {
    const digest = buildCaseDigest(
      loaded({
        eventsSinceLastSeen: [
          { type: 'some_future_event', createdAt: '2026-10-01T09:00:00Z', payload: {} },
        ],
      }),
    )

    expect(digest.eventsSinceLastSeen).toEqual([])
  })
})

describe('the partner', () => {
  it('names them and what is waiting on them', () => {
    const digest = buildCaseDigest(
      loaded({
        participants: [
          { id: PRIMARY, role: 'primary', displayName: 'Aoife' },
          { id: PARTNER, role: 'partner', displayName: 'Emma' },
        ],
        applications: [application('joint_account', 'waiting_partner')],
      }),
    )

    expect(digest.partner?.name).toBe('Emma')
    expect(digest.partner?.outstanding.length).toBeGreaterThan(0)
  })

  it('is absent before anyone has joined', () => {
    expect(buildCaseDigest(loaded()).partner).toBeNull()
  })
})

/**
 * Invariant 6 has two halves. The model must never see special-category values — and it must
 * know they exist, or it reports answered health questions as outstanding, which is what
 * happened the first time this ran.
 */
describe('special-category data is held, not hidden', () => {
  const withHealth = () =>
    loaded({
      applications: [application('protection', 'in_progress')],
      facts: [
        fact('protection.health.smoker', PRIMARY, false, {
          capturedFor: asApplicationId('33333333-3333-4333-8333-000000000000'),
        }),
      ],
    })

  it('still shows no value anywhere in the digest', () => {
    const digest = buildCaseDigest(withHealth())
    expect(JSON.stringify(digest)).not.toContain('smoker')
    expect(digest.facts).toEqual([])
  })

  it('tells the model the information is held, so it does not report it as missing', () => {
    const digest = buildCaseDigest(withHealth())
    expect(digest.sensitiveHeld?.length).toBe(1)
    expect(digest.sensitiveHeld?.[0]).toMatch(/answered and recorded/i)
  })

  it('says nothing at all when no sensitive data has been given', () => {
    expect(buildCaseDigest(loaded()).sensitiveHeld).toEqual([])
  })
})

/**
 * The model could not tell "never been told this" from "we have it, confirm it at review", so
 * it asked again for values the customer had already given.
 */
describe('outstanding items say why they are outstanding', () => {
  it('marks a known value as confirmed at review rather than missing', () => {
    const digest = buildCaseDigest(
      loaded({
        applications: [application('credit_card', 'in_progress')],
        facts: [fact('identity.address', PRIMARY, '14 Sample Terrace', { capturedFor: null })],
      }),
    )

    const address = digest.applications[0]?.outstanding.find((item) =>
      item.startsWith('Your home address'),
    )
    expect(address).toMatch(/already known, confirmed on the review card/)
  })

  it('marks something genuinely unknown as worth asking for', () => {
    const digest = buildCaseDigest(
      loaded({ applications: [application('credit_card', 'in_progress')] }),
    )

    expect(digest.applications[0]?.outstanding.some((item) => item.includes('not yet known'))).toBe(
      true,
    )
  })
})

/**
 * `hasUpdates` and the narration are driven by two lists, and they drifted: a completed
 * application counted as worth returning for but had no words written for it, so Saoirse said
 * something had changed and then could not say what.
 */
describe('every event worth returning for can be described', () => {
  const NARRATABLE = NARRATABLE_EVENTS

  it('is the same list that decides whether to bring the customer back', () => {
    // Three copies of this list drifted once already. The notifier, the narrator and this
    // test now read the same one, so an event cannot be worth returning for and wordless.
    expect(NARRATABLE_EVENTS).toContain('savings_target_reached')
    expect(new Set(NARRATABLE_EVENTS).size).toBe(NARRATABLE_EVENTS.length)
  })

  it('produces a sentence for each one', () => {
    for (const type of NARRATABLE) {
      const digest = buildCaseDigest(
        loaded({
          eventsSinceLastSeen: [
            {
              type,
              createdAt: '2026-10-05T09:00:00Z',
              payload: { applicationName: 'Your mortgage' },
            },
          ],
        }),
      )
      expect(digest.eventsSinceLastSeen, type).toHaveLength(1)
    }
  })
})

/**
 * Everything handed to the digest has to come back out of it.
 *
 * `goals`, `suitability` and `prospect` were computed every turn, passed in, and dropped on the
 * floor: the return literal copied `plans`, `checkin` and `revived` and nothing else. It
 * typechecked because the caller spreads the options in — `...(x === 0 ? {} : { goals })` — and
 * TypeScript only flags excess properties on a direct literal, never on a spread.
 *
 * So the Goal Engine's digest lines and the suitability re-steer were being worked out and
 * thrown away, which is the quietest possible failure: no error, no warning, and a model that
 * simply never mentioned any of it.
 */
describe('what the digest is given, it keeps', () => {
  it('carries goals through to the prompt', () => {
    const digest = buildCaseDigest(loaded(), { goals: ['They are buying a first home.'] })
    expect(digest.goals).toEqual(['They are buying a first home.'])
  })

  it('carries suitability through to the prompt', () => {
    const digest = buildCaseDigest(loaded(), { suitability: ['A loan would cost less.'] })
    expect(digest.suitability).toEqual(['A loan would cost less.'])
  })

  it('carries what applying would involve through to the prompt', () => {
    const digest = buildCaseDigest(loaded(), { prospect: ['Mortgage — what applying involves:'] })
    expect(digest.prospect).toEqual(['Mortgage — what applying involves:'])
  })

  it('carries plans, check-ins and revived needs through, as it always did', () => {
    const digest = buildCaseDigest(loaded(), {
      plans: [{ title: 'Deposit', lines: ['on track'] }],
      checkin: { purpose: 'Review', plan: 'Deposit', agenda: ['how it is going'] },
      revived: [{ name: 'Protection', reason: 'the baby arrived' }],
    })

    expect(digest.plans).toHaveLength(1)
    expect(digest.checkin?.purpose).toBe('Review')
    expect(digest.revived).toHaveLength(1)
  })
})

describe('what the bank asked for after submission (§41)', () => {
  const held = application('savings', 'info_required')
  const request = (
    status: 'open' | 'fulfilled' | 'cancelled',
    requirementId = 'bank:one-more-payslip',
  ) => ({
    id: '55555555-5555-4555-8555-555555555555',
    applicationId: held.id,
    requirementId,
    status,
    detail: 'one more payslip',
  })
  const bankLines = (lines: readonly string[] | undefined) =>
    (lines ?? []).filter((line) => line.includes('request_upload'))

  it('lists an open bank request as outstanding, with the instruction to offer the upload', () => {
    const digest = buildCaseDigest(loaded({ applications: [held], requests: [request('open')] }))

    const lines = bankLines(digest.applications[0]?.outstanding)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('One more payslip')
    expect(lines[0]).toContain('do not guess')
    expect(digest.applications[0]?.waitingOn).toBe('primary')
  })

  it('says nothing about it once fulfilled or cancelled', () => {
    const digest = buildCaseDigest(
      loaded({ applications: [held], requests: [request('fulfilled'), request('cancelled')] }),
    )

    expect(bankLines(digest.applications[0]?.outstanding)).toHaveLength(0)
  })

  it('leaves a request against one of the journey’s own requirements to the journey', () => {
    const digest = buildCaseDigest(
      loaded({ applications: [held], requests: [request('open', 'savings-declaration')] }),
    )

    expect(bankLines(digest.applications[0]?.outstanding)).toHaveLength(0)
    expect(
      digest.applications[0]?.outstanding.filter((line) =>
        line.startsWith('Savings account declaration'),
      ),
    ).toHaveLength(1)
  })
})

/**
 * A card shown on an earlier turn and not yet tapped is told to the turn from the case, so the
 * model cannot take "Great" for the tap. The rules per card type live in `awaiting.test.ts`;
 * this checks the digest carries it and the prompt says it.
 */
describe('a card still waiting for a tap', () => {
  const message = (role: 'customer' | 'assistant' | 'system', cards: readonly string[] = []) => ({
    role,
    content: '',
    cards,
    createdAt: '2026-10-16T10:00:00.000Z',
    timing: null,
  })

  it('names the card and how far back it is', () => {
    const digest = buildCaseDigest(
      loaded({ messages: [message('customer'), message('assistant', ['product_options'])] }),
    )
    expect(digest.awaiting).toEqual({ type: 'product_options', turnsAgo: 1 })
  })

  /** The app reports a tap as an action turn, read before the report is saved. */
  it('says nothing on the action turn that answers the card', () => {
    const digest = buildCaseDigest(
      loaded({ messages: [message('customer'), message('assistant', ['plan_proposal'])] }),
      { acting: true },
    )
    expect(digest.awaiting).toBeUndefined()
  })

  it('says nothing when the card was tapped, or when there is none', () => {
    expect(buildCaseDigest(loaded()).awaiting).toBeUndefined()
    const tapped = buildCaseDigest(
      loaded({
        applications: [application('joint_account', 'in_progress')],
        messages: [
          message('assistant', ['product_options']),
          message('system'),
          message('assistant'),
        ],
      }),
    )
    expect(tapped.awaiting).toBeUndefined()
  })

  it('renders as one short section the model can act on', () => {
    const section = awaitingSection({ type: 'product_options', turnsAgo: 1 })
    expect(section).toContain('## A card is waiting')
    expect(section).toContain('product options card from your last reply')
    expect(section).toContain('ask nothing new')
    expect(awaitingSection({ type: 'review', turnsAgo: 3 })).toContain(
      'review card from 3 replies ago',
    )
  })
})

describe('linked accounts (open banking, simulated)', () => {
  const monthly = (day: string, amount: number, description: string, category: string) =>
    ['2026-08', '2026-09', '2026-10'].map((month) => ({
      bookedOn: `${month}-${day}`,
      amount,
      description,
      category,
    }))

  const linked = (id: string, accountType: 'current' | 'savings', balance: number) => ({
    id,
    bank: 'AIB',
    displayName: accountType === 'savings' ? 'Online Saver' : 'Current Account',
    accountType,
    iban: 'IE29AIBK93115212345678',
    balance,
    consentScope: ['balances', 'transactions', 'payments'],
    consentExpiresAt: '2027-01-20T09:00:00.000Z',
    createdAt: '2026-10-22T09:00:00.000Z',
    transactions:
      accountType === 'current'
        ? [
            ...monthly('25', 4_100, 'ACME LTD SALARY', 'income'),
            ...monthly('01', -1_800, 'SO RENT', 'housing'),
            { bookedOn: '2026-07-24', amount: -42.1, description: 'TESCO', category: 'groceries' },
          ]
        : [],
  })

  const CURRENT = '55555555-5555-4555-8555-000000000001'
  const SAVER = '55555555-5555-4555-8555-000000000002'

  it('is absent when nothing is linked: silence, not a line about nothing', () => {
    expect(buildCaseDigest(loaded()).linkedAccounts).toBeUndefined()
  })

  it('carries the accounts, what the transactions show, the consent and any transfer', () => {
    const digest = buildCaseDigest(
      loaded({
        linkedAccounts: [linked(CURRENT, 'current', 2_340), linked(SAVER, 'savings', 32_000)],
        transfers: [
          {
            id: '66666666-6666-4666-8666-000000000001',
            fromAccountId: SAVER,
            toApplicationId: null,
            toLabel: 'SuperSaver',
            amount: 32_000,
            cadence: 'once',
            state: 'initiated',
            createdAt: '2026-10-22T10:00:00.000Z',
          },
        ],
      }),
      { today: '2026-10-22' },
    )

    expect(digest.linkedAccounts).toMatchObject({
      accounts: [
        { bank: 'AIB', name: 'Current Account', type: 'current', balance: 2_340 },
        { bank: 'AIB', name: 'Online Saver', type: 'savings', balance: 32_000 },
      ],
      salary: { monthly: 4_100, annualised: 49_200, employer: 'ACME LTD SALARY', months: 3 },
      rent: { monthly: 1_800 },
      savingsHeld: 32_000,
      daysOfHistory: 91,
      consentEndsOn: '2027-01-20',
      transfers: [{ amount: 32_000, cadence: 'once', toLabel: 'SuperSaver', state: 'initiated' }],
    })
  })

  /** Invariant 2: the digest's outstanding list and the status card come from one evaluation. */
  it('no longer lists a payslip or statement the linked account covers', () => {
    const mortgage = application('mortgage', 'in_progress')
    const before = buildCaseDigest(loaded({ applications: [mortgage] }), { today: '2026-10-22' })
    const after = buildCaseDigest(
      loaded({ applications: [mortgage], linkedAccounts: [linked(CURRENT, 'current', 2_340)] }),
      { today: '2026-10-22' },
    )
    const documents = (lines: readonly string[]) =>
      lines.filter((line) => /payslip|statement/i.test(line))

    expect(documents(before.applications[0]?.outstanding ?? []).length).toBeGreaterThan(0)
    expect(documents(after.applications[0]?.outstanding ?? [])).toEqual([])
  })
})

/**
 * Whether they bank here decides where moved money can land. A linked customer banks here by
 * definition; a stated answer wins; nothing known is said as not known, so the model asks once
 * rather than assumes.
 */
describe('whether they bank here', () => {
  it('is true for a linked customer, false when they said so, and null when nobody knows', () => {
    expect(buildCaseDigest(loaded()).banksHere).toBe(true)
    expect(buildCaseDigest(loaded({ customerName: null })).banksHere).toBeNull()
    expect(
      buildCaseDigest(
        loaded({ customerName: null, facts: [fact('banking.existingCustomer', PRIMARY, false)] }),
      ).banksHere,
    ).toBe(false)
  })
})
