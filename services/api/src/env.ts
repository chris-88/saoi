import { z } from 'zod'

/**
 * Required configuration. Read once at start-up so a missing secret fails the boot, not the
 * first request. Nothing here is ever logged.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  /** The Supabase API gateway, e.g. `http://kong:8000` inside the stack. */
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * HS256 secret for symmetric tokens (self-hosted Supabase). Optional when the project signs
   * with asymmetric keys, in which case tokens are checked against the JWKS under SUPABASE_URL.
   */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  /** Overrides the JWKS location. Default `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. */
  SUPABASE_JWKS_URL: z.url().optional(),
  /** The `iss` claim to require. Unset, the issuer is not checked. */
  SUPABASE_JWT_ISSUER: z.string().min(1).optional(),
  /** Comma-separated browser origins allowed by CORS. Empty denies all. */
  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Opens the conversation switcher to every case, for the device that sends it in
   * `X-Presenter-Key`. Unset, nobody gets the wider list.
   */
  PRESENTER_KEY: z.string().default(''),
  /** Customer cases a day before `POST /api/sessions` refuses to open another. */
  AUDIENCE_MAX_CASES: z.coerce.number().int().nonnegative().default(50),
  /** Admin API: the model for the guardrail test and persona preview. Unset, those two routes answer 502. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  SAOI_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  GATE_MODEL: z.string().min(1).default('claude-haiku-4-5-20251001'),
  /** Origin of the SPA, e.g. https://app.saoi.ie: the notification link and the partner invite link are built on it. */
  APP_BASE_URL: z.string().default(''),
  /** Admin API: Web Push. All three or none; unset, sending a notification answers 502. */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_D: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(),
  /** `fixture` replays a script from `services/api/src/turn/fixtures/` and calls nothing. */
  LLM_PROVIDER: z.enum(['anthropic', 'fixture']).default('anthropic'),
  LLM_FIXTURE: z.string().min(1).default('opening'),
  /** The whole turn, gate included. Keep under Cloudflare's ~100 s cut. */
  TURN_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(95_000).default(85_000),
  /** Output ceiling for one Saoirse round. */
  TURN_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(3_072),
  APP_VERSION: z.string().default('0.1.0-dev'),
})

export type Env = z.infer<typeof envSchema>

/** `CORS_ORIGINS` as a list. A bare `*` is dropped: any-origin is not a setting this service has. */
export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*')
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(
    Object.fromEntries(Object.entries(source).filter(([, value]) => value !== '')),
  )
  if (!parsed.success) {
    // Names only: the values may be secrets.
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    throw new Error(`Invalid environment: ${names.join(', ')}`)
  }
  return parsed.data
}
