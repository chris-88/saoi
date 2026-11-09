import { describe, expect, it } from 'vitest'
// The app first: it loads @hono/zod-openapi, which has to extend zod before any shared schema
// is built, or the routes' `.openapi()` calls find nothing.
import { createApp } from '../../app.ts'
import { marketPlanSchema } from '@shared/contracts/market-plan.ts'
import {
  buildPlanResponseSchema,
  productDetailSchema,
  searchResponseSchema,
} from '@shared/contracts/market-tools.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import { cachedMarketStore } from '../../store/market.ts'
import { SECRET, fakePartners, fakeSessions, fakeStore, fakeUploads } from '../../testing.ts'
import { MARKET_MAX_BODY_BYTES, dublinDate } from './index.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })
const NOW = Date.parse('2026-11-09T12:00:00Z')

function appWith(
  options: { burst?: { max: number; windowMs: number }; loads?: { count: number } } = {},
) {
  const loads = options.loads ?? { count: 0 }
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    sessions: fakeSessions(),
    partners: fakePartners(),
    uploads: fakeUploads(),
    version: 'test',
    rateLimit: { max: 1000, windowMs: 60_000 },
    market: {
      store: cachedMarketStore(
        () => {
          loads.count += 1
          return Promise.resolve(MARKET_FIXTURE)
        },
        { now: () => NOW },
      ),
      now: () => NOW,
      ...(options.burst === undefined ? {} : { burst: options.burst }),
    },
  })
  return { app, loads }
}

const post = (
  app: ReturnType<typeof appWith>['app'],
  path: string,
  body: unknown,
  ip = '203.0.113.7',
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  })

const situation = {
  income: { annualGross: 62_000 },
  outgoings: { rentMonthly: 1_650, otherMonthly: 900 },
  monthlySaving: 800,
  savings: [{ label: 'Current account', balance: 25_000, aerPct: 0, access: 'current_account' }],
  debts: [
    {
      id: 'car-loan',
      label: 'Car loan',
      kind: 'car_finance',
      balance: 9_000,
      ratePct: 9,
      monthlyRepayment: 280,
      monthsRemaining: 36,
    },
  ],
  firstTimeBuyer: true,
}
const goals = [
  {
    id: 'deposit',
    kind: 'house_deposit',
    label: 'House deposit',
    targetAmount: 35_000,
    targetDate: '2028-11',
    priority: 1,
  },
]

describe('public comparison routes', () => {
  it('need no sign-in and rank products', async () => {
    const { app } = appWith()
    const response = await post(app, '/api/market/search', {
      category: 'deposit',
      amount: 25_000,
      horizonMonths: 24,
    })
    expect(response.status).toBe(200)
    const body = searchResponseSchema.parse(await response.json())
    expect(body.results).toHaveLength(5)
    expect(body.ranking.objective).toBe('highest_net_return')
  })

  it('return one product with its history and the source’s words', async () => {
    const { app } = appWith()
    const response = await app.request('/api/market/products/aib:deposit.c3743')
    expect(response.status).toBe(200)
    const body = productDetailSchema.parse(await response.json())
    expect(body.product.id).toBe('aib:deposit.ladder_personal_fixed_term_deposit')
    expect(body.history).toHaveLength(3)
    expect(body.verbatim.length).toBe(3)
    expect((await app.request('/api/market/products/aib:nothing.here')).status).toBe(404)
  })

  it('serve the ranking and earnings texts', async () => {
    const { app } = appWith()
    const ranking = (await (await app.request('/api/market/about/ranking')).json()) as {
      text: string
    }
    expect(ranking.text).toMatch(/never treated as zero/)
    const earnings = (await (await app.request('/api/market/about/earnings')).json()) as {
      text: string
    }
    expect(earnings.text).toMatch(/never changes the ranking/)
    expect(earnings.text).toMatch(/Competition and Consumer Protection Commission/)
  })

  it('build the worked example’s plan, which the plan contract accepts', async () => {
    const { app } = appWith()
    const response = await post(app, '/api/calc/build-plan', { situation, goals })
    expect(response.status).toBe(200)
    const body = buildPlanResponseSchema.parse(await response.json())
    expect(() => marketPlanSchema.parse(body.plan)).not.toThrow()
    expect(body.plan.createdAt).toBe(new Date(NOW).toISOString())
  })

  it('answer review, projection, mortgage and debt', async () => {
    const { app } = appWith()
    const calls: [string, unknown][] = [
      ['/api/calc/review-situation', { situation, goals }],
      [
        '/api/calc/savings-projection',
        { horizonMonths: 24, lumpSum: 16_000, monthly: 1_080, targetAmount: 35_000 },
      ],
      [
        '/api/calc/mortgage',
        {
          mode: 'affordability',
          buyer: 'first_time_buyer',
          annualGrossIncome: 62_000,
          deposit: 43_000,
        },
      ],
      [
        '/api/calc/mortgage',
        {
          mode: 'switch',
          balance: 250_000,
          currentRatePct: 4.5,
          remainingTermYears: 25,
          propertyValue: 400_000,
        },
      ],
      ['/api/calc/debt', { debts: situation.debts, lumpSum: 9_000 }],
    ]
    for (const [path, body] of calls) {
      const response = await post(app, path, body)
      expect(response.status, path).toBe(200)
      expect(JSON.stringify(await response.json()).toLowerCase()).not.toMatch(/you should/)
    }
  })

  it('load the market once and hold it', async () => {
    const loads = { count: 0 }
    const { app } = appWith({ loads })
    await post(app, '/api/market/search', { category: 'loan' })
    await post(app, '/api/market/search', { category: 'savings' })
    expect(loads.count).toBe(1)
  })

  it('refuse an invalid body with the field named', async () => {
    const { app } = appWith()
    const response = await post(app, '/api/market/search', { category: 'pension' })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { details: string[] } }
    expect(body.error.details.join(' ')).toMatch(/category/)
  })

  it('refuse a domain error as the caller’s', async () => {
    const { app } = appWith()
    const response = await post(app, '/api/market/search', {
      category: 'deposit',
      objective: 'lowest_monthly_repayment',
    })
    expect(response.status).toBe(400)
    const unknown = await post(app, '/api/calc/savings-projection', {
      horizonMonths: 12,
      lines: [{ productId: 'x:y.z' }],
    })
    expect(unknown.status).toBe(400)
  })

  it('cap the body size', async () => {
    const { app } = appWith()
    const response = await post(app, '/api/calc/review-situation', {
      situation: { summary: 'x'.repeat(MARKET_MAX_BODY_BYTES) },
    })
    expect(response.status).toBe(413)
  })

  it('limit each address', async () => {
    const { app } = appWith({ burst: { max: 2, windowMs: 60_000 } })
    expect((await post(app, '/api/market/search', { category: 'loan' })).status).toBe(200)
    expect((await post(app, '/api/market/search', { category: 'loan' })).status).toBe(200)
    const third = await post(app, '/api/market/search', { category: 'loan' })
    expect(third.status).toBe(429)
    expect(third.headers.get('Retry-After')).not.toBeNull()
    expect(
      (await post(app, '/api/market/search', { category: 'loan' }, '198.51.100.1')).status,
    ).toBe(200)
  })

  it('appear in the OpenAPI document with descriptions', async () => {
    const { app } = appWith()
    const doc = (await (await app.request('/api/openapi.json')).json()) as {
      paths: Record<string, Record<string, { description?: string; security?: unknown[] }>>
    }
    for (const path of [
      '/api/market/search',
      '/api/calc/review-situation',
      '/api/calc/savings-projection',
      '/api/calc/mortgage',
      '/api/calc/debt',
      '/api/calc/build-plan',
    ]) {
      expect(doc.paths[path]?.['post']?.description, path).toMatch(/Information, not advice/)
      expect(doc.paths[path]?.['post']?.security).toEqual([])
    }
    expect(doc.paths['/api/market/products/{id}']?.['get']).toBeDefined()
    expect(doc.paths['/api/market/about/{topic}']?.['get']).toBeDefined()
  })

  it('date the figures in Dublin', () => {
    expect(dublinDate(Date.parse('2026-12-31T23:30:00Z'))).toBe('2026-12-31')
    expect(dublinDate(Date.parse('2026-06-30T23:30:00Z'))).toBe('2026-07-01')
  })
})
