/**
 * The session routes against a real database: start, list, switch, claim, interest, and the
 * presenter-key path. The matrix is the one `supabase/functions/integration/session.integration.ts`
 * pins for the Edge Function; the presenter key now arrives in `X-Presenter-Key`.
 */
import { describe, expect, it } from 'vitest'
import {
  NO_SUCH_ID,
  PRESENTER_KEY,
  anonymousUser,
  buildApp,
  emailUser,
  errorCode,
  request,
  rows,
  serviceClient,
  startVisitor,
} from './harness.ts'
import { addPartner } from './harness.ts'

const app = buildApp()
const key = { 'X-Presenter-Key': PRESENTER_KEY }

const say = async (caseId: string, content = 'hello there') => {
  const r = await serviceClient()
    .from('messages')
    .insert({ case_id: caseId, role: 'customer', content })
  if (r.error) throw new Error(r.error.message)
}

describe('POST /api/sessions', () => {
  it('a new visitor gets a case of their own, and starting again returns it', async () => {
    const user = await anonymousUser()
    const first = await request(app, 'POST', '/api/sessions', {
      token: user.token,
      body: { source: 'qr' },
    })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ created: true, role: 'primary', authLevel: 'anonymous' })
    expect(first.body.customerFirstName).toBeNull()

    const theCase = await serviceClient()
      .from('cases')
      .select('kind, source, auth_level')
      .eq('id', first.body.caseId)
      .single()
    expect(theCase.data).toEqual({ kind: 'customer', source: 'qr', auth_level: 'anonymous' })
    expect((await rows('events', first.body.caseId)).map((e) => [e.type, e.actor])).toEqual([
      ['case_created', 'system'],
    ])

    const again = await request(app, 'POST', '/api/sessions', { token: user.token })
    expect(again.body).toMatchObject({
      caseId: first.body.caseId,
      participantId: first.body.participantId,
      created: false,
    })
    expect((await rows('participants', first.body.caseId)).length).toBe(1)
  })

  it('a known customer starts authenticated with the bank-held facts', async () => {
    const user = await anonymousUser()
    const reply = await request(app, 'POST', '/api/sessions', {
      token: user.token,
      body: { mode: 'known' },
    })
    expect(reply.status).toBe(200)
    expect(reply.body.authLevel).toBe('authenticated')
    expect(typeof reply.body.customerFirstName).toBe('string')
    const facts = await rows('facts', reply.body.caseId)
    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every((f) => f.source === 'bank_held')).toBe(true)
  })

  it('no token and a forged token are 401; a bad mode is 400', async () => {
    const none = await request(app, 'POST', '/api/sessions', { body: {} })
    expect(none.status).toBe(401)
    expect(errorCode(none)).toBe('unauthorised')
    expect(
      (await request(app, 'POST', '/api/sessions', { token: 'not-a-jwt', body: {} })).status,
    ).toBe(401)
    const user = await anonymousUser()
    expect(
      (
        await request(app, 'POST', '/api/sessions', {
          token: user.token,
          body: { mode: 'teleport' },
        })
      ).status,
    ).toBe(400)
  })

  it('a token for a user that was deleted is 401', async () => {
    const user = await anonymousUser()
    await serviceClient().auth.admin.deleteUser(user.id)
    const reply = await request(app, 'POST', '/api/sessions', { token: user.token, body: {} })
    expect(reply.status).toBe(401)
  })

  it('the audience cap refuses a new case when full, but not a returning visitor', async () => {
    const returning = await startVisitor(app)
    const full = buildApp({ audienceMaxCases: 0 })
    const blocked = await request(full, 'POST', '/api/sessions', {
      token: (await anonymousUser()).token,
      body: {},
    })
    expect(blocked.status).toBe(429)
    expect(errorCode(blocked)).toBe('rate_limited')
    const back = await request(full, 'POST', '/api/sessions', {
      token: returning.user.token,
      body: {},
    })
    expect(back.status).toBe(200)
    expect(back.body.caseId).toBe(returning.caseId)
  })
})

describe('GET /api/cases and POST /api/cases', () => {
  it('a visitor sees only their own populated conversations', async () => {
    const me = await startVisitor(app)
    const other = await startVisitor(app)
    await say(other.caseId, 'I am somebody else')

    const listed = await request(app, 'GET', '/api/cases', { token: me.user.token })
    expect(listed.body.presenter).toBe(false)
    expect(listed.body.cases.map((c: any) => c.caseId)).toEqual([me.caseId])
    expect(listed.body.cases[0]).toMatchObject({ current: true, mine: true })

    const next = await request(app, 'POST', '/api/cases', { token: me.user.token, body: {} })
    expect(next.status).toBe(201)
    expect(next.body.created).toBe(true)
    expect(next.body.caseId).not.toBe(me.caseId)
    await say(me.caseId, 'my first conversation')
    const both = await request(app, 'GET', '/api/cases', { token: me.user.token })
    expect(both.body.cases.map((c: any) => c.caseId).sort()).toEqual(
      [me.caseId, next.body.caseId].sort(),
    )
    expect(both.body.cases.find((c: any) => c.caseId === me.caseId).opening).toBe(
      'my first conversation',
    )
  })

  it('the presenter key opens everyone but test cases; a wrong key opens nothing', async () => {
    const me = await startVisitor(app)
    const other = await startVisitor(app)
    const tagged = await startVisitor(app)
    await say(other.caseId, 'an audience member')
    await say(tagged.caseId, 'a probe')
    await serviceClient().from('cases').update({ kind: 'test' }).eq('id', tagged.caseId)

    const wrong = await request(app, 'GET', '/api/cases', {
      token: me.user.token,
      headers: { 'X-Presenter-Key': 'guess' },
    })
    expect(wrong.body.presenter).toBe(false)
    expect(wrong.body.cases.some((c: any) => c.caseId === other.caseId)).toBe(false)

    const presenter = await request(app, 'GET', '/api/cases', {
      token: me.user.token,
      headers: key,
    })
    expect(presenter.body.presenter).toBe(true)
    const theirs = presenter.body.cases.find((c: any) => c.caseId === other.caseId)
    expect(theirs.mine).toBe(false)
    expect(presenter.body.cases.some((c: any) => c.caseId === tagged.caseId)).toBe(false)
  })

  it('the audience cap applies to a new case', async () => {
    const me = await startVisitor(app)
    const full = buildApp({ audienceMaxCases: 0 })
    expect(
      (await request(full, 'POST', '/api/cases', { token: me.user.token, body: {} })).status,
    ).toBe(429)
  })
})

describe('POST /api/cases/:caseId/switch', () => {
  it('refuses without the key, adopts the primary participant with it, 404 for a ghost', async () => {
    const me = await startVisitor(app)
    const other = await startVisitor(app)
    const path = `/api/cases/${other.caseId}/switch`

    const refused = await request(app, 'POST', path, { token: me.user.token })
    expect(refused.status).toBe(403)
    expect(errorCode(refused)).toBe('forbidden')
    expect(
      (
        await request(app, 'POST', path, {
          token: me.user.token,
          headers: { 'X-Presenter-Key': 'guess' },
        })
      ).status,
    ).toBe(403)

    const adopted = await request(app, 'POST', path, { token: me.user.token, headers: key })
    expect(adopted.status).toBe(200)
    expect(adopted.body).toMatchObject({
      caseId: other.caseId,
      participantId: other.participantId,
      role: 'primary',
    })
    expect((await rows('participants', other.caseId)).length).toBe(1)
    expect((await rows('events', other.caseId)).map((e) => e.type)).toEqual(['case_created'])

    const ghost = await request(app, 'POST', `/api/cases/${NO_SUCH_ID}/switch`, {
      token: me.user.token,
      headers: key,
    })
    expect(ghost.status).toBe(404)
  })

  it('own cases switch; a case where the caller is only the partner does not', async () => {
    const owner = await startVisitor(app)
    const partner = await addPartner(owner.caseId)

    const list = await request(app, 'GET', '/api/cases', { token: partner.user.token })
    expect(list.body.cases.length).toBe(0)
    const switched = await request(app, 'POST', `/api/cases/${owner.caseId}/switch`, {
      token: partner.user.token,
    })
    expect(switched.status).toBe(403)
    const start = await request(app, 'POST', '/api/sessions', {
      token: partner.user.token,
      body: {},
    })
    expect(start.body.caseId).not.toBe(owner.caseId)
    expect(start.body.created).toBe(true)

    const next = await request(app, 'POST', '/api/cases', { token: owner.user.token, body: {} })
    const back = await request(app, 'POST', `/api/cases/${owner.caseId}/switch`, {
      token: owner.user.token,
    })
    expect(back.status).toBe(200)
    expect(back.body).toMatchObject({ caseId: owner.caseId, created: false })
    const current = await request(app, 'POST', '/api/sessions', {
      token: owner.user.token,
      body: {},
    })
    expect(current.body.caseId).toBe(owner.caseId)
    expect(current.body.caseId).not.toBe(next.body.caseId)
  })
})

describe('POST /api/sessions/claim', () => {
  it('a signed-in account takes over the conversation it arrived with', async () => {
    const visitor = await startVisitor(app)
    await say(visitor.caseId, 'I was here first')
    const account = await emailUser({ admin: false })

    const claimed = await request(app, 'POST', '/api/sessions/claim', {
      token: account.token,
      body: { priorAuthUserId: visitor.user.id },
    })
    expect(claimed.status).toBe(200)
    expect(claimed.body).toMatchObject({
      caseId: visitor.caseId,
      participantId: visitor.participantId,
      authLevel: 'authenticated',
    })

    const mappings = await serviceClient()
      .from('participant_sessions')
      .select('auth_user_id')
      .eq('participant_id', visitor.participantId)
    expect((mappings.data ?? []).map((m: any) => m.auth_user_id).sort()).toEqual(
      [visitor.user.id, account.id].sort(),
    )

    const theCase = await serviceClient()
      .from('cases')
      .select('auth_level')
      .eq('id', visitor.caseId)
      .single()
    expect(theCase.data?.auth_level).toBe('authenticated')
    const email = (await rows('facts', visitor.caseId)).find((f) => f.key === 'identity.email')
    expect(email).toMatchObject({ value: account.email, source: 'system_derived', verified: false })
    expect(
      (await rows('events', visitor.caseId)).some((e) => e.type === 'customer_signed_in'),
    ).toBe(true)

    const start = await request(app, 'POST', '/api/sessions', { token: account.token, body: {} })
    expect(start.body.caseId).toBe(visitor.caseId)
  })

  it('is refused for an anonymous caller, a non-anonymous prior, or nothing to carry', async () => {
    const victim = await startVisitor(app)
    await say(victim.caseId)
    const thief = await anonymousUser()

    const anon = await request(app, 'POST', '/api/sessions/claim', {
      token: thief.token,
      body: { priorAuthUserId: victim.user.id },
    })
    expect(anon.status).toBe(403)
    expect(errorCode(anon)).toBe('forbidden')

    const account = await emailUser({ admin: false })
    const other = await emailUser({ admin: false })
    const claim = (token: string, prior: string) =>
      request(app, 'POST', '/api/sessions/claim', { token, body: { priorAuthUserId: prior } })
    expect((await claim(account.token, other.id)).status).toBe(403)
    expect((await claim(account.token, (await anonymousUser()).id)).status).toBe(404)
    expect((await claim(account.token, NO_SUCH_ID)).status).toBe(403)
    expect((await claim(account.token, account.id)).status).toBe(404)

    const mappings = await serviceClient()
      .from('participant_sessions')
      .select('auth_user_id')
      .eq('participant_id', victim.participantId)
    expect((mappings.data ?? []).map((m: any) => m.auth_user_id)).toEqual([victim.user.id])
  })
})

describe('POST /api/interest', () => {
  it('stored; a filled honeypot says ok and stores nothing; consent is required', async () => {
    const service = serviceClient()
    const user = await anonymousUser()
    const tag = crypto.randomUUID()
    const form = {
      name: 'Ada Tester',
      email: `${tag}@example.invalid`,
      interest: 'I would like to help',
      consent: true,
    }

    const stored = await request(app, 'POST', '/api/interest', { token: user.token, body: form })
    expect(stored.status).toBe(200)
    expect(stored.body).toEqual({ registered: true })
    const row = await service
      .from('collaborators')
      .select('kind, name, consent')
      .eq('email', form.email)
    expect(row.data).toEqual([{ kind: 'collaborate', name: 'Ada Tester', consent: true }])

    const botEmail = `${crypto.randomUUID()}@example.invalid`
    const bot = await request(app, 'POST', '/api/interest', {
      token: user.token,
      body: { ...form, email: botEmail, website: 'http://spam.invalid' },
    })
    expect(bot.status).toBe(200)
    expect(bot.body).toEqual({ registered: true })
    expect((await service.from('collaborators').select('id').eq('email', botEmail)).data).toEqual(
      [],
    )

    expect(
      (
        await request(app, 'POST', '/api/interest', {
          token: user.token,
          body: { ...form, consent: false },
        })
      ).status,
    ).toBe(400)
    expect((await request(app, 'POST', '/api/interest', { body: form })).status).toBe(401)
  })
})
