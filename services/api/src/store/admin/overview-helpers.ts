import { LINKABLE_BANKS } from '@shared/contracts/cards.ts'
import type { Cost } from '@shared/contracts/admin.ts'
import { toUsage } from '@shared/db/rows.ts'
import { TYPICAL_TURN, costIn, sumUsage, tokensIn, type TurnUsage } from '@shared/domain/cost.ts'

/**
 * What a set of turns cost, from what was measured and an average for the rest.
 *
 * Turns recorded before cost tracking existed have no usage, and dropping them would make an
 * old conversation look free. So they are filled with `TYPICAL_TURN` and the result says how
 * many of each there were.
 */
export function costOf(rows: readonly { usage: unknown }[]): Cost {
  const measured = rows.map((row) => toUsage(row.usage)).filter((u): u is TurnUsage => u !== null)
  const unmeasured = rows.length - measured.length
  const total = sumUsage([...measured, ...Array.from({ length: unmeasured }, () => TYPICAL_TURN)])
  return {
    tokens: tokensIn(total),
    euro: costIn(total),
    turns: rows.length,
    measuredTurns: measured.length,
  }
}

/** Whoever the case is about, as they said it. Newest standing wins. */
export function statedName(
  facts: readonly { key: string; value: unknown; supersededBy: unknown }[],
): string | null {
  const stated = facts.filter(
    (fact) => fact.key === 'identity.fullName' && fact.supersededBy === null,
  )
  const latest = stated.at(-1)?.value
  return typeof latest === 'string' && latest.trim().length > 0 ? latest : null
}

/** What it has cost to reach this customer, counted from the events. */
export function notificationCost(events: readonly { type: string; payload: unknown }[]): {
  sent: number
  delivered: number
  euro: number
} {
  const sent = events.filter((event) => event.type === 'notification_sent')
  const delivered = sent.reduce((total, event) => {
    const payload = event.payload
    const count =
      typeof payload === 'object' && payload !== null && 'delivered' in payload
        ? (payload as { delivered?: unknown }).delivered
        : undefined
    return total + (typeof count === 'number' ? count : 0)
  }, 0)
  return { sent: sent.length, delivered, euro: 0 }
}

/** The five headline counts, from a tally of event types. */
export function headlineCounts(counts: ReadonlyMap<string, number>): {
  questionsAvoided: number
  factsCaptured: number
  productsOffered: number
  applicationsStarted: number
  requestsBlocked: number
} {
  return {
    questionsAvoided: counts.get('context_reused') ?? 0,
    factsCaptured: counts.get('context_captured') ?? 0,
    productsOffered: counts.get('product_offered') ?? 0,
    applicationsStarted: counts.get('application_created') ?? 0,
    requestsBlocked: counts.get('request_blocked') ?? 0,
  }
}

/** The bank as the customer knows it, or the id when it is not one the card offers. */
export function bankNameOf(bank: string | null): string {
  if (bank === null) return 'a linked account'
  return LINKABLE_BANKS.find((candidate) => candidate.id === bank)?.name ?? bank
}

/** What an event was about, from whatever the payload names. */
export function objectOf(payload: Record<string, unknown>): string {
  for (const key of ['title', 'label', 'product', 'purpose', 'name']) {
    const value = payload[key]
    if (typeof value === 'string' && value.length > 0) return value.replaceAll('_', ' ')
  }
  return ''
}
