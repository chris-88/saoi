import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { requireCaseSeat } from '../../middleware/requireCaseAccess.ts'
import { applicationRoutes } from './applications.ts'
import { consentRoutes } from './consent.ts'
import { feedbackRoutes } from './feedback.ts'
import { formRoutes } from './forms.ts'
import { inviteRoutes } from './invites.ts'
import { linkedAccountRoutes } from './linkedAccounts.ts'
import { planRoutes } from './plans.ts'
import { productRoutes } from './products.ts'
import { pushSubscriptionRoutes } from './pushSubscriptions.ts'
import { transferRoutes } from './transfers.ts'

/**
 * What the customer commits by tapping: the port of `case-action` (Invariant 1, §27, §48).
 *
 * Writes only. Any seat on the case gets past `requireCaseSeat` (a stranger gets 404 here, as
 * on the read routes); each route then names its action in `requireRole`, and `policy.ts`
 * decides whether that seat's role may take it. The read routes behind this keep the stricter
 * `requireCaseAccess` (primary only).
 */
export const caseActionRoutes = new OpenAPIHono<AppEnv>()

caseActionRoutes.on('POST', '/api/cases/:caseId/*', requireCaseSeat)
caseActionRoutes.route('/', productRoutes)
caseActionRoutes.route('/', applicationRoutes)
caseActionRoutes.route('/', consentRoutes)
caseActionRoutes.route('/', formRoutes)
caseActionRoutes.route('/', planRoutes)
caseActionRoutes.route('/', inviteRoutes)
caseActionRoutes.route('/', linkedAccountRoutes)
caseActionRoutes.route('/', transferRoutes)
caseActionRoutes.route('/', pushSubscriptionRoutes)
caseActionRoutes.route('/', feedbackRoutes)
