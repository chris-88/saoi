import type { Situation } from '../../contracts/market-tools.ts'
import type { Market } from './types.ts'

/**
 * What money held in a current account earns now (Chris, 2026-11-09, after the fourth Claude
 * test: "€25,000 sitting in my current account doing nothing" is a known 0%, not an unknown).
 *
 * A held item is a current account when its `access` says so, or, with no `access` given, when
 * the customer's own label says "current account". Its rate is then:
 *
 * - what the customer said (`aerPct`), when they said it;
 * - otherwise the credit interest CCPC's current-account table states for that provider (the
 *   highest, if CCPC lists several of its accounts);
 * - otherwise, when every current account in CCPC's table that states a credit interest rate
 *   states 0%, 0%;
 * - otherwise the highest rate CCPC states for any current account, so the gain is never
 *   overstated.
 *
 * Without any current account in the market data the rate stays unknown.
 *
 * Savings accounts whose rate was not given stay unknown: only current accounts are resolved.
 */

export type HeldItem = Situation['savings'][number]

export const CURRENT_ACCOUNT_LABEL = /\bcurrent\s+account\b|\bcurrent\s+a\/c\b/i

export const isCurrentAccount = (item: HeldItem): boolean =>
  item.access === 'current_account' ||
  (item.access === undefined && CURRENT_ACCOUNT_LABEL.test(item.label))

const normal = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '')

export type HeldRates = {
  /** The situation with each current account's rate filled in where the customer gave none. */
  readonly situation: Situation
  /** One sentence per resolved rate, saying where it came from. Empty when nothing was resolved. */
  readonly basis: readonly string[]
  /** One short sentence for a headline, or null when nothing was resolved. */
  readonly short: string | null
}

export function withHeldRates(market: Market, situation: Situation): HeldRates {
  const accounts = market.products.flatMap((product) =>
    product.terms.kind === 'current_account' && product.terms.creditInterestPct !== null
      ? [
          {
            provider: product.provider,
            providerName: product.providerName,
            pct: product.terms.creditInterestPct,
            checkedAt: product.provenance.checkedAt,
          },
        ]
      : [],
  )
  const checked = accounts.map((account) => account.checkedAt).sort()[0] ?? null
  const on = checked === null ? '' : `, checked ${checked.slice(0, 10)}`
  const highest = Math.max(0, ...accounts.map((account) => account.pct))
  const basis: string[] = []
  const resolved: number[] = []

  const savings = situation.savings.map((item) => {
    // Without CCPC's table there is nothing to rest a rate on: it stays unknown.
    if (item.aerPct !== undefined || !isCurrentAccount(item) || accounts.length === 0) return item
    const named =
      item.provider === undefined
        ? []
        : accounts.filter(
            (account) =>
              normal(account.provider) === normal(item.provider ?? '') ||
              normal(account.providerName) === normal(item.provider ?? ''),
          )
    let pct: number
    let why: string
    if (named.length > 0) {
      pct = Math.max(...named.map((account) => account.pct))
      why = `${item.label}: counted as earning ${String(pct)}%, the credit interest CCPC’s current-account table states for ${named[0]?.providerName ?? item.provider ?? ''}${on}.`
    } else if (highest === 0) {
      pct = 0
      why = `${item.label}: counted as earning 0%. Irish current accounts pay no interest in practice: every current account in CCPC’s table that states a credit interest rate states 0% (${String(accounts.length)} accounts${on}).`
    } else {
      pct = highest
      why = `${item.label}: counted as earning ${String(pct)}%, the highest credit interest CCPC’s current-account table states${on}, so the gain is not overstated.`
    }
    basis.push(why)
    resolved.push(pct)
    return { ...item, aerPct: pct, access: 'current_account' as const }
  })

  const zero = resolved.every((pct) => pct === 0)
  const short =
    resolved.length === 0
      ? null
      : zero
        ? 'Money in a current account is counted as earning 0%, what CCPC’s current-account table shows Irish current accounts pay.'
        : 'Money in a current account is counted at the credit interest CCPC’s current-account table states.'
  return { situation: { ...situation, savings }, basis, short }
}
