/**
 * Holdings against a real database: the routes write `holdings`, keep the matching `reminders`
 * row in step (created, replaced when the date moves, deleted with the holding), and a claimed
 * plan seeds the first holdings once.
 */
import { describe, expect, it } from 'vitest'
// The harness first: it loads the app and @hono/zod-openapi, which has to extend zod before any
// shared schema is built.
import {
  NO_SUCH_ID,
  buildApp,
  request,
  rows,
  serviceClient,
  startVisitor,
  type Participant,
} from './harness.ts'
import { exampleMarketPlan } from '@shared/contracts/market-plan.example.ts'
import { seedHoldingsFromPlan } from '@shared/db/holdings.ts'

const app = buildApp()
const path = (visitor: Participant, rest = '') => `/api/cases/${visitor.caseId}/holdings${rest}`

describe('holdings', () => {
  it('adds, changes and deletes a holding, keeping its reminder in step', async () => {
    const visitor = await startVisitor(app)
    const token = visitor.user.token

    const created = await request(app, 'POST', path(visitor), {
      token,
      body: {
        kind: 'mortgage',
        label: 'AIB mortgage',
        provider: 'AIB',
        balance: 240_000,
        ratePct: 3.45,
        monthlyAmountEur: 1_200,
        fixedUntil: '2099-03-01',
      },
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ balance: 240_000, ratePct: 3.45, source: 'customer' })
    const firstReminder = created.body.reminderId as string
    expect(firstReminder).toBeTruthy()
    const reminders = await rows('reminders', visitor.caseId)
    expect(reminders).toEqual([
      expect.objectContaining({
        id: firstReminder,
        kind: 'fixed_rate_ends',
        label: 'AIB mortgage: fixed rate ends',
        due_on: '2099-03-01',
        deleted_at: null,
      }),
    ])

    const moved = await request(app, 'PATCH', path(visitor, `/${String(created.body.id)}`), {
      token,
      body: { fixedUntil: '2099-09-01', balance: 239_000 },
    })
    expect(moved.status).toBe(200)
    expect(moved.body.reminderId).not.toBe(firstReminder)
    const afterMove = await rows('reminders', visitor.caseId)
    expect(afterMove.filter((r) => r.deleted_at === null).map((r) => r.due_on)).toEqual([
      '2099-09-01',
    ])

    const listed = await request(app, 'GET', path(visitor), { token })
    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({ holdings: [{ balance: 239_000 }], progress: null })

    const deleted = await request(app, 'DELETE', path(visitor, `/${String(created.body.id)}`), {
      token,
    })
    expect(deleted.status).toBe(204)
    expect((await rows('reminders', visitor.caseId)).every((r) => r.deleted_at !== null)).toBe(true)
    expect((await request(app, 'GET', path(visitor), { token })).body.holdings).toEqual([])
    expect((await request(app, 'DELETE', path(visitor, `/${NO_SUCH_ID}`), { token })).status).toBe(
      404,
    )

    const events = (await rows('events', visitor.caseId)).map((event) => event.type)
    expect(events).toEqual(
      expect.arrayContaining(['holding_added', 'holding_changed', 'holding_deleted']),
    )
  })

  it('refuses another visitor’s case', async () => {
    const owner = await startVisitor(app)
    const stranger = await startVisitor(app)
    const reply = await request(app, 'POST', path(owner), {
      token: stranger.user.token,
      body: { kind: 'savings', label: 'x', balance: 1 },
    })
    expect(reply.status).toBe(404)
    expect(await rows('holdings', owner.caseId)).toEqual([])
  })

  it('seeds the plan’s savings and debts once, noted on the plan’s date', async () => {
    const visitor = await startVisitor(app)
    const db = serviceClient() as never
    const plan = exampleMarketPlan()
    const input = { caseId: visitor.caseId, planId: 'plan-1', plan, notedOn: '2026-11-09' }
    expect(await seedHoldingsFromPlan(db, input)).toBe(2)
    expect(await seedHoldingsFromPlan(db, input)).toBe(0)
    const seeded = await rows('holdings', visitor.caseId)
    expect(seeded.map((row) => [row.kind, Number(row.balance), row.source, row.noted_on])).toEqual(
      expect.arrayContaining([
        ['current', 25_000, 'plan', '2026-11-09'],
        ['car_finance', 9_000, 'plan', '2026-11-09'],
      ]),
    )
  })
})
