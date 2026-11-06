/**
 * The presenter's simulation routes against a real database: the bank's events through the
 * state machine, the savings balance, documents and transfers.
 */
import { describe, expect, it } from 'vitest'
import {
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
const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000'

async function applicationOn(caseId: string, product: string, state: string) {
  const made = await serviceClient()
    .from('applications')
    .insert({ case_id: caseId, product, state })
    .select('id')
    .single()
  if (made.error) throw new Error(made.error.message)
  return made.data.id as string
}

describe('admin simulate routes', () => {
  it('refuse everyone who is not an administrator', async () => {
    const visitor = await startVisitor(app)
    const plain = await emailUser({ admin: false })
    const anonymous = await anonymousUser()
    const paths: [string, string][] = [
      ['POST', `/api/admin/applications/${NO_SUCH_ID}/events`],
      ['POST', `/api/admin/cases/${visitor.caseId}/savings-target/reach`],
      ['PUT', `/api/admin/cases/${visitor.caseId}/savings-balance`],
      ['POST', `/api/admin/cases/${visitor.caseId}/plans/${NO_SUCH_ID}/moves`],
      ['POST', `/api/admin/cases/${visitor.caseId}/documents/verify`],
      ['POST', `/api/admin/cases/${visitor.caseId}/demo-actions`],
      ['POST', `/api/admin/transfers/${NO_SUCH_ID}/settle`],
    ]
    for (const [method, path] of paths) {
      for (const user of [plain, anonymous, visitor.user]) {
        const reply = await request(app, method as 'POST' | 'PUT', path, {
          token: user.token,
          body: {},
        })
        expect(reply.status, `${method} ${path}`).toBe(403)
      }
    }
  })

  it('refuses a move the state machine does not allow, and an unknown application', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const applicationId = await applicationOn(visitor.caseId, 'credit_card', 'in_progress')

    const illegal = await request(app, 'POST', `/api/admin/applications/${applicationId}/events`, {
      token: admin.token,
      body: { event: 'received_by_bank' },
    })
    expect(illegal.status).toBe(409)
    expect(errorCode(illegal)).toBe('illegal_transition')

    const missing = await request(app, 'POST', `/api/admin/applications/${NO_SUCH_ID}/events`, {
      token: admin.token,
      body: { event: 'received_by_bank' },
    })
    expect(missing.status).toBe(404)
    expect(errorCode(missing)).toBe('not_found')
  })

  it('moves a submitted application, opens a request, and closes it when supplied', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const applicationId = await applicationOn(visitor.caseId, 'credit_card', 'submitted')
    const path = `/api/admin/applications/${applicationId}/events`

    const received = await request(app, 'POST', path, {
      token: admin.token,
      body: { event: 'received_by_bank' },
    })
    expect(received.status).toBe(200)
    expect(received.body).toEqual({ state: 'under_review' })

    const asked = await request(app, 'POST', path, {
      token: admin.token,
      body: { event: 'information_requested' },
    })
    expect(asked.status).toBe(200)
    expect(asked.body).toEqual({ state: 'info_required' })
    const requests = await serviceClient()
      .from('application_requests')
      .select('status, detail')
      .eq('application_id', applicationId)
    expect(requests.data).toEqual([{ status: 'open', detail: 'one more payslip' }])

    const supplied = await request(app, 'POST', path, {
      token: admin.token,
      body: { event: 'information_supplied' },
    })
    expect(supplied.status).toBe(200)
    const after = await serviceClient()
      .from('application_requests')
      .select('status')
      .eq('application_id', applicationId)
    expect(after.data).toEqual([{ status: 'fulfilled' }])

    const events = await rows('events', visitor.caseId)
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'application_received',
        'information_requested',
        'document_received',
      ]),
    )
  })

  it('will not check documents when nothing was sent in', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const applicationId = await applicationOn(visitor.caseId, 'credit_card', 'under_review')
    const reply = await request(app, 'POST', `/api/admin/applications/${applicationId}/events`, {
      token: admin.token,
      body: { event: 'documents_verified' },
    })
    expect(reply.status).toBe(400)
    expect(errorCode(reply)).toBe('bad_request')
  })

  it('runs a demo action to the end of its sequence', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    await applicationOn(visitor.caseId, 'credit_card', 'submitted')
    const path = `/api/admin/cases/${visitor.caseId}/demo-actions`

    const done = await request(app, 'POST', path, {
      token: admin.token,
      body: { move: 'credit_card_approved' },
    })
    expect(done.status).toBe(200)
    expect(done.body).toEqual({ state: 'approved' })

    const none = await request(app, 'POST', path, {
      token: admin.token,
      body: { move: 'protection_approved' },
    })
    expect(none.status).toBe(404)
  })

  it('sets the savings balance and reports what was evaluated', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const reply = await request(app, 'PUT', `/api/admin/cases/${visitor.caseId}/savings-balance`, {
      token: admin.token,
      body: { amount: 12000 },
    })
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({
      amount: 12000,
      seen: 12000,
      plansActive: 0,
      milestonesConsidered: 0,
      milestonesReached: 0,
    })
    const events = await rows('events', visitor.caseId)
    expect(events.map((event) => event.type)).toContain('savings_balance_set')
  })

  it('reaches no target when no watch is waiting', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const reply = await request(
      app,
      'POST',
      `/api/admin/cases/${visitor.caseId}/savings-target/reach`,
      { token: admin.token },
    )
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ reached: false, target: null })
  })

  it('verifies the documents on a case', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const reply = await request(
      app,
      'POST',
      `/api/admin/cases/${visitor.caseId}/documents/verify`,
      { token: admin.token },
    )
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ verified: 0 })
  })

  it('answers 404 for a plan and a transfer that do not exist', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const plan = await request(
      app,
      'POST',
      `/api/admin/cases/${visitor.caseId}/plans/${NO_SUCH_ID}/moves`,
      { token: admin.token, body: { move: 'pause' } },
    )
    expect(plan.status).toBe(404)
    const transfer = await request(app, 'POST', `/api/admin/transfers/${NO_SUCH_ID}/settle`, {
      token: admin.token,
    })
    expect(transfer.status).toBe(404)
    expect(errorCode(transfer)).toBe('not_found')
  })
})
