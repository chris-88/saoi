/**
 * How long a conversation actually took.
 *
 * The point of measuring it is comparison: the same customer filling in four application forms
 * would answer the same questions four times, and the honest way to show that is a number
 * beside the applications rather than a claim.
 *
 * Which makes it worth being careful about. First-to-last wall-clock is the easy figure and it
 * is wrong the moment somebody puts their phone down and comes back after lunch — it would
 * report four hours for ten minutes of work, in the direction that flatters nobody. So gaps
 * longer than a threshold are treated as the customer having left, and not counted.
 */

/**
 * A pause longer than this is somebody leaving, not somebody thinking.
 *
 * Ten minutes. Long enough to cover reading a comparison card, working out a number, or being
 * interrupted; short enough that a conversation picked up hours later does not read as one
 * sitting.
 */
const AWAY_AFTER_MS = 10 * 60 * 1000

export type ConversationTiming = {
  /** Minutes spent in the conversation, with time away removed. */
  readonly activeMinutes: number
  /** First message to last, however long it was left in between. */
  readonly elapsedMinutes: number
  /** How many times they left and came back, by the threshold above. */
  readonly sittings: number
}

/** Timestamps in any order; ISO strings, as the database stores them. */
export function conversationTiming(timestamps: readonly string[]): ConversationTiming {
  const times = timestamps
    .map((at) => Date.parse(at))
    .filter((at) => !Number.isNaN(at))
    .sort((a, b) => a - b)

  const first = times[0]
  const last = times.at(-1)
  if (first === undefined || last === undefined || times.length < 2) {
    return { activeMinutes: 0, elapsedMinutes: 0, sittings: times.length === 0 ? 0 : 1 }
  }

  let activeMs = 0
  let sittings = 1
  for (let i = 1; i < times.length; i += 1) {
    const gap = (times[i] ?? 0) - (times[i - 1] ?? 0)
    if (gap <= AWAY_AFTER_MS) activeMs += gap
    else sittings += 1
  }

  return {
    activeMinutes: Math.round(activeMs / 60_000),
    elapsedMinutes: Math.round((last - first) / 60_000),
    sittings,
  }
}
