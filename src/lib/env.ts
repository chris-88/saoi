import { z } from 'zod'

/**
 * Browser environment.
 *
 * SAFETY: every variable named here is compiled into the public JavaScript bundle. Only
 * `VITE_`-prefixed values reach `import.meta.env` at all, and each is read EXPLICITLY below
 * rather than by handing the whole `import.meta.env` object to Zod — a wholesale reference
 * makes Vite inline every `VITE_` variable that happens to be defined, so one mis-prefixed
 * secret in a `.env` file would ship to every visitor.
 *
 * Secrets never carry a `VITE_` prefix. They belong in the `saoi-api` environment
 * (CLAUDE.md > Secrets). `scripts/check-bundle-secrets.ts` fails the build if one
 * reaches `dist/`.
 */
const browserEnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_SAOI_API_URL: z.url(),
  VITE_SENTRY_DSN: z.string().optional(),
  VITE_BASE_PATH: z.string().default('/'),
})

export type BrowserEnv = z.infer<typeof browserEnvSchema>

const parsed = browserEnvSchema.safeParse({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_SAOI_API_URL: import.meta.env.VITE_SAOI_API_URL?.trim(),
  VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
  VITE_BASE_PATH: import.meta.env.VITE_BASE_PATH,
})

/**
 * Fails soft on purpose. The site must deploy and render before the backend exists, so a
 * missing variable shows a setup notice naming it rather than a blank page.
 */
export const env: BrowserEnv | null = parsed.success ? parsed.data : null

export const isBackendConfigured = parsed.success

/** Just the variable names that need setting — not Zod's internal wording. */
export const missingEnvVars: readonly string[] = parsed.success
  ? []
  : [
      ...new Set(
        parsed.error.issues
          .map((issue) => issue.path[0])
          .filter((name): name is string => typeof name === 'string'),
      ),
    ]

/**
 * Where `saoi-api` lives, without a trailing slash, e.g. `https://api.saoi.ie`. Required: it is
 * part of the schema above, so a build without it shows the setup notice naming
 * `VITE_SAOI_API_URL` and makes no calls. Public by design: it is a URL.
 */
export const saoiApiUrl: string = parsed.success
  ? parsed.data.VITE_SAOI_API_URL.replace(/\/+$/, '')
  : ''
