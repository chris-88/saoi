import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * First letter up, the rest as written.
 *
 * Tailwind's `capitalize` title-cases every word, so "costs nothing" becomes a proper noun and
 * "very high" becomes a brand. These are phrases, not labels. (`first-letter:uppercase` does
 * nothing on a badge, which is the other thing that looked like it would work.)
 */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Token counts, short enough to sit in a table cell.
 *
 * Thousands rather than exact: nobody reads the last three digits of 142,517, and a figure that
 * changes width every turn makes a column jump.
 */
export function tokens(count: number): string {
  if (count < 1_000) return String(count)
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(2)}M`
}

/**
 * Euro, down to the tenth of a cent where that is all there is.
 *
 * A conversation costs a few cents, so rounding to the nearest cent would show most of them as
 * €0.02 and the short ones as €0.00 — which reads as free rather than cheap.
 */
export function euro(amount: number): string {
  if (amount === 0) return '€0'
  if (amount < 0.01) return `€${amount.toFixed(4)}`
  if (amount < 1) return `€${amount.toFixed(3)}`
  return `€${amount.toFixed(2)}`
}
