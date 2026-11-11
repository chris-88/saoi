import { describe, expect, it } from 'vitest'
import { exampleMarketPlan } from '@shared/contracts/market-plan.example.ts'
import type { MarketPlan } from '@shared/contracts/market-plan.ts'
import { createApp } from '../../app.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import type { PlanStore, StoredPlan } from '../../store/plans.ts'
import {
  CASE_ID,
  SECRET,
  STRANGER_ID,
  USER_ID,
  fakePartners,
  fakeSessions,
  fakeStore,
  fakeUploads,
  tokenFor,
} from '../../testing.ts'
import { hashPlanToken, PLAN_LINK_TTL_MS } from './index.ts'
import { savedPlanCard } from '@shared/db/saved-plans.ts'
import { homeRoutes } from '@shared/domain/market/routes.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })
const NOW = Date.parse('2026-11-09T12:00:00Z')

type Claim = { planId: string; caseId: string; participantId: string; plan: MarketPlan }

/** An in-memory `PlanStore`. Rows are keyed by token hash. */
function fakePlans(init: { savedToday?: number; withPlan?: string[] } = {}) {
  const rows = new Map<string, StoredPlan & { tokenHash: string }>()
  const claims: Claim[] = []
  const withPlan = new Set(init.withPlan ?? [])
  let next = 0
  const store: PlanStore = {
    save: ({ plan, client, tokenHash, expiresAt }) => {
      next += 1
      const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`
      rows.set(tokenHash, {
        id,
        tokenHash,
        title: plan.title,
        document: JSON.parse(JSON.stringify(plan)) as unknown,
        client,
        createdAt: new Date(NOW).toISOString(),
        expiresAt,
        claimedAt: null,
        claimedBy: null,
        caseId: null,
      })
      return Promise.resolve({ id })
    },
    sweep: () => Promise.resolve(0),
    savedSince: () => Promise.resolve(init.savedToday ?? 0),
    findByTokenHash: (hash) => Promise.resolve(rows.get(hash) ?? null),
    caseHasPlan: (caseId) => Promise.resolve(withPlan.has(caseId)),
    claimedPlan: () => Promise.resolve(null),
    markClaimed: ({ planId, userId, caseId }) => {
      const row = [...rows.values()].find((candidate) => candidate.id === planId)
      if (row === undefined || row.claimedAt !== null) return Promise.resolve(false)
      if (Date.parse(row.expiresAt) <= NOW) return Promise.resolve(false)
      rows.set(row.tokenHash, {
        ...row,
        claimedAt: new Date(NOW).toISOString(),
        claimedBy: userId,
        caseId,
      })
      withPlan.add(caseId)
      return Promise.resolve(true)
    },
    recordClaim: (input) => {
      claims.push(input)
      return Promise.resolve({ facts: [] })
    },
  }
  return { store, rows, claims }
}

function appWith(
  options: {
    plans?: ReturnType<typeof fakePlans>
    sessions?: ReturnType<typeof fakeSessions>
    audienceMaxCases?: number
    burst?: { max: number; windowMs: number }
    dailyMax?: number
  } = {},
) {
  const plans = options.plans ?? fakePlans()
  const sessions = options.sessions ?? fakeSessions()
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    sessions,
    partners: fakePartners(),
    uploads: fakeUploads(),
    version: 'test',
    config: { audienceMaxCases: options.audienceMaxCases ?? 50 },
    rateLimit: { max: 1000, windowMs: 60_000 },
    plans: {
      store: plans.store,
      appBaseUrl: 'https://app.saoi.ie/',
      now: () => NOW,
      ...(options.burst === undefined ? {} : { burst: options.burst }),
      ...(options.dailyMax === undefined ? {} : { dailyMax: options.dailyMax }),
    },
  })
  return { app, plans, sessions }
}

type Body = {
  readonly claimUrl?: string
  readonly expiresAt?: string
  readonly caseId?: string
  readonly created?: boolean
  readonly error?: { readonly code: string; readonly message: string }
  readonly [key: string]: unknown
}

async function post(
  app: ReturnType<typeof appWith>['app'],
  path: string,
  body: unknown,
  options: { as?: string | null; headers?: Record<string, string>; raw?: string } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (options.as !== null && options.as !== undefined) {
    headers['Authorization'] = `Bearer ${await tokenFor({ sub: options.as, is_anonymous: true })}`
  }
  const response = await app.request(path, {
    method: 'POST',
    headers,
    body: options.raw ?? JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Body }
}

const save = async (app: ReturnType<typeof appWith>['app'], plan: unknown = exampleMarketPlan()) =>
  post(app, '/api/plans', { plan, client: 'claude' })

const tokenOf = (claimUrl: string): string => claimUrl.split('/?plan=')[1] ?? ''

/** The worked example with a home comparison of one option and these routes. */
const homePlan = (routes: unknown[]) => ({
  ...exampleMarketPlan(),
  comparison: {
    kind: 'home',
    headline: 'At these figures, the deposit and buying costs are in place around July 2028.',
    priceEur: 350_000,
    sortBy: 'five_year_cost',
    sortedBy: '1 option that fits, sorted by cost over the first 5 years, lowest first.',
    filters: [],
    options: [
      {
        lender: 'Bank of Ireland',
        kind: '4-year fixed',
        productName: '4 Year Fixed HVM BER C',
        ratePct: 3.2,
        monthlyEur: 1362.27,
        fiveYearCostEur: 49338.1,
        keysOn: '2028-07',
        confirmed: true,
      },
    ],
    routes,
  },
})

describe('POST /api/plans', () => {
  it('saves without signing in and returns a one-time link and its expiry', async () => {
    const { app, plans } = appWith()
    const saved = await save(app)

    expect(saved.status).toBe(201)
    expect(saved.body['claimUrl']).toMatch(/^https:\/\/app\.saoi\.ie\/\?plan=[A-Za-z0-9_-]{22}$/)
    expect(saved.body['expiresAt']).toBe(new Date(NOW + PLAN_LINK_TTL_MS).toISOString())

    // Only the hash is kept (Invariant 8).
    const token = tokenOf(String(saved.body['claimUrl']))
    expect(plans.rows.has(token)).toBe(false)
    expect(plans.rows.get(hashPlanToken(token))?.client).toBe('claude')
  })

  it('refuses an invalid plan and says where', async () => {
    const { app } = appWith()
    const saved = await save(app, { ...exampleMarketPlan(), goals: [] })
    expect(saved.status).toBe(400)
    expect(saved.body.error?.code).toBe('bad_request')
  })

  it('refuses a body over 64 KiB with 413', async () => {
    const { app } = appWith()
    const huge = JSON.stringify({ plan: exampleMarketPlan(), padding: 'x'.repeat(70 * 1024) })
    const saved = await post(app, '/api/plans', null, {
      raw: huge,
      headers: { 'Content-Length': String(huge.length) },
    })
    expect(saved.status).toBe(413)
  })

  it('limits bursts per address', async () => {
    const { app } = appWith({ burst: { max: 2, windowMs: 60_000 } })
    const from = { headers: { 'CF-Connecting-IP': '203.0.113.9' } }
    const body = { plan: exampleMarketPlan() }
    expect((await post(app, '/api/plans', body, from)).status).toBe(201)
    expect((await post(app, '/api/plans', body, from)).status).toBe(201)
    expect((await post(app, '/api/plans', body, from)).status).toBe(429)
    const elsewhere = { headers: { 'CF-Connecting-IP': '203.0.113.10' } }
    expect((await post(app, '/api/plans', body, elsewhere)).status).toBe(201)
  })

  it('stops saving at the daily ceiling', async () => {
    const { app } = appWith({ plans: fakePlans({ savedToday: 5 }), dailyMax: 5 })
    expect((await save(app)).status).toBe(429)
  })
})

describe('POST /api/plans/preview', () => {
  it('shows a saved comparison without signing in and without spending the link', async () => {
    const { app, plans } = appWith()
    const token = tokenOf(String((await save(app)).body['claimUrl']))

    const shown = await post(app, '/api/plans/preview', { token }, { as: null })
    expect(shown.status).toBe(200)
    expect(shown.body).toMatchObject({ title: 'House deposit by November 2028', comparison: null })
    expect(String(shown.body['figures'])).toMatch(/saved · €\d[\d,]*\/mo/)
    expect(plans.claims).toHaveLength(0)

    // Still claimable afterwards.
    const claimed = await post(app, '/api/plans/claim', { token }, { as: USER_ID })
    expect(claimed.status).toBe(200)
    // Then the preview says it has been opened.
    expect((await post(app, '/api/plans/preview', { token }, { as: null })).status).toBe(409)
  })

  it('carries a home comparison’s first three options', async () => {
    const { app } = appWith()
    const option = {
      lender: 'Bank of Ireland',
      kind: '4-year fixed',
      productName: '4 Year Fixed HVM BER C',
      ratePct: 3.2,
      monthlyEur: 1362.27,
      fiveYearCostEur: 49338.1,
      keysOn: '2028-07',
      confirmed: true,
    }
    const plan = {
      ...exampleMarketPlan(),
      comparison: {
        kind: 'home',
        headline: 'At these figures, the deposit and buying costs are in place around July 2028.',
        priceEur: 350_000,
        sortBy: 'five_year_cost',
        sortedBy: '4 options that fit, sorted by cost over the first 5 years, lowest first.',
        filters: [],
        options: [option, option, option, option],
      },
    }
    const token = tokenOf(String((await save(app, plan)).body['claimUrl']))
    const shown = await post(app, '/api/plans/preview', { token }, { as: null })
    expect(shown.status).toBe(200)
    const comparison = shown.body['comparison'] as { total: number; options: unknown[] }
    expect(comparison.total).toBe(4)
    expect(comparison.options).toHaveLength(3)
    expect(String(shown.body['figures'])).toMatch(/€350k$/)
  })

  it('round-trips a home plan’s routes through the store, the preview and the card', async () => {
    const { app, plans } = appWith()
    const routes = homeRoutes(
      {
        priceEur: 350_000,
        propertyKind: 'second_hand',
        firstTimeBuyer: true,
        incomeEur: 90_000,
        applicants: undefined,
        savedEur: 35_000,
        monthlyEur: 800,
        taxPaidEur: undefined,
        county: 'dublin_city',
        maxLoanEur: 360_000,
        maxLtvPct: 90,
      },
      '2026-11-10',
    )
    expect(routes.length).toBeGreaterThan(3)
    const token = tokenOf(String((await save(app, homePlan(routes))).body['claimUrl']))

    // Stored as sent.
    const stored = plans.rows.get(hashPlanToken(token))?.document as MarketPlan
    expect(stored.comparison?.routes).toEqual(routes)

    // The preview carries every route, in order.
    const shown = await post(app, '/api/plans/preview', { token }, { as: null })
    expect(shown.status).toBe(200)
    expect(shown.body['routes']).toEqual(routes)

    // The claim records the plan with them, and the card built from it shows them.
    expect((await post(app, '/api/plans/claim', { token }, { as: USER_ID })).status).toBe(200)
    const claimed = plans.claims[0]?.plan
    if (claimed === undefined) throw new Error('not claimed')
    expect(claimed.comparison?.routes).toEqual(routes)
    const card = savedPlanCard({ id: 'plan-1', plan: claimed })
    expect(card.type === 'saved_plan' && card.routes).toEqual(routes)
  })

  it('still loads a home plan stored before routes, with none', async () => {
    const { app, plans } = appWith()
    const token = tokenOf(String((await save(app, homePlan([]))).body['claimUrl']))
    const row = plans.rows.get(hashPlanToken(token))
    if (row === undefined) throw new Error('not saved')
    const document = row.document as { comparison: Record<string, unknown> }
    const comparison = { ...document.comparison }
    delete comparison['routes']
    plans.rows.set(row.tokenHash, { ...row, document: { ...document, comparison } })

    const shown = await post(app, '/api/plans/preview', { token }, { as: null })
    expect(shown.status).toBe(200)
    expect(shown.body['routes']).toEqual([])
    expect((await post(app, '/api/plans/claim', { token }, { as: USER_ID })).status).toBe(200)
    expect(plans.claims[0]?.plan.comparison?.routes).toEqual([])
  })

  it('answers an unknown link with 404', async () => {
    const { app } = appWith()
    expect(
      (await post(app, '/api/plans/preview', { token: 'A'.repeat(22) }, { as: null })).status,
    ).toBe(404)
  })
})

describe('POST /api/plans/claim', () => {
  it('needs a session', async () => {
    const { app } = appWith()
    const claimed = await post(app, '/api/plans/claim', { token: 'A'.repeat(22) }, { as: null })
    expect(claimed.status).toBe(401)
  })

  it('opens the plan in a new conversation when the current one has substance', async () => {
    const sessions = fakeSessions({
      substance: { [CASE_ID]: { customerMessages: 3, facts: 2, applications: 0, plans: 0 } },
    })
    const { app, plans } = appWith({ sessions })
    const token = tokenOf(String((await save(app)).body['claimUrl']))

    const claimed = await post(app, '/api/plans/claim', { token }, { as: USER_ID })

    expect(claimed.status).toBe(200)
    expect(claimed.body).toMatchObject({
      caseId: 'created-case-1',
      created: true,
      planTitle: 'House deposit by November 2028',
      reopened: false,
    })
    expect(sessions.created).toEqual([{ userId: USER_ID, mode: 'new', source: 'plan' }])
    expect(plans.claims).toHaveLength(1)
    expect(plans.claims[0]).toMatchObject({
      caseId: 'created-case-1',
      participantId: 'created-participant-1',
    })
    expect(plans.rows.get(hashPlanToken(token))?.claimedBy).toBe(USER_ID)
  })

  it('uses the current conversation when nothing has happened in it yet', async () => {
    const { app, sessions, plans } = appWith()
    const token = tokenOf(String((await save(app)).body['claimUrl']))

    const claimed = await post(app, '/api/plans/claim', { token }, { as: USER_ID })

    expect(claimed.status).toBe(200)
    expect(claimed.body).toMatchObject({ caseId: CASE_ID, created: false })
    expect(sessions.created).toEqual([])
    expect(plans.claims[0]?.caseId).toBe(CASE_ID)
  })

  it('does not put a second plan into a conversation that already has one', async () => {
    const { app, sessions } = appWith({ plans: fakePlans({ withPlan: [CASE_ID] }) })
    const token = tokenOf(String((await save(app)).body['claimUrl']))
    const claimed = await post(app, '/api/plans/claim', { token }, { as: USER_ID })
    expect(claimed.body['caseId']).toBe('created-case-1')
    expect(sessions.created).toHaveLength(1)
  })

  it('gives a visitor with no conversation a new one', async () => {
    const { app } = appWith({ sessions: fakeSessions({ seats: [] }) })
    const token = tokenOf(String((await save(app)).body['claimUrl']))
    const claimed = await post(app, '/api/plans/claim', { token }, { as: STRANGER_ID })
    expect(claimed.status).toBe(200)
    expect(claimed.body['created']).toBe(true)
  })

  it('lands the same browser in the same conversation when it opens the link again', async () => {
    const { app, plans } = appWith()
    const token = tokenOf(String((await save(app)).body['claimUrl']))
    const first = await post(app, '/api/plans/claim', { token }, { as: USER_ID })
    const again = await post(app, '/api/plans/claim', { token }, { as: USER_ID })

    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ caseId: first.body['caseId'], reopened: true })
    expect(plans.claims).toHaveLength(1)
  })

  it('refuses a second browser: the link is spent', async () => {
    const { app } = appWith({
      sessions: fakeSessions({
        seats: [
          {
            userId: USER_ID,
            participantId: 'participant-primary',
            caseId: CASE_ID,
            role: 'primary',
          },
        ],
      }),
    })
    const token = tokenOf(String((await save(app)).body['claimUrl']))
    expect((await post(app, '/api/plans/claim', { token }, { as: USER_ID })).status).toBe(200)

    const second = await post(app, '/api/plans/claim', { token }, { as: STRANGER_ID })
    expect(second.status).toBe(409)
    expect(second.body.error?.code).toBe('conflict')
    expect(second.body.error?.message).toMatch(/already been opened/)
  })

  it('refuses an expired link with 410 and spends nothing', async () => {
    const plans = fakePlans()
    const { app } = appWith({ plans })
    const token = tokenOf(String((await save(app)).body['claimUrl']))
    const row = plans.rows.get(hashPlanToken(token))
    if (row === undefined) throw new Error('not saved')
    plans.rows.set(row.tokenHash, { ...row, expiresAt: new Date(NOW - 1).toISOString() })

    const claimed = await post(app, '/api/plans/claim', { token }, { as: USER_ID })
    expect(claimed.status).toBe(410)
    expect(claimed.body.error?.code).toBe('expired')
    expect(plans.claims).toHaveLength(0)
  })

  it('refuses a link nobody issued with 404', async () => {
    const { app } = appWith()
    const claimed = await post(app, '/api/plans/claim', { token: 'B'.repeat(22) }, { as: USER_ID })
    expect(claimed.status).toBe(404)
    expect(claimed.body.error?.code).toBe('not_found')
  })

  it('refuses a malformed token before looking anything up', async () => {
    const { app } = appWith()
    const claimed = await post(app, '/api/plans/claim', { token: '../etc' }, { as: USER_ID })
    expect(claimed.status).toBe(400)
  })

  it('keeps the link usable when the day’s conversations are used up', async () => {
    const sessions = fakeSessions({
      casesToday: 50,
      substance: { [CASE_ID]: { customerMessages: 1, facts: 0, applications: 0, plans: 0 } },
    })
    const { app, plans } = appWith({ sessions, audienceMaxCases: 50 })
    const token = tokenOf(String((await save(app)).body['claimUrl']))

    const claimed = await post(app, '/api/plans/claim', { token }, { as: USER_ID })
    expect(claimed.status).toBe(429)
    expect(plans.rows.get(hashPlanToken(token))?.claimedAt).toBeNull()
  })
})
