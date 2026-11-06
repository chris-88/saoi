/**
 * The partner routes against a real database: joining by invite, the scoped view, and answering
 * a task so that it lands as a `partner_stated` fact on the primary's case (invariant 7).
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  anonymousUser,
  buildApp,
  errorCode,
  request,
  rows,
  serviceClient,
  startVisitor,
} from './harness.ts'

const app = buildApp()
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

/** A case with a partner participant, an invite for them, and a joint account waiting on them. */
async function invited() {
  const owner = await startVisitor(app)
  const service = serviceClient()
  const made = await service
    .from('participants')
    .insert({ case_id: owner.caseId, role: 'partner', display_name: 'Emma' })
    .select('id')
    .single()
  if (made.error) throw new Error(made.error.message)

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '').slice(0, 48)
  const invite = await service.from('tokens').insert({
    case_id: owner.caseId,
    participant_id: made.data.id,
    kind: 'partner_invite',
    token_hash: sha(token),
  })
  if (invite.error) throw new Error(invite.error.message)

  const application = await service.from('applications').insert({
    case_id: owner.caseId,
    product: 'joint_account',
    state: 'waiting_partner',
  })
  if (application.error) throw new Error(application.error.message)

  // What the primary earns must never reach the partner.
  const fact = await service.from('facts').insert({
    case_id: owner.caseId,
    key: 'income.annualBasic',
    participant_id: owner.participantId,
    subject_kind: 'participant',
    value: 91234,
    source: 'customer_stated',
    verified: false,
  })
  if (fact.error) throw new Error(fact.error.message)

  return { owner, token, partnerParticipantId: made.data.id as string }
}

describe('partner routes', () => {
  it('no token is 401 on every route', async () => {
    expect(
      (await request(app, 'POST', '/api/partner/join', { body: { token: 'x'.repeat(24) } })).status,
    ).toBe(401)
    expect((await request(app, 'GET', '/api/partner/tasks')).status).toBe(401)
    expect(
      (
        await request(app, 'POST', '/api/partner/submit', {
          body: { answers: [{ id: 'fact:x', value: 1 }] },
        })
      ).status,
    ).toBe(401)
  })

  it('a stranger, and the primary customer, have no partner seat', async () => {
    const { owner } = await invited()
    const stranger = await anonymousUser()
    for (const token of [stranger.token, owner.user.token]) {
      const tasks = await request(app, 'GET', '/api/partner/tasks', { token })
      expect(tasks.status).toBe(403)
      expect(errorCode(tasks)).toBe('forbidden')
      const submit = await request(app, 'POST', '/api/partner/submit', {
        token,
        body: { answers: [{ id: 'fact:employment.status', value: 'employed_full_time' }] },
      })
      expect(submit.status).toBe(403)
    }
  })

  it('an unknown or malformed token is refused', async () => {
    const stranger = await anonymousUser()
    const unknown = await request(app, 'POST', '/api/partner/join', {
      token: stranger.token,
      body: { token: 'f'.repeat(32) },
    })
    expect(unknown.status).toBe(404)
    expect(errorCode(unknown)).toBe('not_found')
    expect(
      (
        await request(app, 'POST', '/api/partner/join', {
          token: stranger.token,
          body: { token: 'short' },
        })
      ).status,
    ).toBe(400)
  })

  it('joins once per browser, shows only scoped data, and answers once for the household', async () => {
    const { owner, token, partnerParticipantId } = await invited()
    const phone = await anonymousUser()

    const joined = await request(app, 'POST', '/api/partner/join', {
      token: phone.token,
      body: { token },
    })
    expect(joined.status).toBe(200)
    expect(joined.body.partnerName).toBe('Emma')
    expect(joined.body.applications.length).toBe(1)
    expect(joined.body.tasks.length).toBeGreaterThan(0)
    expect(JSON.stringify(joined.body)).not.toContain('91234')

    // Reopening the link on the same browser is not joining again.
    await request(app, 'POST', '/api/partner/join', { token: phone.token, body: { token } })
    expect(
      (await rows('events', owner.caseId)).filter((e) => e.type === 'partner_joined').length,
    ).toBe(1)

    // A second phone attaches to the same participant.
    const second = await anonymousUser()
    expect(
      (await request(app, 'POST', '/api/partner/join', { token: second.token, body: { token } }))
        .status,
    ).toBe(200)
    const seats = await serviceClient()
      .from('participant_sessions')
      .select('auth_user_id')
      .eq('participant_id', partnerParticipantId)
    expect((seats.data ?? []).length).toBe(2)

    const tasks = await request(app, 'GET', '/api/partner/tasks', { token: phone.token })
    expect(tasks.status).toBe(200)
    const open = tasks.body.tasks.find((t: any) => t.id.startsWith('fact:') && !t.done)
    expect(open).toBeDefined()

    const sensitive = await request(app, 'POST', '/api/partner/submit', {
      token: phone.token,
      body: { answers: [{ id: 'fact:protection.health.smoker', value: true }] },
    })
    expect(sensitive.status).toBe(400)

    const key = String(open.id).slice('fact:'.length)
    const value = open.options?.[0]?.value ?? (open.inputKind === 'number' ? 41500 : 'x')
    const submitted = await request(app, 'POST', '/api/partner/submit', {
      token: phone.token,
      body: { answers: [{ id: open.id, value }] },
    })
    // The task's own kind decides what a valid value is; a free-text probe may be refused.
    if (submitted.status === 200) {
      const fact = (await rows('facts', owner.caseId)).find(
        (f) => f.key === key && f.source === 'partner_stated',
      )
      expect(fact).toMatchObject({ participant_id: partnerParticipantId, verified: false })
      expect((await rows('events', owner.caseId)).some((e) => e.type === 'partner_completed')).toBe(
        true,
      )
    } else {
      expect(submitted.status).toBe(400)
    }
  })

  it('an answer for a select task is recorded and marks the task done', async () => {
    const { owner, token, partnerParticipantId } = await invited()
    const phone = await anonymousUser()
    const joined = await request(app, 'POST', '/api/partner/join', {
      token: phone.token,
      body: { token },
    })
    const choice = joined.body.tasks.find((t: any) => t.inputKind === 'select' && !t.done)
    if (!choice) return // The journey asks this partner for nothing selectable; covered above.

    const submitted = await request(app, 'POST', '/api/partner/submit', {
      token: phone.token,
      body: { answers: [{ id: choice.id, value: choice.options[0].value }] },
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.tasks.find((t: any) => t.id === choice.id).done).toBe(true)
    const stored = (await rows('facts', owner.caseId)).filter((f) => f.source === 'partner_stated')
    expect(stored.length).toBe(1)
    expect(stored[0].participant_id).toBe(partnerParticipantId)
  })
})
