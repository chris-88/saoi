import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

/**
 * Reads run through this client under RLS (primary customer and admin only).
 * All writes go through Edge Functions (CLAUDE.md > Architecture).
 *
 * `null` until the backend is configured; see `isBackendConfigured`.
 */
export const supabase: SupabaseClient | null = env
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /**
         * A sign-in must not come back in the fragment.
         *
         * The default flow is `implicit`, which returns `#access_token=…`. This app is
         * hash-routed, so that fragment is also where the route lives: the router would see a
         * pile of token parameters instead of `/`, and the tokens would sit in the address
         * bar and the browser history. PKCE returns `?code=…` in the query string instead,
         * which the router ignores and `completeSignIn` clears.
         */
        flowType: 'pkce',
        /**
         * Still false: the redemption is explicit, in `completeSignIn`, so a page load cannot
         * quietly consume a parameter meant for something else (`?n=` carries a notification
         * token).
         */
        detectSessionInUrl: false,
      },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return supabase
}
