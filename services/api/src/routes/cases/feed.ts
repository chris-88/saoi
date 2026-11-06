import { describeEvent, isNarratable } from '@shared/domain/narration.ts'
import type { CaseFeedReady, CaseFeedUpdate } from '@shared/contracts/case-read.ts'
import type { CaseStore, EventRow } from '../../store/cases.ts'

/**
 * The change feed for one case, as a sequence of frames.
 *
 * Replaces `useRealtimeInvalidation` for the public app. The browser used to be told "an
 * `events` row changed" and then read the table to find out what; here the narration is
 * computed on this side with the same `describeEvent` the digest uses, so the pill and what
 * Saoirse then says cannot disagree.
 *
 * Polls the store rather than subscribing to Realtime: it works against any Postgres, needs no
 * socket auth, and a customer's case writes a handful of events an hour. Swapping the source
 * for Realtime later changes this file and nothing else.
 */

export type FeedOptions = {
  readonly pollMs: number
  /** Cloudflare cuts a silent stream at about 100 seconds; 25 leaves a wide margin. */
  readonly keepAliveMs: number
  /** `Last-Event-ID`, to resume without repeating or skipping an event. */
  readonly lastEventId?: string | undefined
}

export type FeedFrame =
  | { readonly kind: 'ready'; readonly data: CaseFeedReady }
  | { readonly kind: 'update'; readonly data: CaseFeedUpdate }
  | { readonly kind: 'keep-alive' }

export const DEFAULT_FEED_OPTIONS = { pollMs: 2_000, keepAliveMs: 25_000 } as const

const EPOCH = '1970-01-01T00:00:00.000Z'
const MAX_FAILURES = 5

function narrate(row: EventRow): string | null {
  if (!isNarratable(row.type)) return null
  const payload =
    typeof row.payload === 'object' && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : {}
  return describeEvent({ type: row.type, payload })
}

export async function* caseFeed(
  store: CaseStore,
  caseId: string,
  options: FeedOptions,
  signal: AbortSignal,
  now: () => number = Date.now,
): AsyncGenerator<FeedFrame> {
  const recent = await store.recentEvents(caseId, 10)

  let latest: CaseFeedReady['latest'] = null
  for (const row of recent) {
    const text = narrate(row)
    if (text !== null) {
      latest = { id: row.id, text }
      break
    }
  }
  yield { kind: 'ready', data: { caseId, latest } }

  const seen = new Set<string>()
  let cursor = recent[0]?.created_at ?? EPOCH
  if (options.lastEventId === undefined) {
    for (const row of recent) seen.add(row.id)
  } else {
    // Resume after the event the browser last saw; anything newer is delivered.
    cursor = (await store.eventCreatedAt(caseId, options.lastEventId)) ?? cursor
    seen.add(options.lastEventId)
  }

  let lastWrite = now()
  let failures = 0

  while (!signal.aborted) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, options.pollMs)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
    if (signal.aborted) return

    try {
      const rows = await store.eventsSince(caseId, cursor, 100)
      failures = 0
      for (const row of rows) {
        if (row.created_at > cursor) cursor = row.created_at
        if (seen.has(row.id)) continue
        seen.add(row.id)
        const text = narrate(row)
        if (text === null) continue
        lastWrite = now()
        yield { kind: 'update', data: { id: row.id, type: row.type, text, at: row.created_at } }
      }
    } catch (error) {
      failures += 1
      console.error('feed poll failed:', error instanceof Error ? error.message : 'unknown')
      // Closing lets the browser reconnect with `Last-Event-ID`, which is better than a stuck stream.
      if (failures >= MAX_FAILURES) return
    }

    if (now() - lastWrite >= options.keepAliveMs) {
      lastWrite = now()
      yield { kind: 'keep-alive' }
    }
  }
}
