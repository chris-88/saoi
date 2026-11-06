/// <reference types="vite/client" />

/**
 * Declaring these explicitly keeps `import.meta.env` typed and makes it obvious that only
 * these values exist on the client. Anything else belongs in an Edge Function secret.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_SENTRY_DSN?: string
  /** The public half of the Web Push key pair. Public by design — every subscriber gets it. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
  readonly VITE_BASE_PATH?: string
  /** The saoi-api origin and prefix. Empty or unset: read tables directly under RLS. */
  readonly VITE_SAOI_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
