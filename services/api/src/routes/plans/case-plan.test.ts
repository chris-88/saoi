import { describe, expect, it } from 'vitest'
// The app first: it loads @hono/zod-openapi, which has to extend zod before any shared schema
// is built.
import { createApp } from '../../app.ts'
import type { Reminder } from '@shared/contracts/alerts.ts'
import { casePlanEditedSchema, casePlanSchema } from '@shared/contracts/case-plan.ts'
import type { Holding } from '@shared/contracts/holdings.ts'
import { buildPlanRequestSchema } from '@shared/contracts/market-tools.ts'
import type { MarketPlan } from '@shared/contracts/market-plan.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import type { ClaimedPlan } from '@shared/db/saved-plans.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { buildPlan } from '@shared/domain/market/plan.ts'
import { createLogger } from '../../log.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import { CASE_ID, OTHER_CASE_ID, SECRET, fakeStore, fakeStores, tokenFor } from '../../testing.ts'

/**
 * The plan in the profile (2026-11-12, "6. The saving months"): read it, change a figure, and
 * the plan is rebuilt, the reminders move with its dates and `plan_edited` says what it does.
 * On the experience's worked example: €110,000 between two, €32,000 saved, €1,500 a month, a
 * €400,000 new build by June 2028.
 */

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })
const NOW = Date.parse('2026-11-20T10:00:00Z')
const market = normaliseMarket(MARKET_FIXTURE)

const PLAN: MarketPlan = buildPlan(
  market,
  buildPlanRequestSchema.parse({
    situation: {
      income: { annualGross: 110_000 },
      monthlySaving: 1_500,
      savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
      firstTimeBuyer: true,
    },
    goals: [{ id: 'home', kind: 'house_deposit', label: 'Buying a home', targetDate: '2028-06' }],
    homePrice: 400_000,
    propertyKind: 'new_build',
    buyingTogether: true,
    homePreferences: { sortBy: 'monthly_repayment' },
  }),
  '2026-11-12',
  '2026-11-12T09:00:00.000Z',
).plan

const reminderAt = (id: string, dueOn: string): Reminder => ({
  id,
  kind: 'other',
  label: 'Keys',
  dueOn,
  productId: null,
  createdAt: '2026-11-12T09:00:00.000Z',
})

const holding = (reminderId: string | null): Holding => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'deposit',
  label: 'Deposit saved',
  provider: null,
  productId: null,
  balance: 34_000,
  ratePct: null,
  monthlyAmountEur: 1_500,
  fixedUntil: reminderId === null ? null : '2028-06-10',
  notedOn: '2026-11-20',
  source: 'customer',
  reminderId,
  createdAt: '2026-11-12T09:00:00.000Z',
  updatedAt: '2026-11-12T09:00:00.000Z',
})

const REMINDER_KEYS = '00000000-0000-4000-8000-0000000000b1'
const REMINDER_HELD = '00000000-0000-4000-8000-0000000000b2'

function fakes(claimed: ClaimedPlan | null) {
  const state = {
    claimed,
    saved: [] as {
      planId: string
      caseId: string
      plan: MarketPlan
      event: Record<string, unknown>
    }[],
    reminders: [reminderAt(REMINDER_KEYS, '2028-06-15'), reminderAt(REMINDER_HELD, '2028-06-10')],
    deleted: [] as string[],
    created: [] as { dueOn: string; label: string }[],
  }
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    ...fakeStores(),
    version: 'test',
    log: createLogger(() => undefined),
    casePlan: {
      plans: {
        claimedPlan: () => Promise.resolve(state.claimed),
        saveEdit: (input) => {
          state.saved.push(input)
          state.claimed = { id: input.planId, plan: input.plan }
          return Promise.resolve()
        },
        saveChoices: () => Promise.resolve(),
      },
      holdings: { list: () => Promise.resolve([holding(REMINDER_HELD)]) },
      reminders: {
        listForCase: () =>
          Promise.resolve({
            alerts: [],
            reminders: state.reminders.filter((r) => !state.deleted.includes(r.id)),
          }),
        deleteReminder: (_caseId, id) => {
          state.deleted.push(id)
          return Promise.resolve(true)
        },
        createReminder: (input) => {
          state.created.push({ dueOn: input.dueOn, label: input.label })
          const reminder = reminderAt(
            `00000000-0000-4000-8000-00000000000${String(state.created.length)}`,
            input.dueOn,
          )
          state.reminders.push(reminder)
          return Promise.resolve(reminder)
        },
      },
      market: () => Promise.resolve(market),
      now: () => NOW,
    },
  })
  return { app, state }
}

const headers = async () => ({
  Authorization: `Bearer ${await tokenFor()}`,
  'Content-Type': 'application/json',
})
const patch = async (app: ReturnType<typeof fakes>['app'], body: unknown, caseId = CASE_ID) =>
  app.request(`/api/cases/${caseId}/plan`, {
    method: 'PATCH',
    headers: await headers(),
    body: JSON.stringify(body),
  })

describe('GET /api/cases/{caseId}/plan', () => {
  it('is 404 when the case has no claimed plan', async () => {
    const { app } = fakes(null)
    const response = await app.request(`/api/cases/${CASE_ID}/plan`, { headers: await headers() })
    expect(response.status).toBe(404)
  })

  it('is 404 for a stranger’s case', async () => {
    const { app } = fakes({ id: 'plan-1', plan: PLAN })
    const response = await app.request(`/api/cases/${OTHER_CASE_ID}/plan`, {
      headers: await headers(),
    })
    expect(response.status).toBe(404)
  })

  it('reads the editable figures, where it stands and the first three options', async () => {
    const { app } = fakes({ id: 'plan-1', plan: PLAN })
    const response = await app.request(`/api/cases/${CASE_ID}/plan`, { headers: await headers() })
    expect(response.status).toBe(200)
    const view = casePlanSchema.parse(await response.json())
    expect(view).toMatchObject({
      planId: 'plan-1',
      title: 'Buying a home by June 2028',
      editable: {
        targetDate: '2028-06',
        homePrice: 400_000,
        monthlySaving: 1_500,
        propertyKind: 'new_build',
        firstTimeBuyer: true,
        buyingTogether: true,
      },
      summary: { keysOn: '2027-09', neededAtKeysEur: 47_000, savedEur: 34_000 },
      updatedAt: '2026-11-12T09:00:00.000Z',
    })
    expect(view.summary.progressLine).toMatch(/^€34,000 of €47,000 saved/)
    expect(view.watched).toHaveLength(3)
    expect(view.watched.map((option) => option.lead)).toEqual(
      PLAN.comparison?.options.slice(0, 3).map((option) => option.lender),
    )
    expect(view.watched[0]?.figure).toMatch(/^€[\d,]+\/mo$/)
  })
})

describe('PATCH /api/cases/{caseId}/plan', () => {
  it('refuses a passed month, a figure not above 0, no figure and an unknown field', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    for (const body of [
      { targetDate: '2026-10' },
      { targetDate: '2028-13' },
      { homePrice: 0 },
      { monthlySaving: -5 },
      {},
      { balance: 3 },
      { propertyKind: 'castle' },
    ]) {
      expect((await patch(app, body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(state.saved).toEqual([])
  })

  it('is 404 without a claimed plan', async () => {
    const { app } = fakes(null)
    expect((await patch(app, { monthlySaving: 1_800 })).status).toBe(404)
  })

  it('moves the keys: rebuilds the plan, says what it does, moves the plan’s reminders', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    const response = await patch(app, { targetDate: '2028-03' })
    expect(response.status).toBe(200)
    const edited = casePlanEditedSchema.parse(await response.json())

    expect(edited.reading).toMatch(
      /^Moving the keys to March 2028 means €[\d,]+ less saved by then at this pace; the 18-month deposits no longer fit, and deposits of up to one year still do\.$/,
    )
    expect(adviceWordsIn(edited.reading)).toEqual([])
    expect(edited.reading).not.toMatch(/\bbetter\b|\bbest\b/i)
    expect(edited.editable.targetDate).toBe('2028-03')
    expect(edited.title).toBe('Buying a home by March 2028')
    expect(edited.updatedAt).toBe(new Date(NOW).toISOString())

    // The rebuilt plan is stored as the claimed plan's document, and the event says what changed.
    expect(state.saved).toHaveLength(1)
    const [saved] = state.saved
    expect(saved?.plan.goals[0]?.targetDate).toBe('2028-03')
    expect(saved?.event).toMatchObject({
      planId: 'plan-1',
      changes: [{ field: 'targetDate', from: '2028-06', to: '2028-03' }],
      effects: {
        keysOn: { from: '2027-09', to: '2027-09' },
        neededAtKeysEur: { from: 47_000, to: 47_000 },
        nowFit: [],
        noLongerFit: ['18-month deposits'],
      },
      reading: edited.reading,
      previous: PLAN,
    })

    // The keys reminder moved to the same day of the new month; the holding's stayed.
    expect(state.deleted).toEqual([REMINDER_KEYS])
    expect(state.created).toEqual([{ dueOn: '2028-03-15', label: 'Keys' }])
    expect(saved?.event['reminders']).toEqual([
      {
        from: REMINDER_KEYS,
        to: expect.any(String) as unknown,
        dueOn: { from: '2028-06-15', to: '2028-03-15' },
      },
    ])
  })

  it('raises the monthly saving: the comparison re-runs on the new figures', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    const edited = casePlanEditedSchema.parse(
      await (await patch(app, { monthlySaving: 2_000 })).json(),
    )
    expect(edited.reading).toMatch(
      /^Raising the monthly saving to €2,000 means €[\d,]+ more saved by June 2028 and the keys month moves from September 2027 to [A-Z][a-z]+ 2027\.$/,
    )
    expect(edited.editable.monthlySaving).toBe(2_000)
    const rebuilt = state.saved[0]?.plan
    expect(rebuilt?.comparison?.options.map((option) => option.keysOn)).not.toEqual(
      PLAN.comparison?.options.map((option) => option.keysOn),
    )
    // No reminder came from a date that moved.
    expect(state.created).toEqual([])
  })

  it('changes each editable field', async () => {
    const cases = [
      [{ homePrice: 450_000 }, { homePrice: 450_000 }],
      [{ propertyKind: 'second_hand' }, { propertyKind: 'second_hand' }],
      [{ firstTimeBuyer: false }, { firstTimeBuyer: false }],
      [{ buyingTogether: false }, { buyingTogether: false }],
    ] as const
    for (const [body, expected] of cases) {
      const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
      const edited = casePlanEditedSchema.parse(await (await patch(app, body)).json())
      expect(edited.editable, JSON.stringify(body)).toMatchObject(expected)
      expect(adviceWordsIn(edited.reading)).toEqual([])
      expect(state.saved[0]?.event['changes']).toEqual([
        {
          field: Object.keys(body)[0],
          from: expect.anything() as unknown,
          to: Object.values(body)[0] as unknown,
        },
      ])
    }
  })

  it('writes nothing when the figures are what the plan holds', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    const edited = casePlanEditedSchema.parse(
      await (await patch(app, { monthlySaving: 1_500 })).json(),
    )
    expect(edited.reading).toBe('Nothing changed: the plan already has these figures.')
    expect(state.saved).toEqual([])
  })

  it('refuses a price on a plan that is not for a home', async () => {
    const savingsOnly: MarketPlan = {
      ...PLAN,
      goals: [{ id: 'rainy', kind: 'emergency_fund', label: 'Rainy-day money' }],
      combination: { ...PLAN.combination, products: [] },
    }
    const { app } = fakes({ id: 'plan-2', plan: savingsOnly })
    expect((await patch(app, { homePrice: 300_000 })).status).toBe(400)
  })
})
