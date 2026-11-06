import type { AuthUser } from './middleware/auth.ts'
import type { CaseAccess, CaseStore } from './store/cases.ts'
import type { FeedOptions } from './routes/cases/feed.ts'
import type { Logger } from './log.ts'
import type { Identity, SessionStore } from './store/sessions.ts'
import type { PartnerSession, PartnerStore } from './store/partners.ts'
import type { UploadStore } from './store/uploads.ts'
import type { AdminStores } from './store/admin/index.ts'

/** Settings the routes read that are not secrets of the data layer. */
export type RouteConfig = {
  /** Empty means nobody is a presenter. */
  readonly presenterKey: string
  /** Customer cases a day before `POST /api/sessions` refuses another. */
  readonly audienceMaxCases: number
}

/** What middleware puts on the Hono context. Every router is typed with this. */
export type AppEnv = {
  Variables: {
    requestId: string
    log: Logger
    store: CaseStore
    sessions: SessionStore
    partners: PartnerStore
    uploads: UploadStore
    config: RouteConfig
    feedOptions: FeedOptions
    user: AuthUser
    caseAccess: CaseAccess
    /** The caller's account record; set by `requireIdentity`. */
    identity: Identity
    /** The caller's partner seat; set by `requirePartner`. */
    partner: PartnerSession
    /** The admin API's stores; set by `adminRoutes` for `/api/admin/*` only. */
    admin: AdminStores
  }
}
