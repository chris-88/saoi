import { describe, expect, it } from 'vitest'
// The app first: it loads @hono/zod-openapi, which has to extend zod before any shared schema
// is built.
import { createApp } from '../../app.ts'
import type { Reminder } from '@shared/contracts/alerts.ts'
import { casePlanEditedSchema, casePlanSchema } from '@shared/contracts/case-plan.ts'
import { buildPlanRequestSchema } from '@shared/contracts/market-tools.ts'
import type { MarketPlan } from '@shared/contracts/market-plan.ts'
import type { ClaimedPlan } from '@shared/db/saved-plans.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { buildPlan } from '@shared/domain/market/plan.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import { createLogger } from '../../log.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import type { ChoiceInputs } from '../../store/plans.ts'
import { CASE_ID, OTHER_CASE_ID, SECRET, fakeStore, fakeStores, tokenFor } from '../../testing.ts'

/**
 * The customer's choices for the plan (Chris, 2026-11-13: "the goal is to get the customer to
 * pick products from the product lists we're presenting"): a tap on a card commits one for the
 * lump sum, the monthly saving or the mortgage; only the row id is sent and the row is rebuilt
 * from the market. On the experience's worked example: €110,000 between two, €32,000 saved,
 * €1,500 a month, a €400,000 new build by June 2028.
 */

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })
const NOW = Date.parse('2026-11-13T10:00:00Z')
const market = normaliseMarket(MARKET_FIXTURE)
const BUNQ = 'bunq:savings.bunq_savings'
const SUPERSAVER = 'boi:savings.supersaver'
const BOI_FIXED = 'boi:savings.advantage_fixed'
const MORTGAGE = 'aib:mortgage.c2039'

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

type Saved = {
  planId: string
  caseId: string
  plan: MarketPlan
  event: { type: string; payload: Record<string, unknown> }
}

function fakes(claimed: ClaimedPlan | null, inputs?: ChoiceInputs) {
  const state = {
    claimed,
    saved: [] as Saved[],
    edits: [] as { plan: MarketPlan; event: Record<string, unknown> }[],
    reminders: [] as Reminder[],
    deleted: [] as string[],
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
          state.edits.push(input)
          state.claimed = { id: input.planId, plan: input.plan }
          return Promise.resolve()
        },
        saveChoices: (input) => {
          state.saved.push(input)
          state.claimed = { id: input.planId, plan: input.plan }
          return Promise.resolve()
        },
        ...(inputs === undefined ? {} : { choiceInputs: () => Promise.resolve(inputs) }),
      },
      holdings: { list: () => Promise.resolve([]) },
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
          const reminder: Reminder = {
            id: `00000000-0000-4000-8000-0000000000${String(10 + state.reminders.length)}`,
            kind: input.kind,
            label: input.label,
            dueOn: input.dueOn,
            productId: input.productId ?? null,
            createdAt: new Date(NOW).toISOString(),
          }
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
type App = ReturnType<typeof fakes>['app']
const choose = async (app: App, body: unknown, caseId = CASE_ID) =>
  app.request(`/api/cases/${caseId}/plan/choices`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(body),
  })
const remove = async (app: App, slot: string) =>
  app.request(`/api/cases/${CASE_ID}/plan/choices/${slot}`, {
    method: 'DELETE',
    headers: await headers(),
  })

describe('POST /api/cases/{caseId}/plan/choices', () => {
  it('commits bunq for the lump sum, rebuilt from the market, with a reminder for its bonus’s end', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    const response = await choose(app, { slot: 'lump_sum', rowId: BUNQ })
    expect(response.status).toBe(200)
    const view = casePlanSchema.parse(await response.json())
    expect(view.choices).toEqual({
      lump_sum: {
        slot: 'lump_sum',
        rowId: BUNQ,
        lead: 'bunq Savings Account',
        providerId: 'bunq',
        kind: 'instant access',
        value: '3.11% to 1 Jan',
        figure: 'keys Sep 2027, €409',
        chosenAt: '2026-11-13T10:00:00.000Z',
        endsOn: '2027-01-01',
      },
      monthly_saving: null,
      mortgage: null,
    })
    expect(view.updatedAt).toBe('2026-11-13T10:00:00.000Z')
    // What the customer sees carries no reminder id and no market rows.
    expect(JSON.stringify(view)).not.toMatch(/reminderId|watches/)

    // The reminder for the end of the bonus.
    expect(state.reminders).toEqual([
      expect.objectContaining({
        kind: 'other',
        label: 'bunq Savings Account: bonus rate ends',
        dueOn: '2027-01-01',
        productId: BUNQ,
      }),
    ])

    // Stored with the plan, the reminder and the rows the alerts watch; the event for the turn.
    expect(state.saved).toHaveLength(1)
    const [saved] = state.saved
    expect(saved?.plan.choices?.lump_sum).toMatchObject({
      reminderId: state.reminders[0]?.id,
      watches: [{ provider: 'bunq', source: 'bank', productId: 'savings.bunq_savings' }],
    })
    expect(saved?.event).toEqual({
      type: 'product_chosen',
      payload: {
        planId: 'plan-1',
        slot: 'lump_sum',
        rowId: BUNQ,
        lead: 'bunq Savings Account',
        reminder: { id: state.reminders[0]?.id, dueOn: '2027-01-01' },
        next: {
          slot: 'monthly_saving',
          question: 'Which account is the one for your €1,500 a month?',
        },
      },
    })
  })

  it('never takes the row’s words from the client', async () => {
    const { app } = fakes({ id: 'plan-1', plan: PLAN })
    const response = await choose(app, {
      slot: 'lump_sum',
      rowId: BUNQ,
      lead: 'The best account',
    })
    expect(response.status).toBe(400)
  })

  it('replaces a choice: the earlier reminder goes, and the event names what it replaced', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    await choose(app, { slot: 'lump_sum', rowId: BUNQ })
    const first = state.reminders[0]?.id
    const response = await choose(app, { slot: 'lump_sum', rowId: BOI_FIXED })
    expect(response.status).toBe(200)
    const view = casePlanSchema.parse(await response.json())
    expect(view.choices.lump_sum).toMatchObject({
      rowId: BOI_FIXED,
      lead: 'Bank of Ireland Advantage Fixed Term Deposit Account',
      kind: '6-month fixed',
      endsOn: '2027-05-13',
    })
    expect(state.deleted).toEqual([first])
    expect(state.reminders.at(-1)).toMatchObject({ kind: 'deposit_matures', dueOn: '2027-05-13' })
    expect(state.saved[1]?.event.payload).toMatchObject({
      replaced: BUNQ,
      replacedLead: 'bunq Savings Account',
    })
  })

  it('writes nothing when the row is already the choice', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    await choose(app, { slot: 'lump_sum', rowId: BUNQ })
    const again = await choose(app, { slot: 'lump_sum', rowId: BUNQ })
    expect(again.status).toBe(200)
    expect(state.saved).toHaveLength(1)
    expect(state.reminders).toHaveLength(1)
  })

  it('commits a mortgage option from the plan’s comparison by its row id', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    const response = await choose(app, { slot: 'mortgage', rowId: MORTGAGE })
    expect(response.status).toBe(200)
    const view = casePlanSchema.parse(await response.json())
    expect(view.watched[0]?.rowId).toBe(MORTGAGE)
    expect(view.choices.mortgage).toMatchObject({
      rowId: MORTGAGE,
      lead: 'AIB Higher Value 4 Year Fixed Rate, LTV Greater than 80%',
      kind: '4-year fixed at 3.25%',
      value: '€1,567/mo',
      figure: '€58,612 over 5 years',
      endsOn: '2031-09-01',
    })
    expect(state.reminders[0]).toMatchObject({ kind: 'fixed_rate_ends', dueOn: '2031-09-01' })
  })

  it('says what the plan now does when the last part is chosen', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    await choose(app, { slot: 'lump_sum', rowId: BUNQ })
    await choose(app, { slot: 'monthly_saving', rowId: SUPERSAVER })
    expect(state.saved[1]?.event.payload['allChosenLine']).toBeUndefined()
    await choose(app, { slot: 'mortgage', rowId: MORTGAGE })
    const payload = state.saved[2]?.event.payload ?? {}
    expect(payload['next']).toBeNull()
    expect(payload['allChosenLine']).toMatch(/^Every part of the plan is chosen: bunq Savings/)
    expect(adviceWordsIn(String(payload['allChosenLine']))).toEqual([])
  })

  it('refuses a part that is not one, a malformed id, an unknown row and the wrong kind', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    expect((await choose(app, { slot: 'pension', rowId: BUNQ })).status).toBe(400)
    expect((await choose(app, { slot: 'lump_sum', rowId: 'bunq <b>' })).status).toBe(400)
    expect((await choose(app, { slot: 'lump_sum' })).status).toBe(400)
    const unknown = await choose(app, { slot: 'lump_sum', rowId: 'nope:savings.nothing' })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect((await choose(app, { slot: 'lump_sum', rowId: MORTGAGE })).status).toBe(400)
    expect((await choose(app, { slot: 'mortgage', rowId: BUNQ })).status).toBe(400)
    expect((await choose(app, { slot: 'monthly_saving', rowId: BOI_FIXED })).status).toBe(400)
    // The app's Choose sheet shows the message inline: a fact with the product and their figure.
    const regular = await choose(app, { slot: 'lump_sum', rowId: SUPERSAVER })
    expect(regular.status).toBe(400)
    expect(await regular.json()).toMatchObject({
      ok: false,
      error: {
        code: 'bad_request',
        message:
          'Bank of Ireland SuperSaver Account takes monthly payments only, so it cannot hold the €32,000.',
      },
    })
    expect(state.saved).toEqual([])
    expect(state.reminders).toEqual([])
  })

  it('is 404 without a claimed plan, and for a stranger’s case', async () => {
    const { app } = fakes(null)
    expect((await choose(app, { slot: 'lump_sum', rowId: BUNQ })).status).toBe(404)
    const { app: other } = fakes({ id: 'plan-1', plan: PLAN })
    expect((await choose(other, { slot: 'lump_sum', rowId: BUNQ }, OTHER_CASE_ID)).status).toBe(404)
  })

  it('reads the row off the card the case was shown', async () => {
    const { app } = fakes(
      { id: 'plan-1', plan: PLAN },
      { facts: {}, shown: [{ arrangement: 'by_access' }] },
    )
    const view = casePlanSchema.parse(
      await (await choose(app, { slot: 'lump_sum', rowId: BUNQ })).json(),
    )
    expect(view.choices.lump_sum?.figure).toMatch(/^€[\d,]+ by Sep 2027$/)
  })
})

describe('DELETE /api/cases/{caseId}/plan/choices/{slot}', () => {
  it('opens the part again and removes its reminder', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    await choose(app, { slot: 'lump_sum', rowId: BUNQ })
    const reminder = state.reminders[0]?.id
    const response = await remove(app, 'lump_sum')
    expect(response.status).toBe(200)
    expect(casePlanSchema.parse(await response.json()).choices.lump_sum).toBeNull()
    expect(state.deleted).toEqual([reminder])
    expect(state.saved[1]?.event).toEqual({
      type: 'product_choice_removed',
      payload: {
        planId: 'plan-1',
        slot: 'lump_sum',
        rowId: BUNQ,
        lead: 'bunq Savings Account',
        next: { slot: 'lump_sum', question: 'Which account is the one for your €32,000?' },
      },
    })
  })

  it('writes nothing for a part already open, and refuses one that is not a part', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    expect((await remove(app, 'mortgage')).status).toBe(200)
    expect(state.saved).toEqual([])
    expect((await remove(app, 'pension')).status).toBe(400)
  })
})

describe('the choices with the rest of the plan', () => {
  it('leaves a choice’s reminder where it is when an edit moves the keys month it falls in', async () => {
    const reminderId = '00000000-0000-4000-8000-0000000000c9'
    const plan: MarketPlan = {
      ...PLAN,
      choices: {
        lump_sum: {
          slot: 'lump_sum',
          rowId: BUNQ,
          lead: 'bunq Savings Account',
          kind: 'instant access',
          value: '3.11% to 1 Jan',
          figure: 'keys Sep 2027, €409',
          chosenAt: '2026-11-13T10:00:00.000Z',
          endsOn: '2027-09-15',
          reminderId,
        },
      },
    }
    const { app, state } = fakes({ id: 'plan-1', plan })
    // A rate end in the keys month (September 2027), of the kind a plan's own date reminder is.
    state.reminders.push({
      id: reminderId,
      kind: 'other',
      label: 'bunq Savings Account: bonus rate ends',
      dueOn: '2027-09-15',
      productId: BUNQ,
      createdAt: '2026-11-13T10:00:00.000Z',
    })
    const response = await app.request(`/api/cases/${CASE_ID}/plan`, {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify({ monthlySaving: 2_000 }),
    })
    expect(response.status).toBe(200)
    const keysOn = (state.edits[0]?.event['effects'] as { keysOn: { from: string; to: string } })
      .keysOn
    expect(keysOn.from).toBe('2027-09')
    expect(keysOn.to).not.toBe('2027-09')
    expect(state.deleted).toEqual([])
  })

  it('are read on GET and kept through an edit', async () => {
    const { app, state } = fakes({ id: 'plan-1', plan: PLAN })
    await choose(app, { slot: 'lump_sum', rowId: BUNQ })
    const read = casePlanSchema.parse(
      await (await app.request(`/api/cases/${CASE_ID}/plan`, { headers: await headers() })).json(),
    )
    expect(read.choices.lump_sum?.rowId).toBe(BUNQ)

    const edited = casePlanEditedSchema.parse(
      await (
        await app.request(`/api/cases/${CASE_ID}/plan`, {
          method: 'PATCH',
          headers: await headers(),
          body: JSON.stringify({ monthlySaving: 1_800 }),
        })
      ).json(),
    )
    expect(edited.choices.lump_sum?.rowId).toBe(BUNQ)
    expect(state.edits[0]?.plan.choices?.lump_sum?.rowId).toBe(BUNQ)
    expect(state.deleted).toEqual([])
  })
})
