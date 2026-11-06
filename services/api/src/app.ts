import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv, RouteConfig } from './context.ts'
import { ApiError, errorBody } from './errors.ts'
import { createLogger, type Logger } from './log.ts'
import { accessLog } from './middleware/accessLog.ts'
import { requireAuth, type TokenVerifier } from './middleware/auth.ts'
import { rateLimit } from './middleware/rateLimit.ts'
import { REQUEST_ID_HEADER, requestId } from './middleware/requestId.ts'
import { caseRoutes } from './routes/cases/index.ts'
import { turnRoutes, type TurnRouteOptions } from './routes/cases/turns.ts'
import { DEFAULT_FEED_OPTIONS, type FeedOptions } from './routes/cases/feed.ts'
import { healthRoutes } from './routes/health.ts'
import { partnerRoutes } from './routes/partner/index.ts'
import { adminRoutes } from './routes/admin/index.ts'
import type { AdminStores } from './store/admin/index.ts'
import { sessionRoutes } from './routes/session/index.ts'
import { documentRoutes } from './routes/documents/index.ts'
import type { CaseStore } from './store/cases.ts'
import type { PartnerStore } from './store/partners.ts'
import type { SessionStore } from './store/sessions.ts'
import type { UploadStore } from './store/uploads.ts'

export type AppDeps = {
  readonly verifyToken: TokenVerifier
  readonly store: CaseStore
  readonly sessions: SessionStore
  readonly partners: PartnerStore
  readonly uploads: UploadStore
  /** The admin API's stores. Unset, `/api/admin/*` is not mounted. */
  readonly admin?: AdminStores
  /** The conversation turn. Unset, `POST /api/cases/:caseId/turns` is not mounted. */
  readonly turn?: TurnRouteOptions
  readonly config?: Partial<RouteConfig>
  readonly version: string
  /** Browser origins allowed by CORS. Empty or unset denies every origin. */
  readonly corsOrigins?: readonly string[]
  readonly rateLimit?: { readonly max: number; readonly windowMs: number }
  readonly feed?: Partial<Pick<FeedOptions, 'pollMs' | 'keepAliveMs'>>
  readonly log?: Logger
}

const DEFAULT_CONFIG: RouteConfig = { presenterKey: '', audienceMaxCases: 50 }
const DEFAULT_RATE_LIMIT = { max: 120, windowMs: 60_000 }

/**
 * Builds the app and nothing else: no listening, no environment. Order matters: request id,
 * headers, CORS and logging wrap everything; auth and the rate limit guard `/api/*`; each
 * router adds its own guards (see `routes/cases/index.ts`).
 */
export function createApp(deps: AppDeps) {
  const log = deps.log ?? createLogger()
  const origins = new Set(deps.corsOrigins ?? [])

  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const details = result.error.issues.map((issue) => issue.message)
        const error = new ApiError('bad_request', 'The request is not valid.', { details })
        return c.json(errorBody(error, c.get('requestId')), 400)
      }
      return undefined
    },
  })

  app.use('*', requestId)
  app.use('*', async (c, next) => {
    c.set('log', log)
    c.set('store', deps.store)
    c.set('sessions', deps.sessions)
    c.set('partners', deps.partners)
    c.set('uploads', deps.uploads)
    c.set('config', { ...DEFAULT_CONFIG, ...deps.config })
    c.set('feedOptions', { ...DEFAULT_FEED_OPTIONS, ...deps.feed })
    await next()
  })
  app.use(
    '*',
    secureHeaders({
      // A JSON API: nothing it returns should ever load or run anything.
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  )
  app.use(
    '*',
    cors({
      origin: (origin) => (origins.has(origin) ? origin : null),
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'Last-Event-ID',
        'X-Presenter-Key',
        REQUEST_ID_HEADER,
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
      maxAge: 600,
    }),
  )
  app.use('*', accessLog)

  app.onError((error, c) => {
    const id = c.get('requestId')
    if (error instanceof ApiError) {
      if (error.status >= 500 || error.cause !== undefined) {
        log.error('api error', { requestId: id, code: error.code, cause: error.cause })
      }
      return c.json(errorBody(error, id), error.status as ContentfulStatusCode)
    }
    if (error instanceof HTTPException && error.status < 500) {
      return c.json(errorBody(new ApiError('bad_request', 'The request is not valid.'), id), 400)
    }
    // The message can carry a table name or a query: it goes to the log, never to the caller.
    log.error('unhandled error', { requestId: id, error })
    return c.json(errorBody(new ApiError('internal', 'Something went wrong.'), id), 500)
  })
  app.notFound((c) =>
    c.json(errorBody(new ApiError('not_found', 'No such route.'), c.get('requestId')), 404),
  )

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'A Supabase Auth access token (anonymous or signed in).',
  })

  app.route('/', healthRoutes(deps.version))

  // The document and its `/api` alias are public and sit ahead of the auth guard, so a reverse
  // proxy that forwards `/api/*` needs no rewrite for either.
  const info = {
    title: 'Saoirse API',
    version: deps.version,
    description: 'Business logic for Saoirse. The public app reads cases through this service.',
  }
  app.doc('/openapi.json', { openapi: '3.1.0', info })
  app.doc('/api/openapi.json', { openapi: '3.1.0', info })

  app.use('/api/*', requireAuth(deps.verifyToken))
  app.use('/api/*', rateLimit(deps.rateLimit ?? DEFAULT_RATE_LIMIT))
  // Order matters. The session and document routes sit under `/api/cases/...` but have their own
  // access rules (a presenter may switch into any case; a partner may upload), so they are
  // mounted before `caseRoutes`, whose `requireCaseAccess` admits the primary customer only.
  app.route('/', sessionRoutes)
  app.route('/', partnerRoutes)
  app.route('/', documentRoutes)
  // Before `caseRoutes`, whose guard admits the primary only: a partner is refused here with 403.
  if (deps.turn) app.route('/', turnRoutes(deps.turn))
  app.route('/', caseRoutes)
  if (deps.admin) app.route('/', adminRoutes(deps.admin))

  return app
}
