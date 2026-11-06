import { useEffect, useId } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Keeps a screen current while something else changes the case.
 *
 * Realtime tells us a row changed; it never carries the new state into the cache. The handler
 * only invalidates, and TanStack refetches through the same path as the first load — so what
 * is on screen always came from the server, never from a payload we patched in by hand
 * (CLAUDE.md > TanStack Query).
 *
 * The console is the first caller: a presenter watching someone talk to Saoirse should see the
 * facts and applications arrive, not have to reload to find out anything happened.
 */
export function useRealtimeInvalidation(
  tables: readonly string[],
  invalidate: () => void,
  enabled = true,
): void {
  const queries = useQueryClient()

  /**
   * One channel per caller, not one per table list.
   *
   * `client.channel(topic)` hands back the existing channel when the topic matches, and adding
   * handlers to a channel that has already subscribed throws. Two screens watching the same
   * tables used to be fine because only one was ever mounted; the moment the case pane sat
   * inside the case list, the second one threw on mount and stopped updating.
   */
  const instance = useId()

  // Joined so the effect keys on the contents rather than a fresh array each render.
  const key = tables.join(',')

  useEffect(() => {
    if (!enabled) return
    const client = supabase
    if (client === null) return

    let channel: RealtimeChannel | null = null
    let cancelled = false

    void (async () => {
      /**
       * Realtime filters every change through RLS using the socket's own token, and the
       * socket is opened with the anon key when the client is constructed — before anyone has
       * signed in. Left alone the admin subscribes successfully and then receives nothing,
       * because `is_admin()` is false for an anonymous socket. The channel has to be told who
       * is connected before it is opened.
       */
      const session = await client.auth.getSession()
      if (cancelled) return

      const token = session.data.session?.access_token
      if (token !== undefined) await client.realtime.setAuth(token)
      if (cancelled) return

      channel = client.channel(`watch:${instance}:${key}`)

      for (const table of key.split(',')) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          invalidate()
        })
      }

      channel.subscribe()
    })()

    return () => {
      cancelled = true
      if (channel !== null) void client.removeChannel(channel)
    }
    // `client` is stable; `invalidate` is the caller's concern to keep stable.
  }, [key, instance, enabled, invalidate, queries])
}
