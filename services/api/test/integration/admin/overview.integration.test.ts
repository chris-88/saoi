import { describe, expect, it } from 'vitest'
import { buildApp, emailUser, request, startVisitor } from '../harness.ts'

const app = buildApp()

describe('admin overview routes', () => {
  it('rejects non-admins and anonymous callers', async () => {
    const visitor = await startVisitor(app)
    for (const path of ['overview', 'analytics', 'feedback', 'collaborators']) {
      expect((await request(app, 'GET', `/api/admin/${path}`)).status).toBe(401)
      expect(
        (await request(app, 'GET', `/api/admin/${path}`, { token: visitor.user.token })).status,
      ).toBe(403)
    }
  })

  it('an administrator reads every screen', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const get = (path: string) => request(app, 'GET', path, { token: admin.token })

    const overview = await get('/api/admin/overview')
    expect(overview.status).toBe(200)
    expect(overview.body.cases.some((c: { id: string }) => c.id === visitor.caseId)).toBe(true)
    expect(typeof overview.body.killSwitch).toBe('boolean')
    expect(overview.body.period).toBe('all')

    const focused = await get(`/api/admin/overview?period=7d&caseId=${visitor.caseId}`)
    expect(focused.status).toBe(200)
    expect(focused.body.focusCaseId).toBe(visitor.caseId)
    expect(focused.body.previous).not.toBeNull()

    const analytics = await get('/api/admin/analytics')
    expect(analytics.status).toBe(200)
    expect(analytics.body.period).toBe('30d')
    expect(Array.isArray(analytics.body.funnel)).toBe(true)

    const feedback = await get('/api/admin/feedback?period=90d')
    expect(feedback.status).toBe(200)
    expect(Array.isArray(feedback.body.items)).toBe(true)

    const collaborators = await get('/api/admin/collaborators')
    expect(collaborators.status).toBe(200)
    expect(Array.isArray(collaborators.body.items)).toBe(true)
  })

  it('a bad period is a 400', async () => {
    const admin = await emailUser({ admin: true })
    const reply = await request(app, 'GET', '/api/admin/analytics?period=1y', {
      token: admin.token,
    })
    expect(reply.status).toBe(400)
  })
})
