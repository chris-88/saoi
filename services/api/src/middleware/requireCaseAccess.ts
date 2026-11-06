import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { AppEnv } from '../context.ts'
import { ApiError } from '../errors.ts'
import { CASE_ROLES, type CaseRole } from '../store/cases.ts'

const caseIdSchema = z.uuid()

/**
 * Loads the authenticated user's access to the case once and puts it on the context as
 * `caseAccess`, role included; handlers and `requireRole` read it from there. Mount on
 * `/api/cases/:caseId/*`, after `requireAuth`.
 *
 * 404 rather than 403 when there is none: whether a case exists is not for a stranger to learn.
 * What a caller *with* a seat may do is a separate question, answered by `requireRole`.
 */
export const caseAccessFor = (roles: readonly CaseRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const caseId = caseIdSchema.safeParse(c.req.param('caseId'))
    // Checked here because this runs before the route's own validation, and the store must
    // never be asked about something that is not a uuid.
    if (!caseId.success) throw new ApiError('bad_request', 'The request is not valid.')

    const access = await c.get('store').caseAccess(c.get('user').id, caseId.data, roles)
    if (access === null) throw new ApiError('not_found', 'That case does not exist.')

    c.set('caseAccess', access)
    await next()
  })

/** The read routes: the primary customer only (a partner never reads the case, invariant 7). */
export const requireCaseAccess = caseAccessFor(['primary'])

/** The action routes: any seat, or the console's administrator. `requireRole` then decides. */
export const requireCaseSeat = caseAccessFor(CASE_ROLES)
