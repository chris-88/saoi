/**
 * The case inspector against a real database (was `admin` action `inspect_case`).
 */
import { describe, expect, it } from 'vitest'
import { NO_SUCH_ID, buildApp, emailUser, errorCode, request, startVisitor } from '../harness.ts'

const app = buildApp()

describe('GET /api/admin/cases/{caseId}', () => {
  it('reads a case for an administrator', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const reply = await request(app, 'GET', `/api/admin/cases/${visitor.caseId}`, {
      token: admin.token,
    })
    expect(reply.status).toBe(200)
    expect(reply.body.caseId).toBe(visitor.caseId)
    expect(Array.isArray(reply.body.facts)).toBe(true)
    expect(Array.isArray(reply.body.feedback)).toBe(true)
    expect(reply.body.cost).toMatchObject({ turns: expect.any(Number) })
  })

  it('404 for a case that does not exist', async () => {
    const admin = await emailUser({ admin: true })
    const reply = await request(app, 'GET', `/api/admin/cases/${NO_SUCH_ID}`, {
      token: admin.token,
    })
    expect(reply.status).toBe(404)
    expect(errorCode(reply)).toBe('not_found')
    expect(reply.body.error.message).toBe('No such case.')
  })

  it('403 for someone who is not an administrator, 401 without a token', async () => {
    const visitor = await startVisitor(app)
    const path = `/api/admin/cases/${visitor.caseId}`
    expect((await request(app, 'GET', path, { token: visitor.user.token })).status).toBe(403)
    expect((await request(app, 'GET', path)).status).toBe(401)
  })
})
