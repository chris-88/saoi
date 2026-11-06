import { describe, expect, it } from 'vitest'
import type { AdminCase } from '@shared/contracts/admin.ts'
import { ApiError } from '../../errors.ts'
import type { AdminInspectStore } from '../../store/admin/inspect.ts'
import { adminTestApp } from './testing.ts'

const CASE = '11111111-1111-4111-8111-111111111111'

function fake(overrides: Partial<AdminInspectStore> = {}) {
  const calls: string[] = []
  const store: AdminInspectStore = {
    inspectCase: (caseId) => {
      calls.push(caseId)
      return Promise.resolve({ caseId, feedback: [] } as unknown as AdminCase)
    },
    ...overrides,
  }
  return { store, calls }
}

describe('GET /api/admin/cases/{caseId}', () => {
  it('403 for a non-admin even with a malformed id, 401 anonymous', async () => {
    const { send } = adminTestApp({ inspect: fake().store })
    expect((await send('user', 'GET', '/api/admin/cases/nope')).status).toBe(403)
    expect((await send('user', 'GET', `/api/admin/cases/${CASE}`)).status).toBe(403)
    expect((await send('anonymous', 'GET', `/api/admin/cases/${CASE}`)).status).toBe(401)
  })

  it('returns what the store built for that case', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ inspect: store })
    const reply = await send('admin', 'GET', `/api/admin/cases/${CASE}`)
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ caseId: CASE, feedback: [] })
    expect(calls).toEqual([CASE])
  })

  it('400 for an id that is not a uuid', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ inspect: store })
    expect((await send('admin', 'GET', '/api/admin/cases/nope')).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('404 "No such case." when the store says so', async () => {
    const { store } = fake({
      inspectCase: () => Promise.reject(new ApiError('not_found', 'No such case.')),
    })
    const { send } = adminTestApp({ inspect: store })
    const reply = await send('admin', 'GET', `/api/admin/cases/${CASE}`)
    expect(reply.status).toBe(404)
    expect(await reply.json()).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'No such case.' },
    })
  })
})
