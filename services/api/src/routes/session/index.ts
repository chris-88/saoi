import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { caseListRoutes } from './cases.ts'
import { claimRoutes } from './claim.ts'
import { interestRoutes } from './interest.ts'
import { startRoutes } from './start.ts'

/**
 * Which conversation a browser is in: start, list, new, switch, claim, and the interest form
 * (the `session` Edge Function, one route per action). Each route guards itself with
 * `requireIdentity`; the case-scoped access check of `routes/cases` does not apply here,
 * because switching is how a browser gets access in the first place.
 */
export const sessionRoutes = new OpenAPIHono<AppEnv>()
sessionRoutes.route('/', startRoutes)
sessionRoutes.route('/', claimRoutes)
sessionRoutes.route('/', caseListRoutes)
sessionRoutes.route('/', interestRoutes)
