import { describe, expect, it } from 'vitest'
import type { Period } from '@shared/contracts/admin.ts'
import type { AdminOverviewStore } from '../../store/admin/overview.ts'
import { adminTestApp } from './testing.ts'

const CASE = '11111111-1111-4111-8111-111111111111'

function fake() {
  const calls: unknown[][] = []
  const store: AdminOverviewStore = {
    overview: (period, caseId) => {
      calls.push(['overview', period, caseId])
      return Promise.resolve({
        activity: [],
        cost: { tokens: 0, euro: 0, turns: 0, measuredTurns: 0 },
        killSwitch: false,
        demoActions: [],
        focusCaseId: null,
        persona: { preset: 'default', sliders: {} },
        cases: [],
        metrics: {
          questionsAvoided: 1,
          factsCaptured: 2,
          productsOffered: 3,
          applicationsStarted: 4,
          requestsBlocked: 5,
        },
        period,
        previous: null,
        blocked: [],
      } as unknown as Awaited<ReturnType<AdminOverviewStore['overview']>>)
    },
    analytics: (period: Period) => {
      calls.push(['analytics', period])
      return Promise.resolve({ period } as unknown as Awaited<
        ReturnType<AdminOverviewStore['analytics']>
      >)
    },
    feedback: (period) => {
      calls.push(['feedback', period])
      return Promise.resolve([])
    },
    collaborators: () => Promise.resolve([]),
  }
  return { store, calls }
}

const PATHS = [
  '/api/admin/overview',
  '/api/admin/analytics',
  '/api/admin/feedback',
  '/api/admin/collaborators',
]

describe('admin overview routes', () => {
  it.each(PATHS)('%s: 403 for a non-admin even with an invalid query, 401 anonymous', async (p) => {
    const { send } = adminTestApp({ overview: fake().store })
    expect((await send('user', 'GET', `${p}?period=bogus&caseId=x`)).status).toBe(403)
    expect((await send('anonymous', 'GET', p)).status).toBe(401)
  })

  it('overview defaults to all and passes the case', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ overview: store })
    const reply = await send('admin', 'GET', '/api/admin/overview')
    expect(reply.status).toBe(200)
    expect(await reply.json()).toMatchObject({ period: 'all', metrics: { requestsBlocked: 5 } })
    await send('admin', 'GET', `/api/admin/overview?period=7d&caseId=${CASE}`)
    expect(calls).toEqual([
      ['overview', 'all', undefined],
      ['overview', '7d', CASE],
    ])
  })

  it('analytics defaults to 30d', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ overview: store })
    const reply = await send('admin', 'GET', '/api/admin/analytics')
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ period: '30d' })
    expect(calls).toEqual([['analytics', '30d']])
  })

  it('feedback wraps the items and defaults to 30d', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ overview: store })
    const reply = await send('admin', 'GET', '/api/admin/feedback')
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ items: [] })
    expect(calls).toEqual([['feedback', '30d']])
  })

  it('collaborators wraps the items', async () => {
    const { store } = fake()
    const { send } = adminTestApp({ overview: store })
    const reply = await send('admin', 'GET', '/api/admin/collaborators')
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ items: [] })
  })

  it('a bad period or case id is a 400', async () => {
    const { send } = adminTestApp({ overview: fake().store })
    expect((await send('admin', 'GET', '/api/admin/analytics?period=1y')).status).toBe(400)
    expect((await send('admin', 'GET', '/api/admin/overview?caseId=nope')).status).toBe(400)
  })
})
