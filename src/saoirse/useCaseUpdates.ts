import { useCallback, useEffect, useRef, useState } from 'react'
import { followCaseFeed } from '@/lib/saoiApi'

/**
 * Whether the bank has moved while this screen was open, and what to say about it.
 *
 * An open screen used to be inert. The presenter simulates "assessment approved" on the
 * console, the phone on the big screen does nothing, and the customer finds out on their next
 * turn, on a reload, or from a push notification. Realtime was wired to the admin console and
 * nowhere else.
 *
 * The news comes from `saoi-api`'s change feed, already narrated on the server. The stream's
 * opening frame and each update go through the same comparison, and the feed reconnects by
 * itself.
 *
 * The comparison takes the newest narratable event and compares it to the one last acknowledged.
 * Nothing fires a turn by itself: a reply arriving while somebody is mid-thought is worse than
 * a pill they can tap when they are ready.
 */
export type CaseUpdate = {
  readonly id: string
  /** The digest's own sentence for it, so the pill and what Saoirse then says cannot disagree. */
  readonly text: string
}

export function useCaseUpdates(caseId: string | null): {
  readonly update: CaseUpdate | null
  /** The customer has acted on it. The next check starts from here. */
  readonly acknowledge: () => void
} {
  /*
   * Tagged with the case it belongs to and filtered on read, rather than cleared when the case
   * changes: clearing it would be a state change inside the effect that notices the change,
   * which cascades a render. Filtering costs nothing and cannot.
   */
  const [update, setUpdate] = useState<(CaseUpdate & { readonly caseId: string }) | null>(null)
  const acknowledged = useRef<string | null>(null)
  const baselined = useRef(false)

  /**
   * The one comparison, whichever way the newest narratable event arrived.
   *
   * The first look sets the baseline and shows nothing. Anything already there when the
   * screen opened is the opening's business: `hasUpdates` fires the return turn for it.
   */
  const consider = useCallback(
    (latest: { readonly id: string; readonly text: string } | null) => {
      if (latest === null || caseId === null) return
      if (!baselined.current) {
        baselined.current = true
        acknowledged.current = latest.id
        return
      }
      if (latest.id === acknowledged.current) return
      setUpdate({ caseId, id: latest.id, text: latest.text })
    },
    [caseId],
  )

  // Baseline on mount, and again whenever the case changes. Refs only: no state is set here.
  useEffect(() => {
    baselined.current = false
    acknowledged.current = null
  }, [caseId])

  // The service's feed, which reconnects by itself and re-sends the newest event each time.
  useEffect(() => {
    if (caseId === null) return
    const controller = new AbortController()
    void followCaseFeed(
      caseId,
      {
        onReady: (ready) => {
          // Nothing narratable yet is still a baseline: the next event is news, not history.
          if (ready.latest === null) baselined.current = true
          else consider(ready.latest)
        },
        onUpdate: (update) => consider(update),
      },
      controller.signal,
    )
    return () => controller.abort()
  }, [caseId, consider])

  const acknowledge = useCallback(() => {
    setUpdate((current) => {
      if (current !== null) acknowledged.current = current.id
      return null
    })
  }, [])

  const visible =
    update !== null && update.caseId === caseId ? { id: update.id, text: update.text } : null

  return { update: visible, acknowledge }
}
