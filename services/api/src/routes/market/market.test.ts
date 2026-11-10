import { describe, expect, it } from 'vitest'
// The app first: it loads @hono/zod-openapi, which has to extend zod before any shared schema
// is built, or the routes' `.openapi()` calls find nothing.
import { createApp } from '../../app.ts'
import { marketPlanSchema } from '@shared/contracts/market-plan.ts'
import {
  buildPlanResponseSchema,
  moneyCheckResponseSchema,
  productDetailSchema,
  searchResponseSchema,
} from '@shared/contracts/market-tools.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import { cachedMarketStore } from '../../store/market.ts'
import { SECRET, fakePartners, fakeSessions, fakeStore, fakeUploads } from '../../testing.ts'
import type { CalculatorRun } from '@shared/domain/market/run-bands.ts'
import type { CalculatorRunStore } from '../../store/calculator-runs.ts'
import type { PlanStore } from '../../store/plans.ts'
import { hashPlanToken, PLAN_LINK_TTL_MS } from '../plans/index.ts'
import { MARKET_MAX_BODY_BYTES, dublinDate } from './index.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })
const NOW = Date.parse('2026-11-09T12:00:00Z')

type Held = { tokenHash: string; expiresAt: string; client: string | null }

/** An in-memory draft store: what build-plan holds, and how often it swept. */
function fakeDrafts(init: { heldToday?: number; failing?: boolean } = {}) {
  const held: Held[] = []
  const sweeps = { count: 0 }
  const store: PlanStore = {
    save: ({ tokenHash, expiresAt, client }) => {
      if (init.failing === true) return Promise.reject(new Error('database down'))
      held.push({ tokenHash, expiresAt, client })
      return Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' })
    },
    sweep: () => {
      sweeps.count += 1
      return Promise.resolve(0)
    },
    savedSince: () => Promise.resolve(init.heldToday ?? 0),
    findByTokenHash: () => Promise.resolve(null),
    caseHasPlan: () => Promise.resolve(false),
    markClaimed: () => Promise.resolve(false),
    recordClaim: () => Promise.resolve({ facts: [] }),
  }
  return { store, held, sweeps }
}

function appWith(
  options: {
    burst?: { max: number; windowMs: number }
    loads?: { count: number }
    drafts?: ReturnType<typeof fakeDrafts>
    draftBurst?: { max: number; windowMs: number }
    runs?: CalculatorRunStore
  } = {},
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
      ...(options.runs === undefined ? {} : { runs: options.runs }),
      ...(options.burst === undefined ? {} : { burst: options.burst }),
      ...(options.drafts === undefined
        ? {}
        : {
            drafts: {
              store: options.drafts.store,
              appBaseUrl: 'https://app.saoi.ie',
              ...(options.draftBurst === undefined ? {} : { burst: options.draftBurst }),
            },
          }),
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
    expect(earnings.text).toMatch(/earns nothing today/)
    expect(earnings.text).not.toMatch(/referral fees from providers/)
    expect(earnings.text).toMatch(/Competition and Consumer Protection Commission/)
  })

  it('answer the home calculator with figures, questions and the warnings, and no products', async () => {
    const { app } = appWith()
    const res = await app.request('/api/calc/home', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        depositSavedEur: 20_000,
        monthlySavingEur: 1_000,
        annualGrossIncomeEur: 90_000,
        targetPriceEur: 350_000,
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      figures: { maxLoanEur: number; neededAtKeysEur: number }
      questions: { key: string }[]
      warnings: string[]
      statement: string
    }
    expect(body.figures.maxLoanEur).toBe(360_000)
    expect(body.figures.neededAtKeysEur).toBe(41_500)
    expect(body.questions.map((q) => q.key)).toContain('targetDate')
    expect(body.warnings).toHaveLength(3)
    expect(body.statement).toMatch(/not regulated by the Central Bank of Ireland/)
    expect(JSON.stringify(body)).not.toMatch(/"recommendation"/)
  })

  it('record one anonymous, banded row per home-calculator run, with no figures', async () => {
    const recorded: CalculatorRun[] = []
    const runs: CalculatorRunStore = {
      record: (run) => {
        recorded.push(run)
        return Promise.resolve()
      },
    }
    const { app } = appWith({ runs })
    const res = await post(app, '/api/calc/home', {
      depositSavedEur: 30_000,
      monthlySavingEur: 1_000,
      annualGrossIncomeEur: 60_000,
      secondIncomeEur: 40_000,
      targetPriceEur: 400_000,
      targetDate: '2028-06',
      monthlyRentEur: 1_800,
      county: 'fingal',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { routes: { id: string }[] }
    expect(body.routes).toHaveLength(6)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(recorded).toEqual([
      {
        ran_on: dublinDate(NOW),
        kind: 'home',
        income_band: '100-150k',
        gap_months_band: '13-24',
        target_met: true,
        county: 'fingal',
        rent_band: '1500-2000',
        property_kind: null,
        first_time_buyer: null,
      },
    ])
    expect(JSON.stringify(recorded)).not.toMatch(/30000|1000|60000|40000|400000|1800|203\.0\.113/)
  })

  it('answer the home calculator even when the run cannot be recorded', async () => {
    const { app } = appWith({ runs: { record: () => Promise.reject(new Error('database down')) } })
    const res = await post(app, '/api/calc/home', { annualGrossIncomeEur: 70_000 })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  it('record nothing for build-plan', async () => {
    const recorded: CalculatorRun[] = []
    const { app } = appWith({
      runs: {
        record: (run) => {
          recorded.push(run)
          return Promise.resolve()
        },
      },
    })
    const res = await post(app, '/api/calc/build-plan', { situation, goals })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(recorded).toEqual([])
  })

  it('build the worked example’s plan, which the plan contract accepts', async () => {
    const { app } = appWith()
    const response = await post(app, '/api/calc/build-plan', { situation, goals })
    expect(response.status).toBe(200)
    const body = buildPlanResponseSchema.parse(await response.json())
    expect(() => marketPlanSchema.parse(body.plan)).not.toThrow()
    expect(body.plan.createdAt).toBe(new Date(NOW).toISOString())
  })

  it('hold each plan as a 24-hour draft behind a single-use link, hashed at rest', async () => {
    const drafts = fakeDrafts()
    const { app } = appWith({ drafts })
    const body = buildPlanResponseSchema.parse(
      await (await post(app, '/api/calc/build-plan', { situation, goals })).json(),
    )
    expect(body.saveLink?.url).toMatch(/^https:\/\/app\.saoi\.ie\/\?plan=[A-Za-z0-9_-]{22}$/)
    expect(body.saveLink?.expiresAt).toBe(new Date(NOW + PLAN_LINK_TTL_MS).toISOString())
    const token = body.saveLink?.url.split('?plan=').at(-1) ?? ''
    expect(drafts.held).toEqual([
      { tokenHash: hashPlanToken(token), expiresAt: body.saveLink?.expiresAt, client: 'draft' },
    ])
    expect(JSON.stringify(drafts.held)).not.toContain(token)
    expect(drafts.sweeps.count).toBe(1)
    expect(body.presentation.join('\n')).toContain(
      `Save this comparison to the Saoi app: ${body.saveLink?.url ?? ''}`,
    )
    expect(body.presentation.at(-1)).toMatch(/^Answer this one and the plan gets sharper: /)
    expect(body.presentation.at(-3)).toMatch(/the customer decides/)
  })

  it('hold one draft and give one link, however many alternatives are asked for', async () => {
    const drafts = fakeDrafts()
    const { app } = appWith({ drafts })
    const body = buildPlanResponseSchema.parse(
      await (
        await post(app, '/api/calc/build-plan', {
          situation,
          goals,
          alternatives: [
            { name: 'More a month', monthlySaving: 1_000 },
            { name: 'Accessible', keepAccessible: true },
          ],
        })
      ).json(),
    )
    expect(body.alternatives).toHaveLength(2)
    expect(drafts.held).toHaveLength(1)
    expect(body.presentation.filter((line) => line.includes('/?plan='))).toHaveLength(1)
    expect(JSON.stringify(body.alternatives)).not.toContain('/?plan=')
  })

  it('return the plan without a link when the draft cannot be held', async () => {
    for (const drafts of [fakeDrafts({ heldToday: 10_000 }), fakeDrafts({ failing: true })]) {
      const { app } = appWith({ drafts })
      const response = await post(app, '/api/calc/build-plan', { situation, goals })
      expect(response.status).toBe(200)
      const body = buildPlanResponseSchema.parse(await response.json())
      expect(body.saveLink).toBeNull()
      expect(body.presentation.join(' ')).toMatch(/could not be held just now; saoi_save_plan/)
    }
    const limited = fakeDrafts()
    const { app } = appWith({ drafts: limited, draftBurst: { max: 1, windowMs: 60_000 } })
    await post(app, '/api/calc/build-plan', { situation, goals })
    const second = buildPlanResponseSchema.parse(
      await (await post(app, '/api/calc/build-plan', { situation, goals })).json(),
    )
    expect(second.saveLink).toBeNull()
    expect(limited.held).toHaveLength(1)
  })

  it('answer the money check in one call, with the save link when there is a plan', async () => {
    const drafts = fakeDrafts()
    const { app } = appWith({ drafts })
    const empty = moneyCheckResponseSchema.parse(
      await (await post(app, '/api/calc/money-check', {})).json(),
    )
    expect(empty.plan).toBeNull()
    expect(empty.questions.length).toBeGreaterThan(0)
    expect(drafts.held).toHaveLength(0)
    const full = moneyCheckResponseSchema.parse(
      await (await post(app, '/api/calc/money-check', { situation, goals })).json(),
    )
    expect(full.plan?.saveLink?.url).toMatch(/\?plan=/)
    expect(full.presentation.join('\n')).toContain(
      `Save this comparison to the Saoi app: ${full.plan?.saveLink?.url ?? ''}`,
    )
    expect(drafts.held).toHaveLength(1)
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
    // build-plan takes the calculator's county and rent, and returns its routes.
    const shaped = doc as unknown as BuildPlanDoc
    const buildPlan = shaped.paths['/api/calc/build-plan']?.post
    const requestProps = resolve(
      shaped,
      buildPlan?.requestBody?.content['application/json']?.schema,
    )?.properties
    expect(Object.keys(requestProps ?? {})).toEqual(
      expect.arrayContaining(['county', 'monthlyRentEur', 'homePrice', 'propertyKind']),
    )
    const result = resolve(shaped, buildPlan?.responses['200']?.content['application/json']?.schema)
    expect(Object.keys(result?.properties ?? {})).toContain('routes')
    expect(doc.paths['/api/market/about/{topic}']?.['get']).toBeDefined()
  })

  it('date the figures in Dublin', () => {
    expect(dublinDate(Date.parse('2026-12-31T23:30:00Z'))).toBe('2026-12-31')
    expect(dublinDate(Date.parse('2026-06-30T23:30:00Z'))).toBe('2026-07-01')
  })
})

type SchemaNode = { $ref?: string; properties?: Record<string, SchemaNode> }
type BuildPlanDoc = {
  paths: Record<
    string,
    {
      post?: {
        requestBody?: { content: Record<string, { schema?: SchemaNode }> }
        responses: Record<string, { content: Record<string, { schema?: SchemaNode }> }>
      }
    }
  >
  components?: { schemas?: Record<string, SchemaNode> }
}

/** A schema node, following one `$ref` into the components. */
function resolve(doc: BuildPlanDoc, node: SchemaNode | undefined): SchemaNode | undefined {
  if (node?.$ref === undefined) return node
  return doc.components?.schemas?.[node.$ref.replace('#/components/schemas/', '')]
}
