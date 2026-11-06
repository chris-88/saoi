import { toSseFrame, type StreamEvent } from '@shared/contracts/stream.ts'

/**
 * The turn's wire format, exactly as the SPA's `saoirseTurnClient` parses it.
 *
 * One frame per event: `data: <json>\n\n`, nothing else on the line, no `event:` or `id:`. The
 * client reads only `data: ` lines, so a comment line is invisible to it; that is what the
 * keep-alive is. Frame order is the caller's: `text_delta | retract`, then `card`, then `status`
 * and `done`, with `error` last when a turn fails.
 */

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  // A reverse proxy that buffers would hold the whole turn back until it ended.
  'X-Accel-Buffering': 'no',
} as const

/** What goes on the wire when nothing has happened for a while. Not a frame. */
export const KEEP_ALIVE = ': keep-alive\n\n'

/** Cloudflare cuts a silent connection at about 100 s; the client gives up on 45 s of nothing. */
export const DEFAULT_KEEP_ALIVE_MS = 25_000

export const encodeFrame = (event: StreamEvent): string => toSseFrame(event)

/** The events of a turn that never needed the model: a canned reply, or a failure before it. */
export async function* just(...events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  await Promise.resolve()
  yield* events
}

/**
 * The events as a byte stream, with a keep-alive comment whenever `keepAliveMs` passes without
 * a write. Cancelling the stream (the customer closed the tab) ends the generator, which runs
 * its `finally` blocks; whatever it had not yet persisted stays unpersisted.
 */
export function eventStream(
  events: AsyncIterable<StreamEvent>,
  options: { readonly keepAliveMs?: number } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const iterator = events[Symbol.asyncIterator]()
  const keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  let timer: ReturnType<typeof setInterval> | undefined
  let open = true

  const stop = () => {
    open = false
    if (timer !== undefined) clearInterval(timer)
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      timer = setInterval(() => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(KEEP_ALIVE))
        } catch {
          stop()
        }
      }, keepAliveMs)

      try {
        for (;;) {
          const next = await iterator.next()
          if (next.done === true || !open) break
          controller.enqueue(encoder.encode(encodeFrame(next.value)))
        }
      } catch {
        // The generator reports its own failures as an `error` frame; a throw here means the
        // consumer is gone, and there is nobody to tell.
      } finally {
        stop()
        try {
          controller.close()
        } catch {
          // Already cancelled.
        }
      }
    },
    async cancel() {
      stop()
      await iterator.return?.(undefined)
    },
  })
}
