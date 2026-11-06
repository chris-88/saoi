/**
 * Form applications against a real database: list, inspect, rebuild (were `admin` actions
 * `list_form_applications`, `inspect_form_application`, `rebuild_form_applications`).
 */
import { describe, expect, it } from 'vitest'
import {
  NO_SUCH_ID,
  buildApp,
  emailUser,
  errorCode,
  request,
  serviceClient,
  startVisitor,
} from '../harness.ts'

const app = buildApp()

async function applicationFor(caseId: string): Promise<string> {
  const made = await serviceClient()
    .from('form_applications')
    .insert({
      case_id: caseId,
      form_id: '1833',
      form_version: 'test',
      source_hash: 'test',
      answers: {},
      reused_fields: [],
    })
    .select('id')
    .single()
  if (made.error) throw new Error(`form_applications: ${made.error.message}`)
  return made.data.id as string
}

describe('admin form applications', () => {
  it('lists, then inspects an application', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const id = await applicationFor(visitor.caseId)

    const list = await request(app, 'GET', '/api/admin/form-applications', { token: admin.token })
    expect(list.status).toBe(200)
    expect(list.body.applications.find((a: { id: string }) => a.id === id)).toMatchObject({
      caseId: visitor.caseId,
      formId: '1833',
      answered: 0,
      reused: 0,
    })

    const one = await request(app, 'GET', `/api/admin/form-applications/${id}`, {
      token: admin.token,
    })
    expect(one.status).toBe(200)
    expect(one.body.caseId).toBe(visitor.caseId)
    expect(one.body.definition.formId).toBe('1833')
    expect(one.body.submission).toMatchObject({
      status: 'GENERATED_NOT_SENT',
      externalRequestMade: false,
    })
  })

  it('404 for an application that does not exist', async () => {
    const admin = await emailUser({ admin: true })
    const reply = await request(app, 'GET', `/api/admin/form-applications/${NO_SUCH_ID}`, {
      token: admin.token,
    })
    expect(reply.status).toBe(404)
    expect(errorCode(reply)).toBe('not_found')
    expect(reply.body.error.message).toBe('No such form application.')
  })

  it('rebuild reports its counts', async () => {
    const admin = await emailUser({ admin: true })
    const reply = await request(app, 'POST', '/api/admin/form-applications/rebuild', {
      token: admin.token,
    })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({
      cases: expect.any(Number),
      forms: expect.any(Number),
      answered: expect.any(Number),
      failed: expect.any(Number),
    })
  })

  it('403 for someone who is not an administrator', async () => {
    const visitor = await startVisitor(app)
    for (const [method, path] of [
      ['GET', '/api/admin/form-applications'],
      ['GET', `/api/admin/form-applications/${NO_SUCH_ID}`],
      ['POST', '/api/admin/form-applications/rebuild'],
    ] as const) {
      expect((await request(app, method, path, { token: visitor.user.token })).status).toBe(403)
    }
  })
})
