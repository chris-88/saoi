/**
 * The case action routes against a real database: who may call each action, and what it writes.
 *
 * This is the Node counterpart of `supabase/functions/integration/case-action.integration.ts`,
 * which pinned the Edge Function's matrix, including the hole where the participant's role was
 * never read. Here the policy in `src/routes/cases/policy.ts` is the rule, so a partner on the
 * case is refused on every action, and the two transactions (`submit_application_tx`,
 * `invite_partner_tx`) are exercised for real.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  addPartner,
  buildApp,
  emailUser,
  errorCode,
  request,
  rows,
  serviceClient,
  startVisitor,
  type Participant,
  type TestUser,
} from './harness.ts'

const app = buildApp()
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

const TABLES = [
  'applications',
  'events',
  'facts',
  'product_interests',
  'plans',
  'consents',
  'linked_accounts',
  'transfers',
  'push_subscriptions',
  'feedback',
  'participants',
  'tokens',
] as const

async function counts(caseId: string): Promise<Record<string, number>> {
  const service = serviceClient()
  const out: Record<string, number> = {}
  for (const table of TABLES) {
    const result = await service
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('case_id', caseId)
    out[table] = result.error ? -1 : (result.count ?? 0)
  }
  const apps = await service.from('applications').select('id').eq('case_id', caseId)
  const ids = (apps.data ?? []).map((row: { id: string }) => row.id)
  const confirmations = ids.length
    ? await service
        .from('application_confirmations')
        .select('*', { count: 'exact', head: true })
        .in('application_id', ids)
    : { count: 0 }
  out['application_confirmations'] = confirmations.count ?? 0
  return out
}

type World = {
  caseId: string
  primary: Participant
  partner: Participant
  stranger: Participant
  admin: TestUser
  accountApplicationId: string
  protectionApplicationId: string
  planId: string
  saoirseMessageId: string
  linkedAccountId?: string
}

async function buildWorld(options: { linked?: boolean } = {}): Promise<World> {
  const service = serviceClient()
  const primary = await startVisitor(app)
  const partner = await addPartner(primary.caseId)
  const stranger = await startVisitor(app)
  const admin = await emailUser({ admin: true })

  const started = await request(app, 'POST', `/api/cases/${primary.caseId}/products/select`, {
    token: primary.user.token,
    body: { products: [{ product: 'current_account' }, { product: 'protection' }] },
  })
  if (started.status !== 200) throw new Error(`select: ${JSON.stringify(started.body)}`)
  const applications = started.body.applications as { id: string; product: string }[]
  const accountApplicationId = applications.find((a) => a.product === 'current_account')?.id
  const protectionApplicationId = applications.find((a) => a.product === 'protection')?.id
  if (!accountApplicationId || !protectionApplicationId) throw new Error('applications missing')

  const plan = await service
    .from('plans')
    .insert({
      case_id: primary.caseId,
      goal: 'buy_first_home',
      title: 'First home',
      status: 'draft',
    })
    .select('id')
    .single()
  if (plan.error) throw new Error(`plan: ${plan.error.message}`)

  const saoirse = await service
    .from('messages')
    .insert({ case_id: primary.caseId, role: 'assistant', content: 'Hello, I am Saoirse.' })
    .select('id')
    .single()
  if (saoirse.error) throw new Error(`saoirse message: ${saoirse.error.message}`)

  let linkedAccountId: string | undefined
  if (options.linked === true) {
    const linked = await request(app, 'POST', `/api/cases/${primary.caseId}/linked-accounts`, {
      token: primary.user.token,
      body: { bank: 'aib', scope: ['balances', 'transactions', 'payments'] },
    })
    if (linked.status !== 201) throw new Error(`link: ${JSON.stringify(linked.body)}`)
    const accounts = await service
      .from('linked_accounts')
      .select('id')
      .eq('case_id', primary.caseId)
      .limit(1)
    linkedAccountId = accounts.data?.[0]?.id
  }

  return {
    caseId: primary.caseId,
    primary,
    partner,
    stranger,
    admin,
    accountApplicationId,
    protectionApplicationId,
    planId: plan.data.id,
    saoirseMessageId: saoirse.data.id,
    ...(linkedAccountId === undefined ? {} : { linkedAccountId }),
  }
}

type Row = {
  action: string
  linked?: boolean
  path: (w: World) => string
  body: (w: World) => unknown
  primary: number
  verify?: (w: World) => Promise<void>
}

const ROWS: Row[] = [
  {
    action: 'select_products',
    path: () => '/products/select',
    body: () => ({ products: [{ product: 'credit_card' }] }),
    primary: 200,
    verify: async (w) => {
      expect((await rows('applications', w.caseId)).some((a) => a.product === 'credit_card')).toBe(
        true,
      )
    },
  },
  {
    action: 'decline_product',
    path: () => '/products/personal_loan/decline',
    body: () => ({}),
    primary: 200,
    verify: async (w) => {
      const interests = await rows('product_interests', w.caseId)
      expect(interests.some((i) => i.product === 'personal_loan' && i.status === 'declined')).toBe(
        true,
      )
    },
  },
  {
    action: 'confirm_requirement',
    path: (w) => `/applications/${w.accountApplicationId}/confirm`,
    body: () => ({ requirementId: 'terms' }),
    primary: 200,
  },
  {
    action: 'submit_application',
    path: (w) => `/applications/${w.accountApplicationId}/submit`,
    body: () => ({ confirmations: [] }),
    primary: 409,
  },
  {
    action: 'pause_application',
    path: (w) => `/applications/${w.accountApplicationId}/pause`,
    body: () => ({}),
    primary: 200,
    verify: async (w) => {
      const apps = await rows('applications', w.caseId)
      expect(apps.find((a) => a.id === w.accountApplicationId)?.state).toBe('paused')
    },
  },
  {
    action: 'resume_application',
    path: (w) => `/applications/${w.accountApplicationId}/resume`,
    body: () => ({}),
    primary: 409,
  },
  {
    action: 'decide_plan',
    path: (w) => `/plans/${w.planId}/decisions`,
    body: () => ({ decision: 'keep' }),
    primary: 200,
    verify: async (w) => {
      const plans = await rows('plans', w.caseId)
      expect(plans.find((p) => p.id === w.planId)?.status).toBe('active')
    },
  },
  {
    action: 'invite_partner',
    path: () => '/invites',
    body: () => ({ name: 'Emma' }),
    primary: 201,
  },
  {
    action: 'subscribe_push',
    path: () => '/push-subscriptions',
    body: () => ({
      endpoint: `https://push.example.invalid/${crypto.randomUUID()}`,
      p256dh: 'k',
      auth: 'a',
    }),
    primary: 201,
  },
  {
    action: 'grant_consent',
    path: (w) => `/applications/${w.protectionApplicationId}/consent`,
    body: () => ({ requirementId: 'health-consent' }),
    primary: 200,
  },
  {
    action: 'confirm_form_declarations',
    path: (w) => `/applications/${w.accountApplicationId}/form-declarations`,
    body: () => ({ fieldIds: ['1'] }),
    primary: 400,
  },
  {
    action: 'submit_health_form',
    path: (w) => `/applications/${w.protectionApplicationId}/health-answers`,
    body: () => ({ values: [{ key: 'protection.health.smoker', value: false }] }),
    primary: 403,
  },
  {
    action: 'link_accounts',
    path: () => '/linked-accounts',
    body: () => ({ bank: 'aib', scope: ['balances'] }),
    primary: 201,
    verify: async (w) => {
      expect((await rows('linked_accounts', w.caseId)).length).toBeGreaterThan(0)
    },
  },
  {
    action: 'revoke_accounts',
    linked: true,
    path: () => '/linked-accounts/revoke',
    body: () => ({}),
    primary: 200,
    verify: async (w) => {
      expect((await rows('linked_accounts', w.caseId)).every((a) => a.revoked_at !== null)).toBe(
        true,
      )
    },
  },
  {
    action: 'initiate_transfer',
    linked: true,
    path: () => '/transfers',
    body: (w) => ({
      fromAccountId: w.linkedAccountId,
      toApplicationId: w.accountApplicationId,
      amount: 10,
      cadence: 'once',
    }),
    primary: 201,
  },
  {
    action: 'give_feedback',
    path: () => '/feedback',
    body: (w) => ({ kind: 'turn', messageId: w.saoirseMessageId, rating: 1 }),
    primary: 201,
  },
]

async function attempt(w: World, row: Row, token: string | null) {
  const before = await counts(w.caseId)
  const reply = await request(app, 'POST', `/api/cases/${w.caseId}${row.path(w)}`, {
    token,
    body: row.body(w),
  })
  const after = await counts(w.caseId)
  const changed = Object.keys(after).filter((table) => before[table] !== after[table])
  return { reply, changed }
}

describe('case action routes: the role matrix', () => {
  it('covers every action', () => {
    expect(ROWS.length).toBe(16)
  })

  for (const row of ROWS) {
    describe(row.action, () => {
      it('refuses no token (401), a stranger (404), a partner (403) and an administrator (403), writing nothing', async () => {
        const w = await buildWorld({ linked: row.linked === true })

        const none = await attempt(w, row, null)
        expect(none.reply.status).toBe(401)
        expect(none.changed).toEqual([])

        const stranger = await attempt(w, row, w.stranger.user.token)
        expect(stranger.reply.status).toBe(404)
        expect(errorCode(stranger.reply)).toBe('not_found')
        expect(stranger.changed).toEqual([])

        const partner = await attempt(w, row, w.partner.user.token)
        expect(partner.reply.status).toBe(403)
        expect(errorCode(partner.reply)).toBe('forbidden')
        expect(partner.changed).toEqual([])

        const admin = await attempt(w, row, w.admin.token)
        expect(admin.reply.status).toBe(403)
        expect(errorCode(admin.reply)).toBe('forbidden')
        expect(admin.changed).toEqual([])
      })

      it('gives the primary the business outcome', async () => {
        const w = await buildWorld({ linked: row.linked === true })
        const got = await attempt(w, row, w.primary.user.token)
        expect(got.reply.status, JSON.stringify(got.reply.body)).toBe(row.primary)
        if (row.primary < 300) {
          expect(got.changed.length).toBeGreaterThan(0)
          await row.verify?.(w)
        } else {
          expect(got.changed).toEqual([])
        }
      })
    })
  }

  it('an application on another case is 404 for a caller who has a seat only on their own', async () => {
    const w = await buildWorld()
    // The id belongs to w's case; the stranger's own case does not contain it.
    const reply = await request(
      app,
      'POST',
      `/api/cases/${w.stranger.caseId}/applications/${w.accountApplicationId}/pause`,
      { token: w.stranger.user.token, body: {} },
    )
    expect(reply.status).toBe(404)
  })
})

describe('submit_application_tx', () => {
  it('submits a ready application and writes its event', async () => {
    const w = await buildWorld()
    // Forced: a real application is `ready` only once its journey is complete.
    await serviceClient()
      .from('applications')
      .update({ state: 'ready' })
      .eq('id', w.accountApplicationId)

    const got = await request(
      app,
      'POST',
      `/api/cases/${w.caseId}/applications/${w.accountApplicationId}/submit`,
      { token: w.primary.user.token, body: { confirmations: [] } },
    )
    expect(got.status, JSON.stringify(got.body)).toBe(200)
    expect(got.body.summary).toMatch(/submitted\.$/)

    const application = (await rows('applications', w.caseId)).find(
      (a) => a.id === w.accountApplicationId,
    )
    expect(application.state).toBe('submitted')
    expect(application.submitted_at).not.toBeNull()
    expect(
      (await rows('events', w.caseId)).some(
        (e) => e.type === 'application_submitted' && e.application_id === w.accountApplicationId,
      ),
    ).toBe(true)
  })

  it('writes the state, the confirmations and the events together', async () => {
    const w = await buildWorld()
    const service = serviceClient()
    await service.from('applications').update({ state: 'ready' }).eq('id', w.accountApplicationId)

    const result = await service.rpc('submit_application_tx', {
      p_case_id: w.caseId,
      p_application_id: w.accountApplicationId,
      p_participant_id: w.primary.participantId,
      p_confirmations: ['terms'],
      p_from_state: 'ready',
      p_to_state: 'submitted',
      p_events: [{ type: 'application_submitted', actor: 'customer', payload: {} }],
    })
    expect(result.error).toBeNull()
    expect(result.data).toBe(true)

    const confirmations = await service
      .from('application_confirmations')
      .select('requirement_id')
      .eq('application_id', w.accountApplicationId)
    expect((confirmations.data ?? []).map((r) => r.requirement_id)).toContain('terms')
    const application = (await rows('applications', w.caseId)).find(
      (a) => a.id === w.accountApplicationId,
    )
    expect(application.state).toBe('submitted')
  })

  it('writes nothing at all when the application is no longer in the state the caller read', async () => {
    const w = await buildWorld()
    const service = serviceClient()
    const before = await counts(w.caseId)

    const result = await service.rpc('submit_application_tx', {
      p_case_id: w.caseId,
      p_application_id: w.accountApplicationId,
      p_participant_id: w.primary.participantId,
      p_confirmations: ['terms'],
      p_from_state: 'ready', // it is `waiting_customer`
      p_to_state: 'submitted',
      p_events: [{ type: 'application_submitted', actor: 'customer', payload: {} }],
    })
    expect(result.error).toBeNull()
    expect(result.data).toBe(false)
    expect(await counts(w.caseId)).toEqual(before)
  })

  it('rolls the whole submission back when a later write fails', async () => {
    const w = await buildWorld()
    const service = serviceClient()
    await service.from('applications').update({ state: 'ready' }).eq('id', w.accountApplicationId)
    const before = await counts(w.caseId)

    // An actor the events table refuses, after the state change and the confirmation.
    const result = await service.rpc('submit_application_tx', {
      p_case_id: w.caseId,
      p_application_id: w.accountApplicationId,
      p_participant_id: w.primary.participantId,
      p_confirmations: ['terms'],
      p_from_state: 'ready',
      p_to_state: 'submitted',
      p_events: [{ type: 'application_submitted', actor: 'nobody', payload: {} }],
    })
    expect(result.error).not.toBeNull()

    expect(await counts(w.caseId)).toEqual(before)
    const application = (await rows('applications', w.caseId)).find(
      (a) => a.id === w.accountApplicationId,
    )
    expect(application.state).toBe('ready')
  })
})

describe('invite_partner_tx', () => {
  it('reuses the partner, voids the earlier link and stores only hashes', async () => {
    const w = await buildWorld()
    const invite = () =>
      request(app, 'POST', `/api/cases/${w.caseId}/invites`, {
        token: w.primary.user.token,
        body: { name: 'Emma' },
      })

    const first = await invite()
    expect(first.status).toBe(201)
    const second = await invite()
    expect(second.status).toBe(201)

    const tokenOf = (reply: { body: { inviteUrl: string } }) =>
      reply.body.inviteUrl.split('/#/join/')[1] ?? ''
    expect(tokenOf(first)).not.toBe(tokenOf(second))

    const tokens = (await rows('tokens', w.caseId)).filter((t) => t.kind === 'partner_invite')
    const byHash = new Map(tokens.map((t) => [t.token_hash, t]))
    expect(byHash.get(sha(tokenOf(first)))?.consumed_at).not.toBeNull()
    expect(byHash.get(sha(tokenOf(second)))?.consumed_at).toBeNull()
    expect(byHash.get(sha(tokenOf(second)))?.expires_at).toBeNull()
    // The raw token is nowhere in the table.
    expect(JSON.stringify(tokens)).not.toContain(tokenOf(second))

    // One partner participant, renamed, not a second one.
    const partners = (await rows('participants', w.caseId)).filter((p) => p.role === 'partner')
    expect(partners).toHaveLength(1)
    expect(partners[0].display_name).toBe('Emma')
    expect(
      (await rows('events', w.caseId)).filter((e) => e.type === 'partner_invited'),
    ).toHaveLength(2)
  })

  it('a link minted by the route opens the partner experience', async () => {
    const w = await buildWorld()
    const invite = await request(app, 'POST', `/api/cases/${w.caseId}/invites`, {
      token: w.primary.user.token,
      body: { name: 'Sam' },
    })
    const token = (invite.body.inviteUrl as string).split('/#/join/')[1] ?? ''
    const phone = await startVisitor(app)
    const joined = await request(app, 'POST', '/api/partner/join', {
      token: phone.user.token,
      body: { token },
    })
    expect(joined.status).toBe(200)
    expect(joined.body.partnerName).toBe('Sam')
  })
})
