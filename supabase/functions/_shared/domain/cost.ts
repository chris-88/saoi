/**
 * What a conversation cost to run (§53, console §4).
 *
 * The token counts here are measured, not modelled: every Anthropic response reports exactly
 * what it consumed, and a turn records the sum across its rounds plus the gate call in front of
 * it. The prices are the assumption — they are a constant in this file, in euro, and the console
 * says "estimated" for that reason rather than because the tokens are uncertain.
 *
 * Worth having because the first question anybody asks about a conversational product is what it
 * costs per conversation, and "a few cents" is a worse answer than a number.
 */

export type ModelUsage = {
  readonly input: number
  readonly output: number
  /** Tokens served from the prompt cache, which is most of the system prompt on most turns. */
  readonly cacheRead: number
  /** Tokens written into the cache, charged at a premium and only on the first turn of a session. */
  readonly cacheWrite: number
}

export type TurnUsage = {
  /** The Saoirse model, summed across every tool round in the turn. */
  readonly model: ModelUsage
  /** The gate in front of it, which runs on every turn including blocked ones. */
  readonly gate: ModelUsage
  /** How long it took, where that was measured. Never summed: a conversation has no total. */
  readonly timing?: TurnTiming
}

/**
 * Where a turn's time went, in milliseconds from the request arriving at the function.
 *
 * Recorded because "the first reply took ages" is a report with nothing behind it: the saved
 * timestamps only say when the customer's message was stored (after the gate) and when the
 * reply was. This says how long the gate took, when the first words reached the screen, how
 * many model rounds there were, and whether the first round had to write the prefix to cache
 * rather than read it, which is what a cold start looks like from the inside.
 */
export type TurnTiming = {
  readonly gateMs: number
  /** Null when nothing was said, which the fallback line then covers. */
  readonly firstTextMs: number | null
  readonly totalMs: number
  readonly rounds: number
  readonly coldPrefix: boolean
}

export const EMPTY_USAGE: TurnUsage = {
  model: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  gate: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

/**
 * Euro per million tokens.
 *
 * Anthropic lists in dollars; these are converted once, here, at the rate below. Both are
 * assumptions and both are the reason the console says "estimated" — change them in this file
 * and every figure in the console moves with them.
 */
export const USD_TO_EUR = 0.92

const usd = (dollars: number): number => dollars * USD_TO_EUR

/** Sonnet-class, for Saoirse itself. Cache writes cost 1.25x input; cache reads 0.1x. */
export const SAOI_PRICES = {
  input: usd(3),
  output: usd(15),
  cacheWrite: usd(3 * 1.25),
  cacheRead: usd(3 * 0.1),
} as const

/** Haiku-class, for the gate. Cheaper because classification does not need the big model. */
export const GATE_PRICES = {
  input: usd(1),
  output: usd(5),
  cacheWrite: usd(1 * 1.25),
  cacheRead: usd(1 * 0.1),
} as const

type Prices = typeof SAOI_PRICES

function priceOf(usage: ModelUsage, prices: Prices): number {
  return (
    (usage.input * prices.input +
      usage.output * prices.output +
      usage.cacheRead * prices.cacheRead +
      usage.cacheWrite * prices.cacheWrite) /
    1_000_000
  )
}

/** Every token the turn consumed, however it was charged. */
export function tokensIn(usage: TurnUsage): number {
  const all = (model: ModelUsage): number =>
    model.input + model.output + model.cacheRead + model.cacheWrite

  return all(usage.model) + all(usage.gate)
}

/** What it cost, in euro. */
export function costIn(usage: TurnUsage): number {
  return priceOf(usage.model, SAOI_PRICES) + priceOf(usage.gate, GATE_PRICES)
}

export function addUsage(a: TurnUsage, b: TurnUsage): TurnUsage {
  const sum = (x: ModelUsage, y: ModelUsage): ModelUsage => ({
    input: x.input + y.input,
    output: x.output + y.output,
    cacheRead: x.cacheRead + y.cacheRead,
    cacheWrite: x.cacheWrite + y.cacheWrite,
  })

  return { model: sum(a.model, b.model), gate: sum(a.gate, b.gate) }
}

export function sumUsage(usages: readonly TurnUsage[]): TurnUsage {
  return usages.reduce(addUsage, EMPTY_USAGE)
}

/**
 * One turn's worth, for conversations that happened before any of this was recorded.
 *
 * Measured from the real system rather than guessed: the cached prefix and tool schemas come to
 * 7,104 tokens, the case digest about 914, Saoirse replies average 246 characters, and most turns
 * run two rounds because facts are recorded as they arrive. The cache is read once per round,
 * not once per turn, which is the part that dominates.
 *
 * A case that falls back to this is flagged, because an average is not a measurement.
 */
export const TYPICAL_TURN: TurnUsage = {
  model: { input: 2_634, output: 250, cacheRead: 14_208, cacheWrite: 0 },
  gate: { input: 13, output: 25, cacheRead: 865, cacheWrite: 0 },
}
