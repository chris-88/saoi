import { describe, expect, it } from 'vitest'
import { goalCatalogue } from '../domain/goals/catalogue.ts'
import { needCatalogue } from '../domain/needs/catalogue.ts'
import { asApplicationId, asFactId, asParticipantId, type Fact } from '../domain/facts.ts'
import { journeyFor } from '../domain/journeys/index.ts'
import type { JourneyEvaluation } from '../domain/requirements.ts'
import type { Application } from '../domain/state-machine.ts'
import { slidersFor } from '../llm/persona.ts'
import type { Db } from './case-repository.ts'
import type { LoadedCase } from './loaded-case.ts'
import {
  applicationName,
  createApplications,
  recomputeApplications,
  recordReuse,
  statusSteps,
} from './applications.ts'

/**
 * Captures every write, so what an application is called can be checked at the point it is
 * stored and at every point it is reported, without a database.
 */
type Write = {
  readonly table: string
  readonly kind: 'insert' | 'upsert' | 'update'
  readonly payload: unknown
}

function stubClient(): { client: Db; writes: Write[] } {
  const writes: Write[] = []
  let serial = 0

  const from = (table: string) => {
    let pending: Write | null = null

    const record = (kind: Write['kind']) => (payload: unknown) => {
      pending = { table, kind, payload }
      writes.push(pending)
      return chain
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      insert: record('insert'),
      upsert: record('upsert'),
      update: record('update'),
      then: (resolve: (value: unknown) => unknown) => {
        // An insert of several rows is read back with ids, as `createApplications` does.
        if (pending?.kind === 'insert' && Array.isArray(pending.payload)) {
          const data = pending.payload.map((row: Record<string, unknown>) => {
            serial += 1
            return { ...row, id: `33333333-3333-4333-8333-${String(serial).padStart(12, '0')}` }
          })
          return resolve({ data, error: null })
        }
        return resolve({ data: null, error: null })
      },
    }

    return chain
  }

  return { client: { from } as unknown as Db, writes }
}

const PRIMARY = asParticipantId('11111111-1111-4111-8111-111111111111')

let n = 0
const application = (
  product: Application['product'],
  extra: Partial<Application> = {},
): Application => {
  n += 1
  return {
    id: asApplicationId(`33333333-3333-4333-8333-${String(n).padStart(12, '0')}`),
    product,
    state: 'not_started',
    resumeTo: null,
    ...extra,
  }
}

function loaded(overrides: Partial<LoadedCase> = {}): LoadedCase {
  return {
    caseId: '44444444-4444-4444-8444-444444444444',
    kind: 'customer',
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

/** The tenant's catalogue, as the Edge Functions inject it. */
const CATALOGUE: Record<string, string> = {
  'savings.supersaver': 'SuperSaver',
  'savings.mortgagesaver': 'MortgageSaver',
  'savings.advantage-fixed': 'Advantage Fixed Term Deposit',
}
const nameFor = (product: Application['product'], catalogueId: string | null): string =>
  (catalogueId === null ? undefined : CATALOGUE[catalogueId]) ?? journeyFor(product).displayName

const eventsOf = (writes: readonly Write[], type: string) =>
  writes
    .filter((write) => write.table === 'events' && write.kind === 'insert')
    .map((write) => write.payload as { type: string; payload: Record<string, unknown> })
    .filter((event) => event.type === type)

describe('what an application is called', () => {
  it('is what the customer saw it called when they started it', () => {
    const stored = application('savings', {
      catalogueId: 'savings.supersaver',
      displayName: 'SuperSaver',
    })
    // The row wins even over a catalogue that would now call it something else.
    expect(applicationName(stored, () => 'Renamed since')).toBe('SuperSaver')
    expect(applicationName(stored)).toBe('SuperSaver')
  })

  /** Every application created before the column existed. */
  it('falls back to the catalogue, then to the journey, for a row with no name', () => {
    const legacy = application('savings', { catalogueId: 'savings.supersaver', displayName: null })
    expect(applicationName(legacy, nameFor)).toBe('SuperSaver')
    expect(applicationName(legacy)).toBe('Savings account')

    const bare = application('mortgage')
    expect(applicationName(bare, nameFor)).toBe(journeyFor('mortgage').displayName)
    expect(applicationName(bare)).toBe(journeyFor('mortgage').displayName)
  })
})

describe('starting applications', () => {
  /** Case aed80555: three savings products in one tap, three rows all called "Savings account". */
  it('stores the catalogue name on each row and records it on the event', async () => {
    const { client, writes } = stubClient()

    await createApplications(
      client,
      loaded(),
      [
        { product: 'savings', catalogueId: 'savings.advantage-fixed' },
        { product: 'savings', catalogueId: 'savings.mortgagesaver' },
        { product: 'savings', catalogueId: 'savings.supersaver' },
      ],
      nameFor,
    )

    const inserted = writes.find(
      (write) => write.table === 'applications' && write.kind === 'insert',
    )
    expect(
      (inserted?.payload as { display_name: string }[]).map((row) => row.display_name),
    ).toEqual(['Advantage Fixed Term Deposit', 'MortgageSaver', 'SuperSaver'])

    expect(
      eventsOf(writes, 'application_created').map((event) => event.payload.applicationName),
    ).toEqual(['Advantage Fixed Term Deposit', 'MortgageSaver', 'SuperSaver'])
  })

  it('stores the journey name when nothing better is known', async () => {
    const { client, writes } = stubClient()

    await createApplications(client, loaded(), [{ product: 'mortgage' }, { product: 'savings' }])

    const inserted = writes.find(
      (write) => write.table === 'applications' && write.kind === 'insert',
    )
    expect(
      (inserted?.payload as { display_name: string }[]).map((row) => row.display_name),
    ).toEqual([journeyFor('mortgage').displayName, 'Savings account'])
  })
})

describe('reporting applications', () => {
  it('calls each one what its row says, in the summary and in the event', async () => {
    const { client, writes } = stubClient()
    const theCase = loaded({
      applications: [
        application('savings', {
          catalogueId: 'savings.advantage-fixed',
          displayName: 'Advantage Fixed Term Deposit',
        }),
        application('savings', {
          catalogueId: 'savings.mortgagesaver',
          displayName: 'MortgageSaver',
        }),
        application('savings', { catalogueId: 'savings.supersaver', displayName: 'SuperSaver' }),
      ],
    })

    // Nothing is known yet, so every application moves on to waiting for the customer.
    const summaries = await recomputeApplications(client, theCase)

    expect(summaries.map((summary) => summary.displayName)).toEqual([
      'Advantage Fixed Term Deposit',
      'MortgageSaver',
      'SuperSaver',
    ])
    expect(summaries.map((summary) => summary.state)).toEqual([
      'waiting_customer',
      'waiting_customer',
      'waiting_customer',
    ])
    expect(
      eventsOf(writes, 'application_state_changed').map((event) => event.payload.applicationName),
    ).toEqual(['Advantage Fixed Term Deposit', 'MortgageSaver', 'SuperSaver'])
  })

  it('names a row created before the column from the catalogue, or failing that the journey', async () => {
    const legacy = application('savings', { catalogueId: 'savings.supersaver', displayName: null })

    const withCatalogue = await recomputeApplications(
      stubClient().client,
      loaded({ applications: [legacy] }),
      {
        nameFor,
      },
    )
    expect(withCatalogue[0]?.displayName).toBe('SuperSaver')

    const { client, writes } = stubClient()
    const without = await recomputeApplications(client, loaded({ applications: [legacy] }))
    expect(without[0]?.displayName).toBe('Savings account')
    expect(eventsOf(writes, 'application_state_changed')[0]?.payload.applicationName).toBe(
      'Savings account',
    )
  })
})

describe('recording what was reused', () => {
  it('names the application the customer knows, and reports what it recorded', async () => {
    const { client, writes } = stubClient()
    const supersaver = application('savings', {
      catalogueId: 'savings.supersaver',
      displayName: 'SuperSaver',
    })
    const requirement = journeyFor('savings').requirements.find(
      (candidate) => candidate.kind === 'fact',
    )
    if (requirement === undefined || requirement.kind !== 'fact')
      throw new Error('savings asks for facts')

    const fact: Fact = {
      id: asFactId('f-1'),
      key: requirement.fact,
      subject: PRIMARY,
      value: 'Aoife Byrne',
      source: 'bank_held',
      verified: true,
      capturedFor: null,
      supersededBy: null,
      capturedAt: '2026-10-01T10:00:00.000Z',
    }
    const evaluation: JourneyEvaluation = {
      satisfied: [{ requirement, fact, reused: true }],
      outstanding: [],
      complete: false,
      waitingOn: null,
      activeBranches: [],
    }

    const recorded = await recordReuse(
      client,
      loaded({ applications: [supersaver] }),
      supersaver,
      evaluation,
    )

    expect(recorded.map((item) => item.fact?.key)).toEqual([requirement.fact])
    expect(eventsOf(writes, 'context_reused').map((event) => event.payload)).toEqual([
      expect.objectContaining({
        applicationName: 'SuperSaver',
        key: requirement.fact,
        source: 'bank_held',
      }),
    ])
  })
})

/**
 * The status card's steps.
 *
 * A document that has arrived and a document the bank has checked are different things to the
 * customer waiting on the second, and the label is the only place the card can say which.
 */
describe('what the status card lists', () => {
  const journey = journeyFor('current_account')
  const requirement = (id: string) => {
    const found = journey.requirements.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`the current account journey has no ${id}`)
    return found
  }

  it('says a document was checked, and only once it has been', () => {
    const steps = statusSteps({
      satisfied: [
        {
          requirement: requirement('photo-id'),
          fact: null,
          reused: false,
          document: { verified: true },
        },
        {
          requirement: requirement('address-proof'),
          fact: null,
          reused: false,
          document: { verified: false },
        },
      ],
      outstanding: [],
      complete: true,
      waitingOn: null,
      activeBranches: [],
    })

    expect(steps).toEqual([
      { label: 'Photo ID (checked)', done: true, waitingOnPartner: false },
      { label: 'Proof of address', done: true, waitingOnPartner: false },
    ])
  })

  it('lists what is still blocking after what is met, and who it waits on', () => {
    const partnerId = journeyFor('joint_account').requirements.find(
      (candidate) => candidate.id === 'partner-doc-id',
    )
    if (partnerId === undefined) throw new Error("the joint account asks for the partner's ID")

    const steps = statusSteps({
      satisfied: [{ requirement: requirement('terms'), fact: null, reused: false }],
      outstanding: [
        {
          requirement: requirement('photo-id'),
          reason: 'awaiting_document',
          waitingOn: 'primary',
          blocking: true,
          knownFact: null,
        },
        {
          requirement: partnerId,
          reason: 'awaiting_partner',
          waitingOn: 'partner',
          blocking: true,
          knownFact: null,
        },
        // Optional, so it never holds the application back and is not a step.
        {
          requirement: requirement('email'),
          reason: 'missing',
          waitingOn: 'primary',
          blocking: false,
          knownFact: null,
        },
      ],
      complete: false,
      waitingOn: 'primary',
      activeBranches: [],
    })

    expect(steps).toEqual([
      { label: 'Current account terms and conditions', done: true, waitingOnPartner: false },
      { label: 'Photo ID', done: false, waitingOnPartner: false },
      { label: "Your partner's photo ID", done: false, waitingOnPartner: true },
    ])
  })
})
