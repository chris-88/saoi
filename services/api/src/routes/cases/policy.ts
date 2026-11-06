import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import type { CaseRole } from '../../store/cases.ts'

/**
 * Who may do what to a case. `case-action` never read the participant's role, so a partner
 * could run every action on the primary's case (the Deno matrix pinned this as `review`).
 * This table is the fix and the source of truth: one row per action, nothing implied.
 *
 * The default is the primary customer. The partner acts through the `partner` routes on scoped
 * tasks (Invariant 7, §33), never through these, and CLAUDE.md names no case action as a
 * partner's. The administrator works through `admin`; there is no override here.
 */
export const CASE_ACTIONS = [
  'select_products',
  'decline_product',
  'confirm_requirement',
  'submit_application',
  'pause_application',
  'resume_application',
  'decide_plan',
  'invite_partner',
  'subscribe_push',
  'grant_consent',
  'confirm_form_declarations',
  'submit_health_form',
  'link_accounts',
  'revoke_accounts',
  'initiate_transfer',
  'give_feedback',
] as const

export type CaseAction = (typeof CASE_ACTIONS)[number]

const PRIMARY_ONLY = ['primary'] as const satisfies readonly CaseRole[]

export const ACTION_POLICY = {
  select_products: PRIMARY_ONLY,
  decline_product: PRIMARY_ONLY,
  confirm_requirement: PRIMARY_ONLY,
  submit_application: PRIMARY_ONLY,
  pause_application: PRIMARY_ONLY,
  resume_application: PRIMARY_ONLY,
  decide_plan: PRIMARY_ONLY,
  invite_partner: PRIMARY_ONLY,
  subscribe_push: PRIMARY_ONLY,
  grant_consent: PRIMARY_ONLY,
  confirm_form_declarations: PRIMARY_ONLY,
  submit_health_form: PRIMARY_ONLY,
  link_accounts: PRIMARY_ONLY,
  revoke_accounts: PRIMARY_ONLY,
  initiate_transfer: PRIMARY_ONLY,
  give_feedback: PRIMARY_ONLY,
} as const satisfies Record<CaseAction, readonly CaseRole[]>

/**
 * Who may drive the conversation. The primary only, as `saoirse-turn` always required: a partner
 * has a seat on the case but never talks to Saoirse on the primary's behalf (Invariant 7). Kept
 * beside the action table rather than in it because a turn is not a `case-action`.
 */
export const TURN_ROLES: readonly CaseRole[] = PRIMARY_ONLY

export const requireTurnRole = createMiddleware<AppEnv>(async (c, next) => {
  if (!TURN_ROLES.includes(c.get('caseAccess').role)) {
    throw new ApiError('forbidden', 'Only the person who started this case can do that.')
  }
  await next()
})

export const mayAct = (role: CaseRole, action: CaseAction): boolean =>
  (ACTION_POLICY[action] as readonly CaseRole[]).includes(role)

/**
 * Refuses a caller whose role the policy does not list for `action`. Runs after
 * `requireCaseSeat`, so the caller is known to be on the case: 403, not 404.
 */
export const requireRole = (action: CaseAction) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!mayAct(c.get('caseAccess').role, action)) {
      throw new ApiError('forbidden', 'Only the person who started this case can do that.')
    }
    await next()
  })
