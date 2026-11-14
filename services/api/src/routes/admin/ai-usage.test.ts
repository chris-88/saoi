import { describe, expect, it } from 'vitest'
// First: the app patches zod with `.openapi`, which a schema built before it would lack.
import { adminTestApp } from './testing.ts'
import { aiUsageSchema, type AiUsage, type Period } from '@shared/contracts/admin.ts'
import type { AdminAiUsageStore } from '../../store/admin/ai-usage.ts'

const EMPTY_COUNTS = {
  calls: 0,
  sessions: 0,
  cardsShown: 0,
  plansSaved: 0,
  linksOpened: 0,
  claimed: 0,
  signedIn: 0,
  chosen: 0,
}

const usage = (period: Period): AiUsage => ({
  period,
  from: '2026-11-07T00:00:00.000Z',
  to: '2026-11-14T00:00:00.000Z',
  totals: { ...EMPTY_COUNTS, calls: 2 },
  previous: EMPTY_COUNTS,
  funnel: [],
  series: [],
  tools: [],
  gateMissing: [],
  userAgents: [],
  recent: [],
  nextCursor: null,
})

function fake() {
  const calls: unknown[][] = []
  const store: AdminAiUsageStore = {
    aiUsage: (period, cursor) => {
      calls.push([period, cursor])
      return Promise.resolve(cursor === 'bad' ? null : usage(period))
    },
  }
  return { store, calls }
}

describe('GET /api/admin/ai-usage', () => {
  it('is for administrators only, before the query is looked at', async () => {
    const { send } = adminTestApp({ aiUsage: fake().store })
    expect((await send('user', 'GET', '/api/admin/ai-usage?period=bogus')).status).toBe(403)
    expect((await send('anonymous', 'GET', '/api/admin/ai-usage')).status).toBe(401)
  })

  it('defaults to 7d and passes the period and the cursor', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ aiUsage: store })
    const reply = await send('admin', 'GET', '/api/admin/ai-usage')
    expect(reply.status).toBe(200)
    expect(aiUsageSchema.parse(await reply.json())).toMatchObject({ period: '7d' })
    await send('admin', 'GET', '/api/admin/ai-usage?period=30d&cursor=abc')
    expect(calls).toEqual([
      ['7d', undefined],
      ['30d', 'abc'],
    ])
  })

  it('a bad period or cursor is a 400', async () => {
    const { send } = adminTestApp({ aiUsage: fake().store })
    expect((await send('admin', 'GET', '/api/admin/ai-usage?period=1y')).status).toBe(400)
    expect((await send('admin', 'GET', '/api/admin/ai-usage?cursor=bad')).status).toBe(400)
  })
})
