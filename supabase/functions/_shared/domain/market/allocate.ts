import type { DepositTerms, ProductView } from '../../contracts/market-tools.ts'
import { placement, simulateDeposit } from './simulate.ts'

/**
 * The split of a lump sum and a monthly amount across the whole market that earns the most
 * interest after DIRT that can be known over the horizon: `savings/arrange.ts` generalised from
 * one bank's accounts to every provider's.
 *
 * Money goes in small slices, each to the product where it adds the most known interest given
 * what is already there, so the shape falls out of the arithmetic rather than a rule of thumb:
 * regular savers fill to their monthly caps and the rest spills to the next best; a tiered rate
 * stops attracting money at its tier; a lump sum goes to the longest fixed term that ends by the
 * horizon, or a notice or instant-access account where that earns more; a product's minimum is
 * met in one slice or not at all. A slice that adds nothing stays unplaced, and says so.
 *
 * Bounds: at most `maxAccounts` products, and no more than the €100,000 an EU deposit guarantee
 * covers with any one provider.
 */

export const GUARANTEE_CAP_EUR = 100_000

export type AllocationLine = {
  readonly product: ProductView
  readonly lumpSum: number
  readonly monthly: number
  readonly termMonths: number | null
}

export type Allocation = {
  readonly lines: readonly AllocationLine[]
  readonly unplaced: { readonly lumpSum: number; readonly monthly: number }
}

export type AllocateInput = {
  readonly lumpSum: number
  readonly monthly: number
  readonly horizonMonths: number
  /** False when the date the money is needed is not known: nothing is locked away. */
  readonly lockAllowed: boolean
  readonly maxAccounts: number
  readonly asOf: string
}

const NOT_FOR_ADULT_SAVING = /child|kid|junior|teen|student|third level/i

/** Products the allocator may use: deposits an adult can save into, within the horizon. */
export function allocatable(
  products: readonly ProductView[],
  options: {
    readonly horizonMonths: number
    readonly lockAllowed: boolean
  },
): ProductView[] {
  return products.filter((product) => {
    const terms = product.terms
    if (terms.kind !== 'deposit') return false
    if (NOT_FOR_ADULT_SAVING.test(product.name)) return false
    if (terms.access === 'fixed_term') {
      return (
        options.lockAllowed && terms.ladder.some((rung) => rung.months <= options.horizonMonths)
      )
    }
    if (terms.access === 'notice') {
      if (!options.lockAllowed) return false
      return (terms.noticeDays ?? 0) <= options.horizonMonths * 30
    }
    return true
  })
}

type Slot = { product: ProductView; terms: DepositTerms; lump: number; monthly: number }

function known(
  slot: Slot,
  horizonMonths: number,
  asOf: string,
  lump: number,
  monthly: number,
): number {
  if (lump === 0 && monthly === 0) return 0
  return simulateDeposit(slot.terms, { lumpSum: lump, monthly, horizonMonths, asOf }).figures
    .netInterest
}

export function allocate(products: readonly ProductView[], input: AllocateInput): Allocation {
  const slots: Slot[] = products.flatMap((product) =>
    product.terms.kind === 'deposit'
      ? [{ product, terms: product.terms, lump: 0, monthly: 0 }]
      : [],
  )
  const used = () => slots.filter((slot) => slot.lump > 0 || slot.monthly > 0).length
  const byProvider = (provider: string) =>
    slots
      .filter((slot) => slot.product.provider === provider)
      .reduce((sum, slot) => sum + slot.lump, 0)

  const place = (kind: 'lump' | 'monthly', total: number, slice: number): number => {
    let left = total
    while (left > 0.005) {
      let best: { slot: Slot; amount: number; gain: number } | null = null
      for (const slot of slots) {
        const fresh = slot.lump === 0 && slot.monthly === 0
        if (fresh && used() >= input.maxAccounts) continue
        const current = kind === 'lump' ? slot.lump : slot.monthly
        const minimum =
          kind === 'lump' ? (slot.terms.minLumpSumEur ?? 0) : (slot.terms.minMonthlyEur ?? 0)
        let amount = Math.min(left, current === 0 ? Math.max(slice, minimum) : slice)
        if (current === 0 && amount < minimum) continue
        if (kind === 'lump') {
          amount = Math.min(amount, GUARANTEE_CAP_EUR - byProvider(slot.product.provider))
          if (amount <= 0) continue
        }
        const next = kind === 'lump' ? slot.lump + amount : slot.monthly + amount
        const fits = placement(
          slot.terms,
          kind === 'lump' ? next : slot.lump,
          kind === 'monthly' ? next : slot.monthly,
        )
        if ((kind === 'lump' ? fits.lump : fits.monthly) < next - 0.005) continue
        const before = known(slot, input.horizonMonths, input.asOf, slot.lump, slot.monthly)
        const after = known(
          slot,
          input.horizonMonths,
          input.asOf,
          kind === 'lump' ? next : slot.lump,
          kind === 'monthly' ? next : slot.monthly,
        )
        const gain = (after - before) / amount
        if (gain <= 0) continue
        if (best === null || gain > best.gain + 1e-12) best = { slot, amount, gain }
      }
      if (best === null) break
      if (kind === 'lump') best.slot.lump += best.amount
      else best.slot.monthly += best.amount
      left -= best.amount
    }
    return Math.max(0, left)
  }

  const lumpLeft =
    input.lumpSum > 0
      ? place('lump', input.lumpSum, Math.max(1_000, Math.ceil(input.lumpSum / 50)))
      : 0
  const monthlyLeft =
    input.monthly > 0
      ? place('monthly', input.monthly, Math.max(25, Math.ceil(input.monthly / 40)))
      : 0

  const lines = slots
    .filter((slot) => slot.lump > 0 || slot.monthly > 0)
    .map((slot) => ({
      product: slot.product,
      lumpSum: Math.round(slot.lump * 100) / 100,
      monthly: Math.round(slot.monthly * 100) / 100,
      termMonths:
        slot.terms.access === 'fixed_term'
          ? simulateDeposit(slot.terms, {
              lumpSum: slot.lump,
              monthly: 0,
              horizonMonths: input.horizonMonths,
            }).figures.termMonths
          : null,
    }))
    // Lump sums first, then monthly saving, each largest first.
    .sort((a, b) => b.lumpSum - a.lumpSum || b.monthly - a.monthly)

  return {
    lines,
    unplaced: {
      lumpSum: Math.round(lumpLeft * 100) / 100,
      monthly: Math.round(monthlyLeft * 100) / 100,
    },
  }
}
