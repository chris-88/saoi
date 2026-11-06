/**
 * The same message twice is the customer saying the last answer did not land.
 *
 * Twice in one live case the customer sent a message again, word for word, within a minute of
 * the first, because what Saoirse had said back had not answered it. The transcript showed two
 * ordinary turns and nothing marked the stall. This is the test for it, kept pure so the turn
 * handler only has to ask and the console can be told. It changes nothing about the turn.
 */

/** How long after the first sending a repeat still counts as one. */
export const REPEAT_WINDOW_MS = 10 * 60 * 1000

/** The words, with nothing in them that retyping changes. */
const normalise = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ')

export function isRepeatedMessage(
  current: string,
  previous: { readonly content: string; readonly createdAt: string },
  now: number,
): boolean {
  const said = normalise(current)
  if (said.length === 0 || said !== normalise(previous.content)) return false

  // A timestamp that cannot be read is treated as long ago rather than as just now.
  const sentAt = Date.parse(previous.createdAt)
  if (Number.isNaN(sentAt)) return false

  return now - sentAt <= REPEAT_WINDOW_MS
}
