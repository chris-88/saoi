import { describe, expect, it } from 'vitest'
import { goalCatalogue } from '@shared/domain/goals/catalogue.ts'
import { needCatalogue } from '@shared/domain/needs/catalogue.ts'
import {
  asApplicationId,
  asFactId,
  asParticipantId,
  type Fact,
  type FactKey,
} from '@shared/domain/facts.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'
import { createApp } from '../../app.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import {
  CASE_ID,
  INVITE_TOKEN,
  PARTNER_ID,
  SECRET,
  STRANGER_ID,
  USER_ID,
  fakePartners,
  fakeSessions,
  fakeStore,
  fakeUploads,
  sha256Hex,
  tokenFor,
} from '../../testing.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

const PRIMARY = asParticipantId('11111111-1111-4111-8111-111111111111')
const PARTNER = asParticipantId('22222222-2222-4222-8222-222222222222')

const fact = (key: FactKey, subject: Fact['subject'], value: unknown, n: number): Fact => ({
  id: asFactId(`f-${String(n)}`),
  key,
  subject,
  value,
  source: 'customer_stated',
  verified: false,
  capturedFor: null,
  supersededBy: null,
  capturedAt: '2026-10-01T10:00:00.000Z',
})

/** A joint account waiting on the partner, with the primary's income on file. */
const jointCase = {
  caseId: CASE_ID,
  kind: 'customer',
  authLevel: 'anonymous',
  customerName: 'Aoife',
  lastSeenAt: null,
  participants: [
    { id: PRIMARY, role: 'primary', displayName: 'Aoife' },
    { id: PARTNER, role: 'partner', displayName: 'Emma' },
  ],
  overrides: [],
  goals: goalCatalogue,
  needs: needCatalogue,
  facts: [fact('income.annualBasic', PRIMARY, 92_123, 1)],
  applications: [
    {
      id: asApplicationId('33333333-3333-4333-8333-333333333333'),
      product: 'joint_account',
      state: 'waiting_partner',
      resumeTo: null,
    },
  ],
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
} as unknown as LoadedCase

async function build(init: { joined?: boolean } = {}) {
  const hash = await sha256Hex(INVITE_TOKEN)
  const partners = fakePartners({
    loaded: jointCase,
    invites: {
      [hash]: {
        caseId: CASE_ID,
        participantId: 'participant-partner',
        expiresAt: null,
        consumedAt: null,
      },
    },
    // The seeded partner browser (PARTNER_ID) has joined already; nobody else has.
    ...(init.joined === false ? { seats: [] } : {}),
  })
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    sessions: fakeSessions(),
    partners,
    uploads: fakeUploads(),
    version: 'test',
    rateLimit: { max: 1000, windowMs: 60_000 },
  })
  return { app, partners, hash }
}

async function call(
  app: Awaited<ReturnType<typeof build>>['app'],
  method: 'GET' | 'POST',
  path: string,
  options: { as?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = {}
  if (options.as !== null) {
    headers['Authorization'] =
      `Bearer ${await tokenFor({ sub: options.as ?? PARTNER_ID, is_anonymous: true })}`
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await app.request(path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

describe('access matrix', () => {
  it.each([
    ['POST', '/api/partner/join', { token: INVITE_TOKEN }],
    ['GET', '/api/partner/tasks', undefined],
    ['POST', '/api/partner/submit', { answers: [{ id: 'fact:x', value: 1 }] }],
  ] as const)('%s %s without a token is 401', async (method, path, body) => {
    const { app } = await build()
    const result = await call(app, method, path, { as: null, body })
    expect(result.status).toBe(401)
  })

  it.each([
    ['a stranger', STRANGER_ID],
    ['the primary customer', USER_ID],
  ])('%s has no partner seat: tasks and submit are 403', async (_who, user) => {
    const { app } = await build()
    expect((await call(app, 'GET', '/api/partner/tasks', { as: user })).status).toBe(403)
    const submit = await call(app, 'POST', '/api/partner/submit', {
      as: user,
      body: { answers: [{ id: 'fact:employment.status', value: 'employed_full_time' }] },
    })
    expect(submit.status).toBe(403)
    expect(submit.body['error']['code']).toBe('forbidden')
  })
})

describe('GET /api/partner/tasks', () => {
  it('returns the scoped view: the partner’s name, the primary’s name, applications and tasks', async () => {
    const { app } = await build()
    const result = await call(app, 'GET', '/api/partner/tasks')
    expect(result.status).toBe(200)
    expect(result.body['partnerName']).toBe('Emma')
    expect(result.body['invitedBy']).toBe('Aoife')
    expect(result.body['applications']).toEqual([
      expect.objectContaining({ displayName: 'Joint current account' }),
    ])
    expect(result.body['tasks'].length).toBeGreaterThan(0)
  })

  it('never carries the primary’s facts (invariant 7)', async () => {
    const { app } = await build()
    const result = await call(app, 'GET', '/api/partner/tasks')
    expect(JSON.stringify(result.body)).not.toContain('92123')
  })

  it('404 when the case is gone', async () => {
    const hash = await sha256Hex(INVITE_TOKEN)
    const partners = fakePartners({
      loaded: null,
      invites: {
        [hash]: { caseId: CASE_ID, participantId: 'x', expiresAt: null, consumedAt: null },
      },
    })
    const app = createApp({
      verifyToken,
      store: fakeStore(),
      sessions: fakeSessions(),
      partners,
      uploads: fakeUploads(),
      version: 'test',
    })
    expect((await call(app, 'GET', '/api/partner/tasks')).status).toBe(404)
  })
})

describe('POST /api/partner/join', () => {
  it('a new browser joins once and gets the view; reopening does not join again', async () => {
    const { app, partners } = await build({ joined: false })
    const first = await call(app, 'POST', '/api/partner/join', {
      as: STRANGER_ID,
      body: { token: INVITE_TOKEN },
    })
    expect(first.status).toBe(200)
    expect(first.body['partnerName']).toBe('Emma')
    expect(partners.seats).toHaveLength(1)

    const again = await call(app, 'POST', '/api/partner/join', {
      as: STRANGER_ID,
      body: { token: INVITE_TOKEN },
    })
    expect(again.status).toBe(200)
    expect(partners.seats).toHaveLength(1)
  })

  it('an unknown token reads as no longer valid', async () => {
    const { app } = await build()
    const result = await call(app, 'POST', '/api/partner/join', {
      body: { token: 'x'.repeat(24) },
    })
    expect(result.status).toBe(404)
    expect(result.body['error']['message']).toContain('no longer valid')
  })

  it('a voided invite still admits the browser that already joined, but not a new one', async () => {
    const hash = await sha256Hex(INVITE_TOKEN)
    const voided = {
      [hash]: {
        caseId: CASE_ID,
        participantId: 'participant-partner',
        expiresAt: null,
        consumedAt: '2026-10-01T10:00:00.000Z',
      },
    }
    const partners = fakePartners({ loaded: jointCase, invites: voided })
    const app = createApp({
      verifyToken,
      store: fakeStore(),
      sessions: fakeSessions(),
      partners,
      uploads: fakeUploads(),
      version: 'test',
    })
    const joined = await call(app, 'POST', '/api/partner/join', { body: { token: INVITE_TOKEN } })
    expect(joined.status).toBe(200)
    const fresh = await call(app, 'POST', '/api/partner/join', {
      as: STRANGER_ID,
      body: { token: INVITE_TOKEN },
    })
    expect(fresh.status).toBe(404)
  })

  it('an expired invite does not admit a new browser', async () => {
    const hash = await sha256Hex(INVITE_TOKEN)
    const partners = fakePartners({
      loaded: jointCase,
      invites: {
        [hash]: {
          caseId: CASE_ID,
          participantId: 'participant-partner',
          expiresAt: '2020-01-01T00:00:00.000Z',
          consumedAt: null,
        },
      },
    })
    const app = createApp({
      verifyToken,
      store: fakeStore(),
      sessions: fakeSessions(),
      partners,
      uploads: fakeUploads(),
      version: 'test',
    })
    const result = await call(app, 'POST', '/api/partner/join', {
      as: STRANGER_ID,
      body: { token: INVITE_TOKEN },
    })
    expect(result.status).toBe(404)
  })

  it('a user that no longer exists is 401', async () => {
    const { app } = await build()
    const result = await call(app, 'POST', '/api/partner/join', {
      as: '99999999-9999-4999-8999-999999999999',
      body: { token: INVITE_TOKEN },
    })
    expect(result.status).toBe(401)
  })

  it('400 for a token of the wrong shape', async () => {
    const { app } = await build()
    expect(
      (await call(app, 'POST', '/api/partner/join', { body: { token: 'short' } })).status,
    ).toBe(400)
  })
})

describe('POST /api/partner/submit', () => {
  it('records valid answers as partner-stated facts and returns the view', async () => {
    const { app, partners } = await build()
    const result = await call(app, 'POST', '/api/partner/submit', {
      body: { answers: [{ id: 'fact:employment.status', value: 'employed_full_time' }] },
    })
    expect(result.status).toBe(200)
    expect(partners.answers).toHaveLength(1)
    expect(partners.answers[0]).toMatchObject({ caseId: CASE_ID, partnerName: 'Emma' })
    expect(partners.answers[0]?.rows[0]).toMatchObject({
      key: 'employment.status',
      source: 'partner_stated',
      verified: false,
      case_id: CASE_ID,
      participant_id: 'participant-partner',
    })
  })

  it('refuses a key that is not collected, writing nothing', async () => {
    const { app, partners } = await build()
    const result = await call(app, 'POST', '/api/partner/submit', {
      body: { answers: [{ id: 'fact:not.a.thing', value: 1 }] },
    })
    expect(result.status).toBe(400)
    expect(result.body['error']['message']).toContain('not something we collect')
    expect(partners.answers).toEqual([])
  })

  it('refuses a value the catalogue rejects, writing nothing', async () => {
    const { app, partners } = await build()
    const result = await call(app, 'POST', '/api/partner/submit', {
      body: { answers: [{ id: 'fact:employment.status', value: 'astronaut' }] },
    })
    expect(result.status).toBe(400)
    expect(partners.answers).toEqual([])
  })

  it('refuses special-category data', async () => {
    const { app, partners } = await build()
    const result = await call(app, 'POST', '/api/partner/submit', {
      body: { answers: [{ id: 'fact:protection.health.smoker', value: true }] },
    })
    expect(result.status).toBe(400)
    expect(partners.answers).toEqual([])
  })

  it('400 for an empty answer list', async () => {
    const { app } = await build()
    expect((await call(app, 'POST', '/api/partner/submit', { body: { answers: [] } })).status).toBe(
      400,
    )
  })
})
