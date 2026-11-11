import { describe, expect, it } from 'vitest'
// The app first: it loads @hono/zod-openapi, which has to extend zod before any shared schema
// is built.
import { createApp } from '../../app.ts'
import {
  type Holding,
  caseHoldingsResponseSchema,
  holdingSchema,
} from '@shared/contracts/holdings.ts'
import { exampleMarketPlan } from '@shared/contracts/market-plan.example.ts'
import type { ClaimedPlan } from '@shared/db/saved-plans.ts'
import { reminderForHolding } from '@shared/domain/market/holdings.ts'
import { createLogger } from '../../log.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import type { HoldingStore, HoldingWriteContext } from '../../store/holdings.ts'
import { CASE_ID, OTHER_CASE_ID, SECRET, fakeStore, fakeStores, tokenFor } from '../../testing.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })
const NOW = Date.parse('2026-12-11T09:00:00Z')

/**
 * An in-memory holding store that keeps reminders the way the shared helpers do: one per
 * holding with a date, replaced when the date changes, deleted with the holding.
 */
function fakeHoldingStore() {
  const holdings: (Holding & { caseId: string; deleted: boolean })[] = []
  const reminders: { id: string; holdingId: string; dueOn: string; deleted: boolean }[] = []
  const contexts: HoldingWriteContext[] = []
  let seq = 0
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const sync = (holding: Holding & { caseId: string }, today: string): string | null => {
    const wanted = reminderForHolding(holding, today)
    const open = reminders.find((r) => r.id === holding.reminderId && !r.deleted)
    if (open !== undefined && wanted !== null && open.dueOn === wanted.dueOn) return open.id
    if (open !== undefined) open.deleted = true
    if (wanted === null) return null
    const reminder = { id: id(), holdingId: holding.id, dueOn: wanted.dueOn, deleted: false }
    reminders.push(reminder)
    return reminder.id
  }
  const strip = (row: (typeof holdings)[number]): Holding => holdingSchema.parse(row)
  const store: HoldingStore = {
    list: (caseId) =>
      Promise.resolve(holdings.filter((h) => h.caseId === caseId && !h.deleted).map(strip)),
    create: (context, input) => {
      contexts.push(context)
      const at = new Date(NOW).toISOString()
      const holding: (typeof holdings)[number] = {
        id: id(),
        caseId: context.caseId,
        deleted: false,
        kind: input.kind,
        label: input.label,
        provider: input.provider ?? null,
        productId: input.productId ?? null,
        balance: input.balance,
        ratePct: input.ratePct ?? null,
        monthlyAmountEur: input.monthlyAmountEur ?? null,
        fixedUntil: input.fixedUntil ?? null,
        notedOn: input.notedOn,
        source: 'customer',
        reminderId: null,
        createdAt: at,
        updatedAt: at,
      }
      holding.reminderId = sync(holding, context.today)
      holdings.push(holding)
      return Promise.resolve(strip(holding))
    },
    update: (context, holdingId, patch) => {
      const holding = holdings.find(
        (h) => h.id === holdingId && h.caseId === context.caseId && !h.deleted,
      )
      if (holding === undefined) return Promise.resolve(null)
      const balanceChanged = patch.balance !== undefined && patch.balance !== holding.balance
      Object.assign(holding, Object.fromEntries(Object.entries(patch)))
      if (patch.notedOn === undefined && balanceChanged) holding.notedOn = context.today
      holding.reminderId = sync(holding, context.today)
      return Promise.resolve(strip(holding))
    },
    remove: (context, holdingId) => {
      const holding = holdings.find(
        (h) => h.id === holdingId && h.caseId === context.caseId && !h.deleted,
      )
      if (holding === undefined) return Promise.resolve(false)
      holding.deleted = true
      const reminder = reminders.find((r) => r.id === holding.reminderId)
      if (reminder !== undefined) reminder.deleted = true
      return Promise.resolve(true)
    },
  }
  return { store, holdings, reminders, contexts }
}

function appWith(fake: ReturnType<typeof fakeHoldingStore>, claimed: ClaimedPlan | null) {
  return createApp({
    verifyToken,
    store: fakeStore(),
    ...fakeStores(),
    version: 'test',
    log: createLogger(() => undefined),
    holdings: {
      store: fake.store,
      plans: { claimedPlan: () => Promise.resolve(claimed) },
      now: () => NOW,
    },
  })
}

const PLAN: ClaimedPlan = { id: 'plan-1', plan: exampleMarketPlan() }

describe('a case’s holdings', () => {
  const auth = async () => ({
    Authorization: `Bearer ${await tokenFor()}`,
    'Content-Type': 'application/json',
  })

  it('adds, lists with progress, changes and deletes, keeping the reminder in step', async () => {
    const fake = fakeHoldingStore()
    const app = appWith(fake, PLAN)
    const call = async (method: string, path: string, body?: unknown) =>
      app.request(`/api/cases/${CASE_ID}/holdings${path}`, {
        method,
        headers: await auth(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

    const savings = await call('POST', '', {
      kind: 'savings',
      label: 'BoI savings',
      balance: 28_000,
      ratePct: 2,
      monthlyAmountEur: 800,
    })
    expect(savings.status).toBe(201)
    const saved = holdingSchema.parse(await savings.json())
    expect(saved).toMatchObject({ notedOn: '2026-12-11', reminderId: null, source: 'customer' })

    const mortgage = await call('POST', '', {
      kind: 'deposit',
      label: 'One-year deposit',
      balance: 2_000,
      fixedUntil: '2027-06-30',
      notedOn: '2026-12-01',
    })
    const deposit = holdingSchema.parse(await mortgage.json())
    expect(deposit.notedOn).toBe('2026-12-01')
    expect(deposit.reminderId).not.toBeNull()
    expect(fake.contexts[0]).toMatchObject({ caseId: CASE_ID, today: '2026-12-11' })

    const listed = caseHoldingsResponseSchema.parse(await (await call('GET', '')).json())
    expect(listed.holdings.map((h) => h.label)).toEqual(['BoI savings', 'One-year deposit'])
    // The worked example: €25,000 and €800 a month from 9 Nov 2026, a €35,000 target.
    expect(listed.progress).toMatchObject({
      goal: 'house_deposit',
      savedNowEur: 30_000,
      neededEur: 35_000,
      monthlyEur: 800,
      planExpectedNowEur: 25_800,
      differenceEur: 4_200,
    })
    expect(listed.progress?.line).toBe(
      "€30,000 of €35,000 saved; at €800 a month that is July 2027, €4,200 ahead of the plan's path.",
    )

    const moved = await call('PATCH', `/${deposit.id}`, { fixedUntil: '2027-12-31' })
    expect(moved.status).toBe(200)
    const after = holdingSchema.parse(await moved.json())
    expect(after.reminderId).not.toBe(deposit.reminderId)
    expect(fake.reminders.filter((r) => !r.deleted).map((r) => r.dueOn)).toEqual(['2027-12-31'])

    const rebalanced = holdingSchema.parse(
      await (await call('PATCH', `/${saved.id}`, { balance: 29_000 })).json(),
    )
    expect(rebalanced).toMatchObject({ balance: 29_000, notedOn: '2026-12-11' })

    expect((await call('DELETE', `/${deposit.id}`)).status).toBe(204)
    expect(fake.reminders.every((r) => r.deleted)).toBe(true)
    expect((await call('DELETE', `/${deposit.id}`)).status).toBe(404)
    expect((await call('PATCH', `/${deposit.id}`, { balance: 1 })).status).toBe(404)
  })

  it('has no progress without a claimed plan', async () => {
    const app = appWith(fakeHoldingStore(), null)
    const response = await app.request(`/api/cases/${CASE_ID}/holdings`, {
      headers: await auth(),
    })
    expect(caseHoldingsResponseSchema.parse(await response.json())).toEqual({
      holdings: [],
      progress: null,
    })
  })

  it('refuses a bad body, an empty change, a stranger’s case and no token', async () => {
    const fake = fakeHoldingStore()
    const app = appWith(fake, PLAN)
    const post = async (caseId: string, body: unknown) =>
      app.request(`/api/cases/${caseId}/holdings`, {
        method: 'POST',
        headers: await auth(),
        body: JSON.stringify(body),
      })
    expect((await post(CASE_ID, { kind: 'shares', label: 'x', balance: 1 })).status).toBe(400)
    expect((await post(CASE_ID, { kind: 'savings', label: 'x', balance: -1 })).status).toBe(400)
    expect(
      (await post(CASE_ID, { kind: 'savings', label: 'x'.repeat(81), balance: 1 })).status,
    ).toBe(400)
    expect(
      (await post(CASE_ID, { kind: 'savings', label: 'x', balance: 1, fixedUntil: '2027-6-1' }))
        .status,
    ).toBe(400)
    expect((await post(OTHER_CASE_ID, { kind: 'savings', label: 'x', balance: 1 })).status).toBe(
      404,
    )
    const created = holdingSchema.parse(
      await (await post(CASE_ID, { kind: 'savings', label: 'x', balance: 1 })).json(),
    )
    const empty = await app.request(`/api/cases/${CASE_ID}/holdings/${created.id}`, {
      method: 'PATCH',
      headers: await auth(),
      body: JSON.stringify({}),
    })
    expect(empty.status).toBe(400)
    expect((await app.request(`/api/cases/${CASE_ID}/holdings`)).status).toBe(401)
    expect(fake.holdings).toHaveLength(1)
  })
})
