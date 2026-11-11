import { Validator } from '@seriousme/openapi-schema-validator'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from './app.ts'
import type { AppEnv } from './context.ts'
import { ApiError } from './errors.ts'
import { createLogger } from './log.ts'
import { createTokenVerifier } from './middleware/auth.ts'
import { adminTestApp } from './routes/admin/testing.ts'
import { CASE_ID, OTHER_CASE_ID, SECRET, fakeStore, fakeStores, tokenFor } from './testing.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

function appWith(overrides: Partial<AppDeps> = {}) {
  const lines: string[] = []
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    ...fakeStores(),
    version: 'test',
    log: createLogger((line) => lines.push(line)),
    ...overrides,
  })
  return { app, lines }
}

const bearer = async () => ({ Authorization: `Bearer ${await tokenFor()}` })

describe('requireCaseAccess', () => {
  it('404 with the standard envelope when the user has no access', async () => {
    const { app } = appWith()
    const response = await app.request(`/api/cases/${OTHER_CASE_ID}/snapshot`, {
      headers: await bearer(),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'That case does not exist.' },
    })
  })

  it('asks the store once per request and never for a malformed id', async () => {
    let calls = 0
    const store = fakeStore()
    const caseAccess = store.caseAccess.bind(store)
    store.caseAccess = (userId, caseId) => {
      calls += 1
      return caseAccess(userId, caseId)
    }
    const { app } = appWith({ store })
    expect((await app.request('/api/cases/nope/history', { headers: await bearer() })).status).toBe(
      400,
    )
    expect(calls).toBe(0)
    expect(
      (await app.request(`/api/cases/${CASE_ID}/history`, { headers: await bearer() })).status,
    ).toBe(200)
    expect(calls).toBe(1)
  })
})

describe('requestId', () => {
  it('echoes a supplied X-Request-ID, including on errors', async () => {
    const { app } = appWith()
    const response = await app.request('/health', { headers: { 'X-Request-ID': 'abc-123' } })
    expect(response.headers.get('X-Request-ID')).toBe('abc-123')

    const missing = await app.request('/nope', { headers: { 'X-Request-ID': 'abc-124' } })
    expect(missing.headers.get('X-Request-ID')).toBe('abc-124')
    expect(await missing.json()).toMatchObject({ error: { requestId: 'abc-124' } })
  })

  it('generates one when absent or unsafe', async () => {
    const { app } = appWith()
    const absent = await app.request('/health')
    expect(absent.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/)
    const unsafe = await app.request('/health', { headers: { 'X-Request-ID': 'a b\tc' } })
    expect(unsafe.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('onError', () => {
  // The same handler, reached through routes that throw.
  function throwing(error: unknown) {
    const { app, lines } = appWith()
    const probe = new Hono<AppEnv>()
    probe.get('/boom', () => {
      throw error
    })
    // Routes added after the fact still sit behind createApp's middleware and error handler.
    app.route('/', probe as never)
    return { app, lines }
  }

  it('maps an ApiError to its code and status, with the request id', async () => {
    const { app } = throwing(new ApiError('conflict', 'Already done.', { details: ['x'] }))
    const response = await app.request('/boom', { headers: { 'X-Request-ID': 'r1' } })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'Already done.', details: ['x'], requestId: 'r1' },
    })
  })

  it('answers an unknown throw with a generic 500 and logs the cause, not the caller', async () => {
    const { app, lines } = throwing(new Error('relation "participants" does not exist'))
    const response = await app.request('/boom', { headers: { 'X-Request-ID': 'r2' } })
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('participants')
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Something went wrong.', requestId: 'r2' },
    })
    expect(lines.some((line) => line.includes('relation'))).toBe(true)
  })
})

describe('logging', () => {
  it('never writes tokens or keys', () => {
    const { lines } = (() => {
      const captured: string[] = []
      createLogger((line) => captured.push(line)).info('x', {
        accessToken: 'secret-value',
        nested: { serviceRoleKey: 'secret-value', ok: 1 },
      })
      return { lines: captured }
    })()
    expect(lines.join('')).not.toContain('secret-value')
    expect(lines.join('')).toContain('"ok":1')
  })

  it('logs one request line without the Authorization header', async () => {
    const { app, lines } = appWith()
    await app.request(`/api/cases/${CASE_ID}/history`, { headers: await bearer() })
    const line = lines.find((entry) => entry.includes('"request"'))
    expect(line).toBeDefined()
    expect(line).not.toContain('Bearer')
  })
})

describe('CORS', () => {
  const origin = 'https://app.example.test'

  it('denies by default: no allow-origin header', async () => {
    const { app } = appWith()
    const response = await app.request('/health', { headers: { Origin: origin } })
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows a listed origin and only that one', async () => {
    const { app } = appWith({ corsOrigins: [origin] })
    const allowed = await app.request('/health', { headers: { Origin: origin } })
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    const other = await app.request('/health', { headers: { Origin: 'https://evil.test' } })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('never answers *', async () => {
    const { app } = appWith({ corsOrigins: ['*'] })
    const response = await app.request('/health', { headers: { Origin: origin } })
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
  })
})

describe('rate limit and headers', () => {
  it('429s a user past the limit, with Retry-After, and leaves /health alone', async () => {
    const { app } = appWith({ rateLimit: { max: 2, windowMs: 60_000 } })
    const headers = await bearer()
    const path = `/api/cases/${CASE_ID}/snapshot`
    expect((await app.request(path, { headers })).status).toBe(200)
    expect((await app.request(path, { headers })).status).toBe(200)
    const limited = await app.request(path, { headers })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).not.toBeNull()
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited' } })
    expect((await app.request('/health')).status).toBe(200)
  })

  it('sends security headers', async () => {
    const { app } = appWith()
    const response = await app.request('/health')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(response.headers.get('Strict-Transport-Security')).not.toBeNull()
  })
})

describe('OpenAPI document', () => {
  it('validates and lists the named components', async () => {
    const { app } = appWith()
    const document = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>
      components: { schemas: Record<string, unknown> }
    }
    const result = await new Validator().validate(document)
    expect(result.valid).toBe(true)
    expect(Object.keys(document.components.schemas).sort()).toEqual(
      expect.arrayContaining([
        'CaseActionResult',
        'CaseFeedReady',
        'CaseFeedUpdate',
        'CaseHistory',
        'CaseSnapshot',
        'ErrorResponse',
        'Health',
        'ListCasesResponse',
        'PartnerView',
        'SessionResponse',
        'UploadedDocument',
        'GiveFeedback',
        'InitiateTransfer',
        'InvitePartner',
        'LinkAccounts',
        'PlanDecision',
        'PushSubscribed',
        'SelectProducts',
        'SubmitApplication',
        'SubscribePush',
      ]),
    )
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/cases',
      '/api/cases/{caseId}/applications/{applicationId}/confirm',
      '/api/cases/{caseId}/applications/{applicationId}/consent',
      '/api/cases/{caseId}/applications/{applicationId}/form-declarations',
      '/api/cases/{caseId}/applications/{applicationId}/health-answers',
      '/api/cases/{caseId}/applications/{applicationId}/pause',
      '/api/cases/{caseId}/applications/{applicationId}/resume',
      '/api/cases/{caseId}/applications/{applicationId}/submit',
      '/api/cases/{caseId}/documents',
      '/api/cases/{caseId}/events',
      '/api/cases/{caseId}/feedback',
      '/api/cases/{caseId}/history',
      '/api/cases/{caseId}/invites',
      '/api/cases/{caseId}/linked-accounts',
      '/api/cases/{caseId}/linked-accounts/revoke',
      '/api/cases/{caseId}/plans/{planId}/decisions',
      '/api/cases/{caseId}/products/select',
      '/api/cases/{caseId}/products/{product}/decline',
      '/api/cases/{caseId}/push-subscriptions',
      '/api/cases/{caseId}/snapshot',
      '/api/cases/{caseId}/switch',
      '/api/cases/{caseId}/transfers',
      '/api/health',
      '/api/interest',
      '/api/partner/join',
      '/api/partner/submit',
      '/api/partner/tasks',
      '/api/sessions',
      '/api/sessions/claim',
      '/health',
    ])
  })

  it('serves the same document and liveness check under /api, without a token', async () => {
    const { app } = appWith()
    const root = await (await app.request('/openapi.json')).text()
    const aliased = await app.request('/api/openapi.json')
    expect(aliased.status).toBe(200)
    expect(await aliased.text()).toBe(root)

    const health = await app.request('/api/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, version: 'test' })
    // The rest of /api still wants a token.
    expect((await app.request('/api/cases')).status).toBe(401)
  })
})

describe('OpenAPI document: admin API', () => {
  it('validates, and every /api/admin operation is tagged admin with named components', async () => {
    const { app } = adminTestApp()
    const document = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, Record<string, { tags?: string[] }>>
      components: { schemas: Record<string, unknown> }
    }
    const result = await new Validator().validate(document)
    expect(result.valid).toBe(true)

    const operations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/api/admin/'))
      .flatMap(([, methods]) => Object.values(methods))
    expect(operations.length).toBeGreaterThanOrEqual(37)
    for (const operation of operations) expect(operation.tags).toEqual(['admin'])

    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining([
        'AdminCase',
        'CatalogueLoad',
        'CatalogueOverrides',
        'ConfirmDestructive',
        'FormInspection',
        'GuardrailTest',
        'KillSwitchState',
        'MortgageRatesList',
        'PersonaPreview',
        'ProductCatalogueList',
        'PurgeResult',
        'ResetCaseRequest',
      ]),
    )
  })
})

describe('OpenAPI document: alerts', () => {
  it('validates, names the alert components, and leaves the internal run out', async () => {
    const { app } = appWith({
      alerts: {
        store: {} as never,
        market: () => Promise.reject(new Error('not called')),
        internalKey: 'internal-key-for-tests',
      },
    })
    const document = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, Record<string, { tags?: string[] }>>
      components: { schemas: Record<string, unknown> }
    }
    expect((await new Validator().validate(document)).valid).toBe(true)
    expect(document.paths['/api/cases/{caseId}/alerts']?.['get']?.tags).toEqual(['alerts'])
    expect(Object.keys(document.paths['/api/cases/{caseId}/reminders/{reminderId}'] ?? {})).toEqual(
      ['delete'],
    )
    expect(Object.keys(document.paths).some((path) => path.includes('internal'))).toBe(false)
    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining(['CaseAlerts', 'CreateReminder', 'Reminder']),
    )
  })
})

describe('OpenAPI document: the conversation turn', () => {
  it('validates, and documents the stream with its frames as a named component', async () => {
    const { app } = appWith({ turn: { run: () => Promise.reject(new Error('not called')) } })
    const document = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<
        string,
        Record<string, { tags?: string[]; responses: Record<string, { content?: object }> }>
      >
      components: { schemas: Record<string, unknown> }
    }
    const result = await new Validator().validate(document)
    expect(result.valid).toBe(true)

    const operation = document.paths['/api/cases/{caseId}/turns']?.['post']
    expect(operation?.tags).toEqual(['turns'])
    expect(Object.keys(operation?.responses['200']?.content ?? {})).toEqual(['text/event-stream'])
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '429']),
    )
    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining(['SaoirseTurnRequest', 'SaoirseStreamEvent']),
    )
  })

  it('is absent when no turn runner is configured', async () => {
    const { app } = appWith()
    const document = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>
    }
    expect(document.paths['/api/cases/{caseId}/turns']).toBeUndefined()
  })
})
