import { describe, expect, it } from 'vitest'
import { createApp } from '../../app.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import {
  ACCOUNT_ID,
  ADMIN_ID,
  CASE_ID,
  OTHER_CASE_ID,
  PARTNER_ID,
  PRESENTER_KEY,
  SECRET,
  STRANGER_ID,
  USER_ID,
  fakePartners,
  fakeSessions,
  fakeStore,
  fakeUploads,
  identityOf,
  tokenFor,
} from '../../testing.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

function appWith(sessions = fakeSessions(), config: { audienceMaxCases?: number } = {}) {
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    sessions,
    partners: fakePartners(),
    uploads: fakeUploads(),
    version: 'test',
    config: { presenterKey: PRESENTER_KEY, ...config },
    rateLimit: { max: 1000, windowMs: 60_000 },
  })
  return { app, sessions }
}

type Caller = { sub?: string; anonymous?: boolean } | null

async function call(
  app: ReturnType<typeof appWith>['app'],
  method: 'GET' | 'POST',
  path: string,
  options: { as?: Caller; body?: unknown; headers?: Record<string, string> } = {},
) {
  const caller = options.as === undefined ? {} : options.as
  const headers: Record<string, string> = { ...options.headers }
  if (caller !== null) {
    headers['Authorization'] =
      `Bearer ${await tokenFor({ sub: caller.sub ?? USER_ID, is_anonymous: caller.anonymous ?? true })}`
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await app.request(path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const body = (await response.json()) as Record<string, any>
  return { status: response.status, body }
}

describe('access matrix: every session route needs a token', () => {
  it.each([
    ['POST', '/api/sessions', {}],
    ['GET', '/api/cases', undefined],
    ['POST', '/api/cases', {}],
    ['POST', `/api/cases/${CASE_ID}/switch`, undefined],
    ['POST', '/api/sessions/claim', { priorAuthUserId: STRANGER_ID }],
    [
      'POST',
      '/api/interest',
      { name: 'Ada', email: 'a@example.invalid', interest: 'help out', consent: true },
    ],
  ] as const)('%s %s without a token is 401', async (method, path, body) => {
    const { app } = appWith()
    const result = await call(app, method, path, { as: null, body })
    expect(result.status).toBe(401)
    expect(result.body['error']['code']).toBe('unauthorised')
  })

  it('a token for a user that no longer exists is 401, so the browser starts again', async () => {
    const { app } = appWith(fakeSessions({ identities: [] }))
    const result = await call(app, 'POST', '/api/sessions', { body: {} })
    expect(result.status).toBe(401)
    expect(result.body['error']['message']).toBe('No session.')
  })
})

describe('POST /api/sessions (start)', () => {
  it('opens a case for a new visitor, keeping the source, and returns the same one again', async () => {
    const { app, sessions } = appWith(fakeSessions({ seats: [] }))
    const first = await call(app, 'POST', '/api/sessions', {
      body: { mode: 'new', source: 'qr' },
    })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ created: true, role: 'primary', authLevel: 'anonymous' })
    expect(sessions.created).toEqual([{ userId: USER_ID, mode: 'new', source: 'qr' }])

    const again = await call(app, 'POST', '/api/sessions', { body: {} })
    expect(again.body).toMatchObject({ caseId: first.body['caseId'], created: false })
    expect(sessions.created).toHaveLength(1)
  })

  it('takes an empty body as a new visitor', async () => {
    const { app, sessions } = appWith(fakeSessions({ seats: [] }))
    const result = await call(app, 'POST', '/api/sessions')
    expect(result.status).toBe(200)
    expect(sessions.created[0]).toMatchObject({ mode: 'new', source: null })
  })

  it('passes mode known through', async () => {
    const { app, sessions } = appWith(fakeSessions({ seats: [] }))
    await call(app, 'POST', '/api/sessions', { body: { mode: 'known' } })
    expect(sessions.created[0]?.mode).toBe('known')
  })

  it('refuses a new case at the audience cap but lets a returning visitor in', async () => {
    const { app } = appWith(fakeSessions({ casesToday: 5 }), { audienceMaxCases: 5 })
    const returning = await call(app, 'POST', '/api/sessions', { body: {} })
    expect(returning.status).toBe(200)
    expect(returning.body['caseId']).toBe(CASE_ID)

    const fresh = await call(app, 'POST', '/api/sessions', { as: { sub: STRANGER_ID }, body: {} })
    expect(fresh.status).toBe(429)
    expect(fresh.body['error']['code']).toBe('rate_limited')
  })

  it('a partner seat does not count as a conversation: start opens a case of their own', async () => {
    const sessions = fakeSessions({
      seats: [{ userId: PARTNER_ID, participantId: 'p-partner', caseId: CASE_ID, role: 'partner' }],
    })
    const { app } = appWith(sessions)
    const result = await call(app, 'POST', '/api/sessions', { as: { sub: PARTNER_ID }, body: {} })
    expect(result.body).toMatchObject({ created: true })
    expect(result.body['caseId']).not.toBe(CASE_ID)
  })

  it('400 for an unknown mode', async () => {
    const { app } = appWith()
    const result = await call(app, 'POST', '/api/sessions', { body: { mode: 'teleport' } })
    expect(result.status).toBe(400)
  })
})

describe('GET /api/cases', () => {
  const sessions = () =>
    fakeSessions({
      seats: [
        { userId: USER_ID, participantId: 'p-1', caseId: CASE_ID, role: 'primary' },
        { userId: STRANGER_ID, participantId: 'p-2', caseId: OTHER_CASE_ID, role: 'primary' },
      ],
      cases: [
        { caseId: CASE_ID, messages: 2 },
        { caseId: OTHER_CASE_ID, messages: 4 },
        { caseId: 'probe', messages: 1, kind: 'test' },
      ],
    })

  it('shows a visitor their own conversations only', async () => {
    const { app } = appWith(sessions())
    const result = await call(app, 'GET', '/api/cases')
    expect(result.status).toBe(200)
    expect(result.body['presenter']).toBe(false)
    expect(result.body['cases'].map((row: { caseId: string }) => row.caseId)).toEqual([CASE_ID])
    expect(result.body['cases'][0]).toMatchObject({ current: true, mine: true })
  })

  it('a wrong key opens nothing', async () => {
    const { app } = appWith(sessions())
    const result = await call(app, 'GET', '/api/cases', {
      headers: { 'X-Presenter-Key': 'guess' },
    })
    expect(result.body['presenter']).toBe(false)
    expect(result.body['cases']).toHaveLength(1)
  })

  it('the key opens everyone except test cases', async () => {
    const { app } = appWith(sessions())
    const result = await call(app, 'GET', '/api/cases', {
      headers: { 'X-Presenter-Key': PRESENTER_KEY },
    })
    expect(result.body['presenter']).toBe(true)
    expect(result.body['cases'].map((row: { caseId: string }) => row.caseId).sort()).toEqual(
      [CASE_ID, OTHER_CASE_ID].sort(),
    )
    const theirs = result.body['cases'].find(
      (row: { caseId: string }) => row.caseId === OTHER_CASE_ID,
    )
    expect(theirs.mine).toBe(false)
  })

  it('no key is configured: nobody is a presenter, not even with an empty header', async () => {
    const app = createApp({
      verifyToken,
      store: fakeStore(),
      sessions: sessions(),
      partners: fakePartners(),
      uploads: fakeUploads(),
      version: 'test',
    })
    for (const key of ['', 'anything']) {
      const result = await call(app, 'GET', '/api/cases', { headers: { 'X-Presenter-Key': key } })
      expect(result.body['presenter']).toBe(false)
    }
  })

  it('a partner sees no conversations', async () => {
    const { app } = appWith(
      fakeSessions({
        seats: [{ userId: PARTNER_ID, participantId: 'p-3', caseId: CASE_ID, role: 'partner' }],
      }),
    )
    const result = await call(app, 'GET', '/api/cases', { as: { sub: PARTNER_ID } })
    expect(result.body['cases']).toEqual([])
  })
})

describe('POST /api/cases', () => {
  it('begins a fresh conversation with 201', async () => {
    const { app, sessions } = appWith()
    const result = await call(app, 'POST', '/api/cases', { body: { mode: 'new' } })
    expect(result.status).toBe(201)
    expect(result.body).toMatchObject({ created: true })
    expect(result.body['caseId']).not.toBe(CASE_ID)
    expect(sessions.created[0]?.source).toBeNull()
  })

  it('counts against the audience cap', async () => {
    const { app } = appWith(fakeSessions({ casesToday: 1 }), { audienceMaxCases: 1 })
    const result = await call(app, 'POST', '/api/cases', { body: {} })
    expect(result.status).toBe(429)
  })
})

describe('POST /api/cases/:caseId/switch', () => {
  const twoUsers = () =>
    fakeSessions({
      seats: [
        { userId: USER_ID, participantId: 'p-1', caseId: CASE_ID, role: 'primary' },
        { userId: STRANGER_ID, participantId: 'p-2', caseId: OTHER_CASE_ID, role: 'primary' },
        { userId: PARTNER_ID, participantId: 'p-3', caseId: CASE_ID, role: 'partner' },
      ],
    })

  it('lets the primary customer back into their own case', async () => {
    const { app } = appWith(twoUsers())
    const result = await call(app, 'POST', `/api/cases/${CASE_ID}/switch`)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ caseId: CASE_ID, created: false, role: 'primary' })
  })

  it('refuses a stranger, with no key or a wrong one', async () => {
    const { app } = appWith(twoUsers())
    const none = await call(app, 'POST', `/api/cases/${OTHER_CASE_ID}/switch`)
    expect(none.status).toBe(403)
    expect(none.body['error']['code']).toBe('forbidden')
    const wrong = await call(app, 'POST', `/api/cases/${OTHER_CASE_ID}/switch`, {
      headers: { 'X-Presenter-Key': 'guess' },
    })
    expect(wrong.status).toBe(403)
  })

  it('refuses a partner on the case', async () => {
    const { app } = appWith(twoUsers())
    const result = await call(app, 'POST', `/api/cases/${CASE_ID}/switch`, {
      as: { sub: PARTNER_ID },
    })
    expect(result.status).toBe(403)
  })

  it('the presenter key adopts the primary participant, without a second participant', async () => {
    const sessions = twoUsers()
    const { app } = appWith(sessions)
    const result = await call(app, 'POST', `/api/cases/${OTHER_CASE_ID}/switch`, {
      headers: { 'X-Presenter-Key': PRESENTER_KEY },
    })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      caseId: OTHER_CASE_ID,
      participantId: 'p-2',
      role: 'primary',
    })
    expect(sessions.seats.some((s) => s.userId === USER_ID && s.participantId === 'p-2')).toBe(true)
  })

  it('a case with no one in it is 404 even for the presenter', async () => {
    const { app } = appWith(twoUsers())
    const result = await call(
      app,
      'POST',
      `/api/cases/${'9'.repeat(8)}-9999-4999-8999-${'9'.repeat(12)}/switch`,
      {
        headers: { 'X-Presenter-Key': PRESENTER_KEY },
      },
    )
    expect(result.status).toBe(404)
  })

  it('400 for an id that is not a uuid', async () => {
    const { app } = appWith()
    const result = await call(app, 'POST', '/api/cases/nope/switch')
    expect(result.status).toBe(400)
  })
})

describe('POST /api/sessions/claim', () => {
  const visitorSeat = {
    userId: STRANGER_ID,
    participantId: 'p-visitor',
    caseId: OTHER_CASE_ID,
    role: 'primary',
  }
  const claim = (as: Caller, prior: string) => ({ as, body: { priorAuthUserId: prior } }) as const

  it('an anonymous caller cannot claim a conversation by quoting its id', async () => {
    const { app } = appWith(fakeSessions({ seats: [visitorSeat] }))
    const result = await call(
      app,
      'POST',
      '/api/sessions/claim',
      claim({ sub: USER_ID }, STRANGER_ID),
    )
    expect(result.status).toBe(403)
    expect(result.body['error']['code']).toBe('forbidden')
  })

  it('a signed-in account takes over what the anonymous visitor had', async () => {
    const sessions = fakeSessions({
      seats: [visitorSeat],
      substance: {
        [OTHER_CASE_ID]: { customerMessages: 3, facts: 0, applications: 0, plans: 0 },
      },
    })
    const { app } = appWith(sessions)
    const result = await call(
      app,
      'POST',
      '/api/sessions/claim',
      claim({ sub: ACCOUNT_ID, anonymous: false }, STRANGER_ID),
    )
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      caseId: OTHER_CASE_ID,
      participantId: 'p-visitor',
      authLevel: 'authenticated',
    })
    expect(sessions.seats.map((s) => [s.userId, s.participantId])).toContainEqual([
      ACCOUNT_ID,
      'p-visitor',
    ])
    // The anonymous row stays as the record.
    expect(sessions.seats.some((s) => s.userId === STRANGER_ID)).toBe(true)
  })

  it('an empty visitor case is not carried when the account already has a conversation', async () => {
    const sessions = fakeSessions({
      seats: [
        visitorSeat,
        { userId: ACCOUNT_ID, participantId: 'p-own', caseId: CASE_ID, role: 'primary' },
      ],
    })
    const { app } = appWith(sessions)
    const result = await call(
      app,
      'POST',
      '/api/sessions/claim',
      claim({ sub: ACCOUNT_ID, anonymous: false }, STRANGER_ID),
    )
    expect(result.body['caseId']).toBe(CASE_ID)
    expect(
      sessions.seats.some((s) => s.userId === ACCOUNT_ID && s.participantId === 'p-visitor'),
    ).toBe(false)
  })

  it('refuses a prior user that is not anonymous', async () => {
    const { app } = appWith(fakeSessions({ seats: [visitorSeat] }))
    const result = await call(
      app,
      'POST',
      '/api/sessions/claim',
      claim({ sub: ACCOUNT_ID, anonymous: false }, ADMIN_ID),
    )
    expect(result.status).toBe(403)
  })

  it('refuses a prior user that does not exist, and 404s an anonymous user with nothing', async () => {
    const sessions = fakeSessions({
      seats: [],
      identities: [identityOf(ACCOUNT_ID, { isAnonymous: false }), identityOf(STRANGER_ID)],
    })
    const { app } = appWith(sessions)
    const ghost = await call(
      app,
      'POST',
      '/api/sessions/claim',
      claim({ sub: ACCOUNT_ID, anonymous: false }, PARTNER_ID),
    )
    expect(ghost.status).toBe(403)
    const empty = await call(
      app,
      'POST',
      '/api/sessions/claim',
      claim({ sub: ACCOUNT_ID, anonymous: false }, STRANGER_ID),
    )
    expect(empty.status).toBe(404)
  })

  it('quoting yourself is answered: your current case, or 404 when there is none', async () => {
    const { app } = appWith(fakeSessions({ seats: [] }))
    const none = await call(
      app,
      'POST',
      '/api/sessions/claim',
      claim({ sub: ACCOUNT_ID, anonymous: false }, ACCOUNT_ID),
    )
    expect(none.status).toBe(404)

    const { app: withCase } = appWith()
    const self = await call(
      withCase,
      'POST',
      '/api/sessions/claim',
      claim({ sub: USER_ID }, USER_ID),
    )
    expect(self.status).toBe(200)
    expect(self.body['caseId']).toBe(CASE_ID)
  })

  it('400 for a prior id that is not a uuid', async () => {
    const { app } = appWith()
    const result = await call(app, 'POST', '/api/sessions/claim', claim({}, 'nope'))
    expect(result.status).toBe(400)
  })
})

describe('POST /api/interest', () => {
  const form = {
    name: 'Ada Tester',
    email: 'ada@example.invalid',
    interest: 'I would like to help',
    consent: true,
  }

  it('stores a registration, defaulting the kind', async () => {
    const { app, sessions } = appWith()
    const result = await call(app, 'POST', '/api/interest', { body: form })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ registered: true })
    expect(sessions.interests).toEqual([
      expect.objectContaining({ kind: 'collaborate', name: 'Ada Tester', consent: true }),
    ])
  })

  it('answers ok to a filled honeypot and stores nothing', async () => {
    const { app, sessions } = appWith()
    const result = await call(app, 'POST', '/api/interest', {
      body: { ...form, website: 'http://spam.invalid' },
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ registered: true })
    expect(sessions.interests).toEqual([])
  })

  it('requires consent', async () => {
    const { app } = appWith()
    const result = await call(app, 'POST', '/api/interest', { body: { ...form, consent: false } })
    expect(result.status).toBe(400)
  })

  it('stops at the daily cap', async () => {
    const { app, sessions } = appWith(fakeSessions({ interestsToday: 50 }))
    const result = await call(app, 'POST', '/api/interest', { body: form })
    expect(result.status).toBe(429)
    expect(result.body['error']['code']).toBe('rate_limited')
    expect(sessions.interests).toEqual([])
  })
})
