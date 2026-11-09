/**
 * A mortgage's cashback as CCPC writes it. CCPC's `Cashback` field is sometimes "Yes" or "No",
 * sometimes the figure itself ("2%"), and its `Cashback description` is prose: "2% of the
 * mortgage amount", "2 percent at drawdown", "1 per cent cashback". Both the refresh script and
 * the comparison read it here, so they agree.
 */

const PCT = /(\d+(?:\.\d+)?)\s*(?:%|per\s*cent\b|percent\b|pc\b)/i

/** The cashback percentage the text states, or null when it states none. */
export function cashbackPctOf(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const found = PCT.exec(text)?.[1]
  if (found === undefined) return null
  const pct = Number(found)
  return Number.isFinite(pct) && pct > 0 && pct <= 10 ? pct : null
}

/**
 * Whether cashback is offered: "Yes" or "No" when the field says so, true when it states a
 * percentage, null when it says neither.
 */
export function cashbackOffered(text: string | null | undefined): boolean | null {
  if (text === null || text === undefined) return null
  const trimmed = text.trim()
  if (/^(yes|1|true)\b/i.test(trimmed)) return true
  if (/^(no|0|false|none|n\/a)\b/i.test(trimmed)) return false
  return cashbackPctOf(trimmed) === null ? null : true
}
