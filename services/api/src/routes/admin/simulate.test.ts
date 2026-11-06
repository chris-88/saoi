import { describe, expect, it } from 'vitest'
import { ApiError } from '../../errors.ts'
import type { AdminSimulateStore } from '../../store/admin/simulate.ts'
import { adminTestApp } from './testing.ts'

const ID = '44444444-4444-4444-8444-444444444444'
const PLAN = '55555555-5555-4555-8555-555555555555'

function fake(overrides: Partial<AdminSimulateStore> = {}): AdminSimulateStore {
  return {
    simulateEvent: () => Promise.resolve({ state: 'under_review' }),
    reachSavingsTarget: () => Promise.resolve({ reached: true, target: 20000 }),
    setSavingsBalance: (_caseId, amount) =>
      Promise.resolve({
        amount,
        seen: amount,
        plansActive: 1,
        milestonesConsidered: 2,
        milestonesReached: 1,
      }),
    planMove: () => Promise.resolve({ status: 'paused' }),
    verifyDocuments: () => Promise.resolve({ verified: 3 }),
    demoAction: () => Promise.resolve({ state: 'approved' }),
    settleTransfer: (transferId) =>
      Promise.resolve({ transferId, state: 'settled', settledAt: '2026-11-04T10:00:00.000Z' }),
    ...overrides,
  }
}

const routes: readonly { method: string; path: string; body?: unknown }[] = [
  { method: 'POST', path: `/api/admin/applications/${ID}/events`, body: { event: 'nope' } },
  { method: 'POST', path: `/api/admin/cases/${ID}/savings-target/reach` },
  { method: 'PUT', path: `/api/admin/cases/${ID}/savings-balance`, body: { amount: -1 } },
  { method: 'POST', path: `/api/admin/cases/${ID}/plans/${PLAN}/moves`, body: { move: 'x' } },
  { method: 'POST', path: `/api/admin/cases/${ID}/documents/verify` },
  { method: 'POST', path: `/api/admin/cases/${ID}/demo-actions`, body: { move: 'x' } },
  { method: 'POST', path: `/api/admin/transfers/${ID}/settle` },
]

const errorOf = async (reply: Response) =>
  ((await reply.json()) as { error: { code: string } }).error.code

describe('admin simulate routes', () => {
  it.each(routes)('$method $path is 403 for a non-admin even with a bad body', async (r) => {
    const { send } = adminTestApp({ simulate: fake() })
    expect((await send('user', r.method, r.path, r.body)).status).toBe(403)
  })

  it.each(routes)('$method $path is 401 for an anonymous caller', async (r) => {
    const { send } = adminTestApp({ simulate: fake() })
    expect((await send('anonymous', r.method, r.path, r.body)).status).toBe(401)
  })

  it('simulates an event', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const reply = await send('admin', 'POST', `/api/admin/applications/${ID}/events`, {
      event: 'received_by_bank',
    })
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ state: 'under_review' })
  })

  it('passes the detail through and maps an illegal transition', async () => {
    let seen: unknown
    const { send } = adminTestApp({
      simulate: fake({
        simulateEvent: (input) => {
          seen = input
          return Promise.reject(new ApiError('illegal_transition', 'Not from there.'))
        },
      }),
    })
    const reply = await send('admin', 'POST', `/api/admin/applications/${ID}/events`, {
      event: 'information_requested',
      detail: 'a payslip',
    })
    expect(seen).toEqual({ applicationId: ID, event: 'information_requested', detail: 'a payslip' })
    expect(reply.status).toBe(409)
    expect(await errorOf(reply)).toBe('illegal_transition')
  })

  it('maps an unknown application to 404', async () => {
    const { send } = adminTestApp({
      simulate: fake({
        simulateEvent: () => Promise.reject(new ApiError('not_found', 'No such application.')),
      }),
    })
    const reply = await send('admin', 'POST', `/api/admin/applications/${ID}/events`, {
      event: 'completed',
    })
    expect(reply.status).toBe(404)
  })

  it('rejects an invalid event with 400', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const reply = await send('admin', 'POST', `/api/admin/applications/${ID}/events`, {
      event: 'nope',
    })
    expect(reply.status).toBe(400)
  })

  it('reaches the savings target', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const reply = await send('admin', 'POST', `/api/admin/cases/${ID}/savings-target/reach`)
    expect(await reply.json()).toEqual({ reached: true, target: 20000 })
  })

  it('sets the savings balance', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const reply = await send('admin', 'PUT', `/api/admin/cases/${ID}/savings-balance`, {
      amount: 5000,
    })
    expect(await reply.json()).toEqual({
      amount: 5000,
      seen: 5000,
      plansActive: 1,
      milestonesConsidered: 2,
      milestonesReached: 1,
    })
  })

  it('moves a plan and maps a refused move to 409', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const path = `/api/admin/cases/${ID}/plans/${PLAN}/moves`
    const ok = await send('admin', 'POST', path, { move: 'pause' })
    expect(await ok.json()).toEqual({ status: 'paused' })

    const refused = adminTestApp({
      simulate: fake({
        planMove: () =>
          Promise.reject(new ApiError('conflict', 'That plan cannot move from paused.')),
      }),
    })
    expect((await refused.send('admin', 'POST', path, { move: 'pause' })).status).toBe(409)
  })

  it('verifies documents', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const reply = await send('admin', 'POST', `/api/admin/cases/${ID}/documents/verify`)
    expect(await reply.json()).toEqual({ verified: 3 })
  })

  it('runs a demo action and rejects an unknown move', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const path = `/api/admin/cases/${ID}/demo-actions`
    const ok = await send('admin', 'POST', path, { move: 'credit_card_approved' })
    expect(await ok.json()).toEqual({ state: 'approved' })
    expect((await send('admin', 'POST', path, { move: 'nope' })).status).toBe(400)
  })

  it('settles a transfer and maps an already-settled one to 409', async () => {
    const { send } = adminTestApp({ simulate: fake() })
    const path = `/api/admin/transfers/${ID}/settle`
    const ok = await send('admin', 'POST', path)
    expect(await ok.json()).toEqual({
      transferId: ID,
      state: 'settled',
      settledAt: '2026-11-04T10:00:00.000Z',
    })

    const settled = adminTestApp({
      simulate: fake({
        settleTransfer: () =>
          Promise.reject(new ApiError('conflict', 'That transfer is already settled.')),
      }),
    })
    expect((await settled.send('admin', 'POST', path)).status).toBe(409)
  })
})
