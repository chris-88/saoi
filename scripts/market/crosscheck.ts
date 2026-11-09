import type { MarketProduct } from '../../supabase/functions/_shared/market/schema.ts'

/**
 * Bank of Ireland read two ways: from its own pages (`bank`) and from CCPC (`ccpc`). Every
 * figure both state is compared; a difference is a warning for a person to look at, not a
 * failure, because either side can be the stale one.
 *
 * CCPC lists Advantage as three products (one per term) where the bank's page is one product
 * with a ladder, and names products its own way, so the pairing is by name, here.
 */

type Pair = {
  readonly bankId: string
  /** Matches CCPC's product name. */
  readonly ccpcName: RegExp
  readonly category: 'savings' | 'deposit'
  /** For one rung of a ladder: which term. */
  readonly termMonths?: number
}

export const BOI_PAIRS: readonly Pair[] = [
  { bankId: 'savings.supersaver', ccpcName: /^SuperSaver/i, category: 'savings' },
  { bankId: 'savings.goalsaver', ccpcName: /^GoalSaver/i, category: 'savings' },
  { bankId: 'savings.mortgagesaver', ccpcName: /^MortgageSaver/i, category: 'savings' },
  { bankId: 'savings.instant_access', ccpcName: /^Instant Access Demand/i, category: 'deposit' },
  { bankId: 'savings.notice_31_day', ccpcName: /^365 31-?Day Notice/i, category: 'deposit' },
  ...[6, 12, 18].map((months) => ({
    bankId: 'savings.advantage_fixed',
    ccpcName: new RegExp(`^Advantage ${String(months)} Month Fixed`, 'i'),
    category: 'deposit' as const,
    termMonths: months,
  })),
]

export type CrossCheck = {
  readonly differences: readonly string[]
  /** CCPC lists it and the bank-direct refresh does not read it. Information only. */
  readonly notReadFromBank: readonly string[]
  /** The bank-direct refresh reads it and CCPC has no match. */
  readonly missingFromCcpc: readonly string[]
}

const near = (a: number, b: number, tolerance = 0.0001) => Math.abs(a - b) <= tolerance

export function crossCheckBoi(
  bank: readonly MarketProduct[],
  ccpc: readonly MarketProduct[],
): CrossCheck {
  const differences: string[] = []
  const matched = new Set<string>()
  const missingFromCcpc: string[] = []

  const compare = (
    label: string,
    field: string,
    ours: number | undefined,
    theirs: number | undefined,
    tolerance?: number,
  ) => {
    if (ours === undefined && theirs === undefined) return
    if (ours === undefined || theirs === undefined) {
      differences.push(
        `${label}: ${field} is ${String(ours ?? 'not stated')} on the bank's page, ${String(theirs ?? 'not stated')} on CCPC`,
      )
      return
    }
    if (!near(ours, theirs, tolerance))
      differences.push(
        `${label}: ${field} is ${String(ours)} on the bank's page, ${String(theirs)} on CCPC`,
      )
  }

  for (const pair of BOI_PAIRS) {
    const ours = bank.find((product) => product.productId === pair.bankId)
    const theirs = ccpc.find(
      (product) =>
        product.category === pair.category && pair.ccpcName.test(product.providerProductName),
    )
    const label =
      pair.termMonths === undefined ? pair.bankId : `${pair.bankId} ${String(pair.termMonths)}m`
    if (ours === undefined) continue
    if (theirs === undefined) {
      missingFromCcpc.push(label)
      continue
    }
    matched.add(theirs.productId)
    if (ours.rates.kind !== 'deposit' || theirs.rates.kind !== 'deposit') continue
    const a = ours.rates
    const b = theirs.rates

    if (pair.termMonths !== undefined) {
      const rung = a.terms?.find((term) => term.months === pair.termMonths)
      compare(label, 'AER', rung?.aerPct, b.aerPct ?? undefined)
      compare(label, 'term', pair.termMonths, b.termMonths)
    } else {
      compare(label, 'AER', a.aerPct ?? undefined, b.aerPct ?? undefined)
    }

    // A tiered rate: CCPC lists bands (`0 to 14,999 at 2%`, `15,000 to 30,000 at 0.5%`), the
    // bank states a cap and the rate above it. A euro either way is the same boundary.
    if (a.tierCapEur !== undefined || (b.tiers !== undefined && b.tiers.length > 1)) {
      const first = b.tiers?.[0]
      const second = b.tiers?.[1]
      compare(
        label,
        'tier cap (EUR)',
        a.tierCapEur,
        second?.minEur ?? first?.maxEur ?? undefined,
        1.01,
      )
      compare(label, 'rate above the tier', a.aboveTierAerPct, second?.aerPct)
    }

    const c = ours.conditions
    const d = theirs.conditions
    compare(label, 'minimum monthly (EUR)', c.minMonthlyEur, d.minMonthlyEur)
    compare(label, 'maximum monthly (EUR)', c.maxMonthlyEur, d.maxMonthlyEur)
    if (pair.category === 'deposit') {
      compare(label, 'minimum lodgement (EUR)', c.minLumpSumEur, d.minLumpSumEur)
      compare(
        label,
        'notice (days)',
        a.noticeDays ?? (pair.bankId === 'savings.notice_31_day' ? 31 : undefined),
        b.noticeDays === 0 ? undefined : b.noticeDays,
      )
    }
  }

  const notReadFromBank = ccpc
    .filter(
      (product) =>
        (product.category === 'savings' || product.category === 'deposit') &&
        !matched.has(product.productId),
    )
    .map((product) => `${product.productId} ${product.providerProductName}`)

  return { differences, notReadFromBank, missingFromCcpc: [...new Set(missingFromCcpc)] }
}
