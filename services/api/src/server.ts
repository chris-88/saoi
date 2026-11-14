import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { loadEnv, parseOrigins } from './env.ts'
import { createLogger } from './log.ts'
import { createTokenVerifier } from './middleware/auth.ts'
import { createServiceClient } from './store/client.ts'
import { supabaseStore } from './store/cases.ts'
import { supabasePartnerStore } from './store/partners.ts'
import { supabaseSessionStore } from './store/sessions.ts'
import { supabaseUploadStore } from './store/uploads.ts'
import { supabasePlanStore } from './store/plans.ts'
import { supabaseCalculatorRunStore } from './store/calculator-runs.ts'
import { supabaseMarketStore } from './store/market.ts'
import { supabaseAlertStore } from './store/alerts.ts'
import { supabaseHoldingStore } from './store/holdings.ts'
import { supabaseTelemetryStore } from './store/telemetry.ts'
import { createAdminStores } from './store/admin/factory.ts'
import { anthropicModels, fixtureModels } from './turn/generate.ts'
import { createTurnRunner } from './turn/turn.ts'

const log = createLogger()
const env = loadEnv()
const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// The model is chosen once, here, and handed to the turn: nothing downstream reads the environment.
const turnModels =
  env.LLM_PROVIDER === 'fixture'
    ? fixtureModels({ fixture: env.LLM_FIXTURE })
    : env.ANTHROPIC_API_KEY === undefined
      ? () => {
          throw new Error('ANTHROPIC_API_KEY is not set.')
        }
      : anthropicModels({
          apiKey: env.ANTHROPIC_API_KEY,
          saoiModel: env.SAOI_MODEL,
          gateModel: env.GATE_MODEL,
          timeoutMs: env.TURN_TIMEOUT_MS,
        })

const planStore = supabasePlanStore(db)
const marketStore = supabaseMarketStore(db)
const alertStore = supabaseAlertStore(db)
const holdingStore = supabaseHoldingStore(db)
const vapid =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_D && env.VAPID_SUBJECT
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateD: env.VAPID_PRIVATE_D, subject: env.VAPID_SUBJECT }
    : undefined
const adminStores = createAdminStores(db, {
  ...(env.ANTHROPIC_API_KEY === undefined ? {} : { anthropicApiKey: env.ANTHROPIC_API_KEY }),
  saoiModel: env.SAOI_MODEL,
  gateModel: env.GATE_MODEL,
  appBaseUrl: env.APP_BASE_URL,
  ...(vapid === undefined ? {} : { vapid }),
})

const app = createApp({
  version: env.APP_VERSION,
  log,
  corsOrigins: parseOrigins(env.CORS_ORIGINS),
  rateLimit: { max: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
  verifyToken: createTokenVerifier({
    secret: env.SUPABASE_JWT_SECRET,
    jwksUrl: env.SUPABASE_JWKS_URL ?? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    issuer: env.SUPABASE_JWT_ISSUER,
  }),
  store: supabaseStore(db, { appBaseUrl: env.APP_BASE_URL }),
  sessions: supabaseSessionStore(db),
  partners: supabasePartnerStore(db),
  uploads: supabaseUploadStore(db),
  plans: { store: planStore, appBaseUrl: env.APP_BASE_URL },
  market: {
    store: marketStore,
    runs: supabaseCalculatorRunStore(db),
    drafts: { store: planStore, appBaseUrl: env.APP_BASE_URL },
  },
  alerts: {
    store: alertStore,
    market: () => marketStore.load(),
    // The console's sender, so there is one web-push path; unset VAPID keeps alerts for the visit.
    ...(vapid === undefined
      ? {}
      : {
          push: ({ caseId, title, body }) =>
            adminStores.push.sendNotification({ caseId, title, body, actor: 'system' }),
        }),
    internalKey: env.INTERNAL_JOB_KEY ?? '',
  },
  holdings: { store: holdingStore, plans: planStore },
  // The MCP server posts each call with the same key the alerts timer uses; unset, 404.
  telemetry: { store: supabaseTelemetryStore(db), internalKey: env.INTERNAL_JOB_KEY ?? '' },
  casePlan: {
    plans: planStore,
    holdings: holdingStore,
    reminders: alertStore,
    market: () => marketStore.load(),
  },
  admin: adminStores,
  turn: {
    run: createTurnRunner({
      db,
      appBaseUrl: env.APP_BASE_URL,
      limits: { wallClockMs: env.TURN_TIMEOUT_MS, maxOutputTokens: env.TURN_MAX_OUTPUT_TOKENS },
      log,
      models: turnModels,
      market: () => marketStore.load(),
    }),
  },
  config: { presenterKey: env.PRESENTER_KEY, audienceMaxCases: env.AUDIENCE_MAX_CASES },
})

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info('listening', { version: env.APP_VERSION, port: info.port })
})

/**
 * Plans are held 24 hours unless opened (Chris, 2026-11-09). The build-plan route also sweeps
 * before it writes; this hourly pass covers quiet hours.
 */
const sweepPlans = (): void => {
  planStore
    .sweep()
    .then((removed) => {
      if (removed > 0) log.info('plans swept', { removed })
    })
    .catch((error: unknown) => {
      log.warn('plan sweep failed', { error: error instanceof Error ? error.message : 'unknown' })
    })
}
sweepPlans()
const sweepTimer = setInterval(sweepPlans, 60 * 60 * 1000)
sweepTimer.unref()

// Docker sends SIGTERM; open streams would otherwise hold the stop until the kill timeout.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close()
    process.exit(0)
  })
}
