import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { requireCaseAccess } from '../../middleware/requireCaseAccess.ts'
import { caseActionRoutes } from './actions.ts'
import { eventsRoutes } from './events.ts'
import { historyRoutes } from './history.ts'
import { snapshotRoutes } from './snapshot.ts'

/** Everything under `/api/cases/:caseId`. The access check is mounted once, here. */
export const caseRoutes = new OpenAPIHono<AppEnv>()

// The action routes bring their own guard (any seat, then the role policy), so they go first;
// the reads below keep `requireCaseAccess`, which admits the primary customer only.
caseRoutes.route('/', caseActionRoutes)
caseRoutes.use('/api/cases/:caseId/*', requireCaseAccess)
caseRoutes.route('/', snapshotRoutes)
caseRoutes.route('/', historyRoutes)
caseRoutes.route('/', eventsRoutes)
