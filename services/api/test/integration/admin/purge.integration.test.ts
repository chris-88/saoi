/**
 * `POST /api/admin/cases/purge` removes every case and every non-administrator auth user on the
 * local stack, so it lives in its own file, as the Deno suite does (`admin-purge.integration.ts`).
 */
import { describe, expect, it } from 'vitest'
import { buildApp, emailUser, request, rows, serviceClient, startVisitor } from '../harness.ts'

const app = buildApp()
const service = serviceClient()

describe('purge', () => {
  it('needs confirm: true, then clears cases and visitors, keeps administrators, and is audited', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const purge = (body: unknown) =>
      request(app, 'POST', '/api/admin/cases/purge', { token: admin.token, body })

    expect((await purge({})).status).toBe(400)
    expect((await rows('participants', visitor.caseId)).length).toBe(1)

    const reply = await purge({ confirm: true })
    expect(reply.status).toBe(200)
    expect(reply.body.purged).toBeGreaterThanOrEqual(1)
    expect(reply.body.usersRemoved).toBeGreaterThanOrEqual(1)
    expect((await rows('participants', visitor.caseId)).length).toBe(0)

    // The administrator who did it is still able to get back in.
    expect(await service.auth.admin.getUserById(admin.id)).toMatchObject({
      data: { user: { id: admin.id } },
    })
    const audit = await service
      .from('admin_audit')
      .select('*')
      .eq('action', 'purge_cases')
      .eq('admin_user_id', admin.id)
    expect(audit.data).toHaveLength(1)
    expect(audit.data?.[0]?.detail).toMatchObject({ cases: reply.body.purged })
    expect(audit.data?.[0]?.detail).toHaveProperty('usersRemoved')
  })
})
