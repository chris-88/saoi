/**
 * The admin API's guard and the destructive case routes against a real database. The Node route
 * is the source of truth for these behaviours; the Deno `admin` tests pin the Edge Function's
 * older ones (shape before identity, reset with no id, no audit trail).
 */
import { describe, expect, it } from 'vitest'
import {
  NO_SUCH_ID,
  anonymousUser,
  buildApp,
  emailUser,
  errorCode,
  request,
  rows,
  serviceClient,
  startVisitor,
} from '../harness.ts'

const app = buildApp()
const service = serviceClient()

async function auditRows(action: string, caseId: string) {
  const found = await service
    .from('admin_audit')
    .select('*')
    .eq('action', action)
    .eq('case_id', caseId)
  if (found.error) throw new Error(found.error.message)
  return found.data
}

describe('requireAdmin', () => {
  it('is 401 without a token, and 403 for an anonymous visitor and a signed-in non-admin', async () => {
    const visitor = await anonymousUser()
    const stranger = await emailUser({ admin: false })
    expect((await request(app, 'GET', '/api/admin/overview')).status).toBe(401)
    for (const user of [visitor, stranger]) {
      const reply = await request(app, 'GET', '/api/admin/overview', { token: user.token })
      expect(reply.status).toBe(403)
      expect(errorCode(reply)).toBe('forbidden')
    }
  })

  it('checks identity BEFORE the body: a stranger sending nonsense learns nothing but 403', async () => {
    const visitor = await anonymousUser()
    const stranger = await emailUser({ admin: false })
    for (const user of [visitor, stranger]) {
      const bad = await request(app, 'DELETE', '/api/admin/cases/nope', {
        token: user.token,
        body: { nonsense: true },
      })
      expect(bad.status).toBe(403)
      const worse = await request(app, 'POST', '/api/admin/cases/reset', {
        token: user.token,
        body: { caseId: 'nope' },
      })
      expect(worse.status).toBe(403)
    }
  })

  it('lets an administrator in', async () => {
    const admin = await emailUser({ admin: true })
    const reply = await request(app, 'GET', '/api/admin/overview', { token: admin.token })
    expect(reply.status).toBe(200)
    expect(typeof reply.body.killSwitch).toBe('boolean')
  })
})

describe('reset', () => {
  it('needs a case id and confirm: true, and replaces exactly the named case', async () => {
    const admin = await emailUser({ admin: true })
    const target = await startVisitor(app)
    const bystander = await startVisitor(app)
    const reset = (body: unknown) =>
      request(app, 'POST', '/api/admin/cases/reset', { token: admin.token, body })

    // No id: 400, never "the most recent case".
    expect((await reset({ confirm: true })).status).toBe(400)
    // No confirm: 400 and nothing happened.
    expect((await reset({ caseId: target.caseId })).status).toBe(400)
    expect((await rows('participants', target.caseId)).length).toBe(1)
    // Unknown id: 404, and no canonical case is conjured up.
    expect((await reset({ caseId: NO_SUCH_ID, confirm: true })).status).toBe(404)

    const reply = await reset({ caseId: target.caseId, confirm: true })
    expect(reply.status).toBe(200)
    const fresh = reply.body.caseId as string
    expect((await rows('participants', target.caseId)).length).toBe(0)
    expect((await rows('participants', bystander.caseId)).length).toBe(1)

    const created = await service.from('cases').select('kind, auth_level').eq('id', fresh).single()
    expect(created.data).toEqual({ kind: 'presenter', auth_level: 'authenticated' })
    expect((await rows('facts', fresh)).length).toBe(reply.body.facts)
    expect((await rows('events', fresh)).map((e) => [e.type, e.actor])).toEqual([
      ['case_reset', 'admin'],
    ])
    const audit = await auditRows('reset_case', target.caseId)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ admin_user_id: admin.id })
    expect(audit[0]?.detail).toMatchObject({ replacedBy: fresh })
  })
})

describe('delete', () => {
  it('needs confirm: true, cascades, refuses an unknown id and writes an audit row', async () => {
    const admin = await emailUser({ admin: true })
    const victim = await startVisitor(app)
    const del = (caseId: string, body: unknown) =>
      request(app, 'DELETE', `/api/admin/cases/${caseId}`, { token: admin.token, body })

    expect((await del(victim.caseId, {})).status).toBe(400)
    expect((await rows('participants', victim.caseId)).length).toBe(1)
    expect((await del(NO_SUCH_ID, { confirm: true })).status).toBe(404)
    expect(await auditRows('delete_case', NO_SUCH_ID)).toHaveLength(0)

    const reply = await del(victim.caseId, { confirm: true })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ deleted: victim.caseId })
    const left = await service.from('cases').select('id').eq('id', victim.caseId)
    expect(left.data).toEqual([])
    expect((await rows('participants', victim.caseId)).length).toBe(0)

    // The trail outlives the case it describes.
    const audit = await auditRows('delete_case', victim.caseId)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ admin_user_id: admin.id })
  })
})

describe('tag-test', () => {
  it('marks the case as a test case, and 404s for an unknown one', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const tag = (id: string) =>
      request(app, 'POST', `/api/admin/cases/${id}/tag-test`, { token: admin.token })
    expect((await tag(NO_SUCH_ID)).status).toBe(404)
    expect((await tag(visitor.caseId)).body).toEqual({ caseId: visitor.caseId, kind: 'test' })
    const row = await service.from('cases').select('kind').eq('id', visitor.caseId).single()
    expect(row.data?.kind).toBe('test')
  })
})

describe('config', () => {
  it('sets and clears the kill switch and the persona as an administrator', async () => {
    const admin = await emailUser({ admin: true })
    const put = (path: string, body: unknown) =>
      request(app, 'PUT', path, { token: admin.token, body })
    expect((await put('/api/admin/kill-switch', { enabled: true })).body).toEqual({
      killSwitch: true,
    })
    expect((await put('/api/admin/kill-switch', { enabled: false })).body).toEqual({
      killSwitch: false,
    })
    expect((await put('/api/admin/persona', { preset: 'concise' })).status).toBe(200)
    expect((await put('/api/admin/persona', {})).status).toBe(400)
    // No key configured in the harness: the model-backed previews are 502, not a crash.
    const guard = await request(app, 'POST', '/api/admin/guardrails/test', {
      token: admin.token,
      body: { message: 'hello' },
    })
    expect(guard.status).toBe(502)
    await put('/api/admin/persona', { preset: 'default' })
  })
})
