import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../errors.ts'
import type { AdminCasesStore } from '../../store/admin/cases.ts'
import { ADMIN_ID, adminTestApp } from './testing.ts'

const CASE = '22222222-2222-4222-8222-222222222222'

function fake(overrides: Partial<AdminCasesStore> = {}) {
  const store = {
    resetCase: vi.fn(() => Promise.resolve({ caseId: CASE, facts: 12 })),
    deleteCase: vi.fn((caseId: string) => Promise.resolve({ deleted: caseId })),
    purgeCases: vi.fn(() => Promise.resolve({ purged: 3, usersRemoved: 2 })),
    tagTestCase: vi.fn((caseId: string) => Promise.resolve({ caseId, kind: 'test' as const })),
    ...overrides,
  } satisfies AdminCasesStore
  return { store, ...adminTestApp({ cases: store }) }
}

const routes: [string, string, unknown][] = [
  ['POST', '/api/admin/cases/reset', { caseId: CASE, confirm: true }],
  ['DELETE', `/api/admin/cases/${CASE}`, { confirm: true }],
  ['POST', '/api/admin/cases/purge', { confirm: true }],
  ['POST', `/api/admin/cases/${CASE}/tag-test`, undefined],
]

describe('admin cases: identity', () => {
  it.each(routes)(
    '%s %s is 403 for a signed-in non-admin, even with a bad body',
    async (method, path) => {
      const { send, store } = fake()
      const reply = await send('user', method, path, { nonsense: true })
      expect(reply.status).toBe(403)
      expect(await reply.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled()
    },
  )

  it.each(routes)('%s %s is 401 without a token', async (method, path, body) => {
    const { send } = fake()
    expect((await send('anonymous', method, path, body)).status).toBe(401)
  })
})

describe('admin cases: destructive routes need confirm: true', () => {
  it('reset without a case id is 400, never the most recent case', async () => {
    const { send, store } = fake()
    const reply = await send('admin', 'POST', '/api/admin/cases/reset', { confirm: true })
    expect(reply.status).toBe(400)
    expect(store.resetCase).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', '/api/admin/cases/reset', { caseId: CASE }],
    ['POST', '/api/admin/cases/reset', { caseId: CASE, confirm: false }],
    ['DELETE', `/api/admin/cases/${CASE}`, {}],
    ['DELETE', `/api/admin/cases/${CASE}`, { confirm: 'yes' }],
    ['POST', '/api/admin/cases/purge', {}],
  ])('%s %s with %j is 400 and does nothing', async (method, path, body) => {
    const { send, store } = fake()
    expect((await send('admin', method, path, body)).status).toBe(400)
    expect(store.resetCase).not.toHaveBeenCalled()
    expect(store.deleteCase).not.toHaveBeenCalled()
    expect(store.purgeCases).not.toHaveBeenCalled()
  })

  it('resets, deleting the named case and recording who asked', async () => {
    const { send, store } = fake()
    const reply = await send('admin', 'POST', '/api/admin/cases/reset', {
      caseId: CASE,
      confirm: true,
    })
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ caseId: CASE, facts: 12 })
    expect(store.resetCase).toHaveBeenCalledWith(CASE, ADMIN_ID)
  })

  it('deletes and purges, passing the admin so the audit row names them', async () => {
    const { send, store } = fake()
    const deleted = await send('admin', 'DELETE', `/api/admin/cases/${CASE}`, { confirm: true })
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ deleted: CASE })
    expect(store.deleteCase).toHaveBeenCalledWith(CASE, ADMIN_ID)

    const purged = await send('admin', 'POST', '/api/admin/cases/purge', { confirm: true })
    expect(purged.status).toBe(200)
    expect(await purged.json()).toEqual({ purged: 3, usersRemoved: 2 })
    expect(store.purgeCases).toHaveBeenCalledWith(ADMIN_ID)
  })

  it('maps an unknown case to 404', async () => {
    const { send } = fake({
      deleteCase: () => Promise.reject(new ApiError('not_found', 'No case with that id.')),
    })
    const reply = await send('admin', 'DELETE', `/api/admin/cases/${CASE}`, { confirm: true })
    expect(reply.status).toBe(404)
  })

  it('rejects a case id that is not a uuid', async () => {
    const { send } = fake()
    const reply = await send('admin', 'DELETE', '/api/admin/cases/nope', { confirm: true })
    expect(reply.status).toBe(400)
  })
})

describe('admin cases: tag-test', () => {
  it('tags a case', async () => {
    const { send } = fake()
    const reply = await send('admin', 'POST', `/api/admin/cases/${CASE}/tag-test`)
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ caseId: CASE, kind: 'test' })
  })
})
