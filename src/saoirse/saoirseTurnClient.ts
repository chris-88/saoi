import { saoiApiUrl } from '@/lib/env'
import { requireSupabase } from '@/lib/supabase'
import { parseStreamEvent, type StreamEvent } from '@contracts/stream.ts'

/**
 * Calls the turn and reports stream events as they arrive.
 *
 * The turn is `POST /api/cases/:caseId/turns` on saoi-api, which answers with a
 * `text/event-stream`.
 *
 * `fetch` rather than `EventSource`: the turn is a POST carrying an Authorization header, and
 * EventSource supports neither.
 */
export type SaoirseTurnInput = {
  readonly caseId: string
  readonly trigger?: 'message' | 'opening' | 'return' | 'action'
  readonly message?: string
  /** For `action`: what Saoirse should do about it. Not recorded. */
  readonly note?: string
  readonly signal?: AbortSignal
}

/**
 * How long the stream may say nothing before it is treated as dead.
 *
 * Measured between chunks rather than for the whole turn, because a turn that is working sends
 * text the whole way through and a turn that has stalled sends nothing at all. Generous enough
 * to cover the gap before the first token while the gate runs and the model starts.
 */
const SILENCE_LIMIT_MS = 45_000

export async function streamSaoirseTurn(
  input: SaoirseTurnInput,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const supabase = requireSupabase()
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) throw new Error('Not signed in.')

  const fields = {
    trigger: input.trigger ?? 'message',
    ...(input.message === undefined ? {} : { message: input.message }),
    ...(input.note === undefined ? {} : { note: input.note }),
  }

  const response = await fetch(
    `${saoiApiUrl}/api/cases/${encodeURIComponent(input.caseId)}/turns`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      ...(input.signal ? { signal: input.signal } : {}),
    },
  )

  if (!response.ok || !response.body) {
    // A non-streaming failure still answers with the standard envelope.
    const text = await response.text()
    onEvent({
      type: 'error',
      error: { code: 'upstream_unavailable', message: extractMessage(text) },
    })
    return
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  for (;;) {
    /**
     * A read that never settles is the worst way for a turn to fail.
     *
     * The connection stays open, no bytes arrive, and the customer watches a typing indicator
     * forever with nothing to click. Racing each read against a timer turns that into an
     * ordinary error they can act on.
     */
    const next = await Promise.race([
      reader.read(),
      new Promise<'silent'>((resolve) => setTimeout(() => resolve('silent'), SILENCE_LIMIT_MS)),
    ])

    if (next === 'silent') {
      await reader.cancel().catch(() => undefined)
      onEvent({
        type: 'error',
        error: {
          code: 'upstream_unavailable',
          message: 'That took too long and I lost the thread. Say it again and I will pick it up.',
        },
      })
      return
    }

    const { done, value } = next
    if (done) break
    buffer += value

    // SSE frames are separated by a blank line; a partial frame stays in the buffer.
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const event = parseStreamEvent(line.slice(6))
        // An unparseable frame is dropped rather than allowed to break the turn.
        if (event) onEvent(event)
      }

      boundary = buffer.indexOf('\n\n')
    }
  }
}

function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string') return parsed.error.message
  } catch {
    // Fall through to the generic message.
  }
  return 'Saoirse is unavailable right now.'
}
