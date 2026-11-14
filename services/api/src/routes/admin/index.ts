import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { requireAdmin } from '../../middleware/requireAdmin.ts'
import type { AdminStores } from '../../store/admin/index.ts'
import { aiUsageRoutes } from './ai-usage.ts'
import { casesRoutes } from './cases.ts'
import { catalogueRoutes } from './catalogue.ts'
import { configRoutes } from './config.ts'
import { formsRoutes } from './forms.ts'
import { inspectRoutes } from './inspect.ts'
import { marketRoutes } from './market.ts'
import { overviewRoutes } from './overview.ts'
import { pushRoutes } from './push.ts'
import { simulateRoutes } from './simulate.ts'

/**
 * The presenter console's API (§37 to §44): its own family with its own guard. Everything under
 * `/api/admin/*` passes `requireAdmin` (a row in `admin_users`) BEFORE any body is validated,
 * so a stranger learns nothing about request shapes. One router file per family.
 */
export function adminRoutes(stores: AdminStores) {
  const router = new OpenAPIHono<AppEnv>()
  router.use('/api/admin/*', async (c, next) => {
    c.set('admin', stores)
    await next()
  })
  router.use('/api/admin/*', requireAdmin)
  router.route('/', overviewRoutes)
  router.route('/', aiUsageRoutes)
  router.route('/', casesRoutes)
  router.route('/', inspectRoutes)
  router.route('/', simulateRoutes)
  router.route('/', pushRoutes)
  router.route('/', configRoutes)
  router.route('/', catalogueRoutes)
  router.route('/', formsRoutes)
  router.route('/', marketRoutes)
  return router
}
