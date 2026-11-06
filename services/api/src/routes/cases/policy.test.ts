import { describe, expect, it } from 'vitest'
import { CASE_ID, PARTNER_ID, tokenFor } from '../../testing.ts'
import { writesOf } from '../../testing.actions.ts'
import { ACTION_POLICY, CASE_ACTIONS, mayAct, type CaseAction } from './policy.ts'
import {
  APP_ID,
  LINKED_ID,
  MESSAGE_ID,
  PLAN_ID,
  PROTECTION_APP_ID,
  world,
} from './actions.fixture.ts'

/**
 * The role matrix: every action, five callers. This is the Node counterpart of the Deno matrix
 * in `supabase/functions/integration/case-action.integration.ts`, and it is where the partner
 * hole is closed: a partner on the case is refused (403) on every action and nothing is written.
 *
 *   no token  401    stranger (no seat)  404    partner  403    administrator  403
 *   primary   the business outcome (what `primary` says below)
 */

type Row = {
  readonly action: CaseAction
  readonly path: string
  readonly body: unknown
  /** The primary's outcome on this world. */
  readonly primary: number
}

const ROWS: readonly Row[] = [
  {
    action: 'select_products',
    path: '/products/select',
    body: { products: [{ product: 'credit_card' }] },
    primary: 200,
  },
  { action: 'decline_product', path: '/products/personal_loan/decline', body: {}, primary: 200 },
  {
    action: 'confirm_requirement',
    path: `/applications/${APP_ID}/confirm`,
    body: { requirementId: 'terms' },
    primary: 200,
  },
  {
    action: 'submit_application',
    path: `/applications/${APP_ID}/submit`,
    body: { confirmations: [] },
    // Not `ready`: the state machine refuses before anything is written.
    primary: 409,
  },
  { action: 'pause_application', path: `/applications/${APP_ID}/pause`, body: {}, primary: 200 },
  // Not paused, so there is nothing to resume.
  { action: 'resume_application', path: `/applications/${APP_ID}/resume`, body: {}, primary: 409 },
  {
    action: 'decide_plan',
    path: `/plans/${PLAN_ID}/decisions`,
    body: { decision: 'keep' },
    primary: 200,
  },
  { action: 'invite_partner', path: '/invites', body: { name: 'Emma' }, primary: 201 },
  {
    action: 'subscribe_push',
    path: '/push-subscriptions',
    body: { endpoint: 'https://push.example.invalid/abc', p256dh: 'k', auth: 'a' },
    primary: 201,
  },
  {
    action: 'grant_consent',
    path: `/applications/${PROTECTION_APP_ID}/consent`,
    body: { requirementId: 'health-consent' },
    primary: 200,
  },
  {
    action: 'confirm_form_declarations',
    path: `/applications/${APP_ID}/form-declarations`,
    body: { fieldIds: ['1'] },
    // A current account has no form behind it.
    primary: 400,
  },
  {
    action: 'submit_health_form',
    path: `/applications/${PROTECTION_APP_ID}/health-answers`,
    body: { values: [{ key: 'health.smoker', value: false }] },
    // The consent has not been granted on this application yet.
    primary: 403,
  },
  {
    action: 'link_accounts',
    path: '/linked-accounts',
    body: { bank: 'revolut', scope: ['balances'] },
    primary: 201,
  },
  { action: 'revoke_accounts', path: '/linked-accounts/revoke', body: {}, primary: 200 },
  {
    action: 'initiate_transfer',
    path: '/transfers',
    body: { fromAccountId: LINKED_ID, toApplicationId: APP_ID, amount: 10, cadence: 'once' },
    primary: 201,
  },
  {
    action: 'give_feedback',
    path: '/feedback',
    body: { kind: 'turn', messageId: MESSAGE_ID, rating: 1 },
    primary: 201,
  },
]

describe('the action-to-role table', () => {
  it('has a row in this matrix for every action', () => {
    expect(ROWS.map((row) => row.action).sort()).toEqual([...CASE_ACTIONS].sort())
    expect(CASE_ACTIONS).toHaveLength(16)
  })

  it('lists primary only: no case action is a partner’s or an administrator’s', () => {
    for (const action of CASE_ACTIONS) {
      expect(ACTION_POLICY[action], action).toEqual(['primary'])
      expect(mayAct('primary', action)).toBe(true)
      expect(mayAct('partner', action)).toBe(false)
      expect(mayAct('admin', action)).toBe(false)
    }
  })
})

describe.each(ROWS)('$action', (row) => {
  it('refuses no token (401), a stranger (404), a partner (403) and an administrator (403), writing nothing', async () => {
    const { call, actions } = world()

    expect((await call('none', row.path, row.body)).status).toBe(401)
    expect((await call('stranger', row.path, row.body)).status).toBe(404)

    const partner = await call('partner', row.path, row.body)
    expect(partner.status).toBe(403)
    expect(partner.body).toMatchObject({ ok: false, error: { code: 'forbidden' } })

    const admin = await call('admin', row.path, row.body)
    expect(admin.status).toBe(403)
    expect(admin.body).toMatchObject({ ok: false, error: { code: 'forbidden' } })

    expect(actions.calls).toEqual([])
  })

  it('gives the primary the business outcome', async () => {
    const { call, actions } = world()
    const got = await call('primary', row.path, row.body)
    expect(got.status).toBe(row.primary)
    if (row.primary < 300) {
      expect(writesOf(actions).length).toBeGreaterThan(0)
    } else {
      expect(writesOf(actions)).toEqual([])
    }
  })

  it('refuses a partner before it looks at the body', async () => {
    const { call } = world()
    // An invalid body must not be able to tell a partner anything about the case.
    expect((await call('partner', row.path, { nonsense: true })).status).toBe(403)
  })
})

describe('the seat check', () => {
  it('leaves the read routes primary only: a partner cannot read the case', async () => {
    const { app } = world()
    const response = await app.request(`/api/cases/${CASE_ID}/snapshot`, {
      headers: { Authorization: `Bearer ${await tokenFor({ sub: PARTNER_ID })}` },
    })
    expect(response.status).toBe(404)
  })
})
