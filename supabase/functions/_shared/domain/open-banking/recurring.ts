/**
 * What comes and goes on a schedule.
 *
 * Both the overview card and the assessment evidence need the same thing from a statement:
 * which credits and debits repeat, how often, and whether the amount holds steady. One
 * detector, so the salary the card shows is the salary the assessment takes, and a change to
 * what counts as "regular" moves both at once.
 */

export type TransactionLike = {
  readonly bookedOn: string
  /** Negative is money out. */
  readonly amount: number
  readonly description: string
  readonly category: string
}

export type Cadence = 'weekly' | 'fortnightly' | 'monthly' | 'irregular'

export type Recurrence = {
  readonly label: string
  readonly category: string
  /** The mean, always positive, whichever direction the money went. */
  readonly amount: number
  readonly cadence: Cadence
  readonly count: number
  readonly lastOn: string
  /** Every occurrence within fifteen percent of the mean: a standing order, not a shop. */
  readonly stable: boolean
}

/** Groups of two or more under the same description, in the direction asked for. */
export function recurring(
  transactions: readonly TransactionLike[],
  direction: 'credit' | 'debit',
): readonly Recurrence[] {
  const groups = new Map<string, TransactionLike[]>()
  for (const transaction of transactions) {
    const credit = transaction.amount > 0
    if ((direction === 'credit') !== credit) continue
    const group = groups.get(transaction.description) ?? []
    group.push(transaction)
    groups.set(transaction.description, group)
  }

  const found: Recurrence[] = []
  for (const [label, group] of groups) {
    if (group.length < 2) continue
    const dates = [...new Set(group.map((t) => t.bookedOn))].sort()
    const amounts = group.map((t) => Math.abs(t.amount))
    const mean = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length
    const first = group[0]
    const last = dates.at(-1)
    if (first === undefined || last === undefined) continue

    found.push({
      label,
      category: first.category,
      amount: Math.round(mean * 100) / 100,
      cadence: cadenceOf(dates),
      count: group.length,
      lastOn: last,
      stable: amounts.every((amount) => Math.abs(amount - mean) <= mean * 0.15),
    })
  }

  return found.sort((a, b) => b.amount - a.amount)
}

/** From the median gap between occurrences, with room for weekends and short months. */
function cadenceOf(sortedDates: readonly string[]): Cadence {
  if (sortedDates.length < 2) return 'irregular'
  const gaps: number[] = []
  for (let i = 1; i < sortedDates.length; i++) {
    const previous = sortedDates[i - 1]
    const current = sortedDates[i]
    if (previous === undefined || current === undefined) continue
    gaps.push(daysBetween(previous, current))
  }
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0
  if (median >= 5 && median <= 9) return 'weekly'
  if (median >= 12 && median <= 16) return 'fortnightly'
  if (median >= 25 && median <= 37) return 'monthly'
  return 'irregular'
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}
