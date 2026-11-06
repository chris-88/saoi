import { z } from 'zod'
import { cardSchema } from './cards.ts'
import { apiErrorSchema } from './common.ts'

/**
 * The SSE event stream from `saoirse-turn` (CLAUDE.md > Saoirse model tools).
 *
 * A discriminated union, parsed on arrival in the browser, so a malformed frame is a handled
 * error rather than a half-rendered turn.
 */

export const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  /**
   * Take back the last `length` characters streamed.
   *
   * A round that spoke and then called a tool the server refused has put words on screen
   * about something that is not there. The server withdraws them and the model writes again
   * from what the tool results say. `length` counts characters as the deltas carried them,
   * paragraph break included.
   */
  z.object({ type: z.literal('retract'), length: z.number().int().positive() }),
  z.object({ type: z.literal('card'), card: cardSchema }),
  /** The case changed, so the client should invalidate and refetch. */
  z.object({ type: z.literal('status'), caseId: z.uuid(), invalidate: z.array(z.string()) }),
  z.object({
    type: z.literal('done'),
    messageId: z.uuid(),
    /** The gate's verdict, for the admin domain view (§39). */
    gateCategory: z.string(),
  }),
  z.object({ type: z.literal('error'), error: apiErrorSchema }),
])

export type StreamEvent = z.infer<typeof streamEventSchema>
export type StreamEventType = StreamEvent['type']

/**
 * Applies a `retract` to the text accumulated from the deltas before it.
 *
 * One function for both ends of the stream. The function trims what it persists and the
 * browser trims what it shows, and the two have to agree to the character or the record reads
 * differently from the screen it is a record of.
 */
export function withdraw(text: string, length: number): string {
  if (length <= 0) return text
  return text.slice(0, Math.max(0, text.length - length))
}

/** Serialises one event as an SSE frame. */
export function toSseFrame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Parses one SSE `data:` payload. Returns null for anything unparseable, so a stray frame
 * cannot crash the conversation.
 */
export function parseStreamEvent(payload: string): StreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(payload)
    const result = streamEventSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}
