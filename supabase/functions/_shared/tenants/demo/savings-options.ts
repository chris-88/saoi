import type { SavingsOption } from '../../domain/savings/arrange.ts'
import { demoKnowledgeBase } from './knowledge-base.ts'
import type { KnowledgeProduct } from './kb-types.ts'

/**
 * Demo Bank's savings accounts, in the shape the arrangement engine needs.
 *
 * The engine is portable and knows nothing about this bank (Invariant 11), so the limits and
 * rates it reasons about have to be handed to it. Everything here is read out of the pack
 * rather than restated: the pack states pricing in a different shape for almost every family,
 * and the translation is the whole job of this file.
 *
 * What cannot be read is declared here with a reason. The pack puts "€200–€2,500 monthly DD"
 * and "Min €5,000" in prose feature lists, because they are written for a person reading a
 * product page rather than for something allocating money across three of them.
 */

/** Limits the pack states in prose, pulled out once, with the sentence they come from. */
const LIMITS: Readonly<
  Record<
    string,
    {
      readonly minMonthly?: number
      readonly maxMonthly?: number
      readonly minLumpSum?: number
      readonly maxLumpSum?: number
      /** Which of the two kinds of money this account will actually take. */
      readonly takesLumpSum: boolean
      readonly takesMonthly: boolean
    }
  >
> = {
  // "€5–€2,500 monthly by direct debit", "No lump sums".
  'savings.supersaver': {
    minMonthly: 5,
    maxMonthly: 2500,
    takesLumpSum: false,
    takesMonthly: true,
  },
  // "€20–€2,000 monthly direct debit".
  'savings.goalsaver': {
    minMonthly: 20,
    maxMonthly: 2000,
    takesLumpSum: false,
    takesMonthly: true,
  },
  // "€200–€2,500 monthly DD", "Lump-sum option", capped at €20,000 in the pricing snapshot.
  'savings.mortgagesaver': {
    minMonthly: 200,
    maxMonthly: 2500,
    maxLumpSum: 20000,
    takesLumpSum: true,
    takesMonthly: true,
  },
  // "Min lodgement €1", no maximum stated.
  'savings.instant_access': { takesLumpSum: true, takesMonthly: true },
  // "Min €5,000", "Single initial lodgement".
  'savings.notice_31_day': { minLumpSum: 5000, takesLumpSum: true, takesMonthly: false },
  // "Min €5,000", "Single lodgement".
  'savings.advantage_fixed': { minLumpSum: 5000, takesLumpSum: true, takesMonthly: false },
}

/**
 * Left out on purpose, so that leaving one out is a decision rather than an oversight.
 *
 * A children's account and a currency account are not places to put a house deposit, and an
 * engine that ranks on rate alone would happily suggest one: `savings.smart_start_money_pot`
 * pays 2%, which beats three of the accounts above.
 */
const NOT_FOR_A_GOAL: readonly string[] = [
  'savings.smart_start_money_pot',
  'savings.childsave',
  'savings.currency_account',
]

const number = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined

/** A rate stated as a percentage in the pack, as the fraction the engine computes with. */
const fraction = (value: unknown): number | undefined => {
  const pct = number(value)
  return pct === undefined ? undefined : pct / 100
}

function termsOf(
  snapshot: Record<string, unknown>,
): readonly { months: number; annualRate: number }[] {
  return (['6m', '12m', '18m'] as const).flatMap((label) => {
    const rate = fraction(snapshot[`${label}_aer_pct`])
    return rate === undefined ? [] : [{ months: Number(label.replace('m', '')), annualRate: rate }]
  })
}

function optionFor(product: KnowledgeProduct): SavingsOption | null {
  const limits = LIMITS[product.id]
  if (limits === undefined) return null

  const snapshot = (product.pricing_and_rates.snapshot ?? {}) as Record<string, unknown>
  const terms = termsOf(snapshot)

  /*
   * The rate on money held here, by whichever shape the pack states it in.
   *
   * `regular_aer_variable_pct` is deliberately read as the headline even though it only applies
   * to monthly contributions: `tierCap` and `aboveTierRate` travel with it, and the engine uses
   * those to work out what a lump sum would actually earn. Reading the headline alone is how
   * €32,000 came to be offered a home paying 0.5%.
   */
  const annualRate =
    fraction(snapshot['aer_fixed_first_12m_pct']) ??
    fraction(snapshot['regular_aer_variable_pct']) ??
    fraction(snapshot['aer_variable_pct']) ??
    null

  if (annualRate === null && terms.length === 0) return null

  const bonusAmount = number(snapshot['ftb_bonus_before_dirt_eur'])

  return {
    id: product.id,
    name: product.name,
    annualRate,
    ...(terms.length > 0 ? { terms } : {}),
    takesLumpSum: limits.takesLumpSum,
    takesMonthly: limits.takesMonthly,
    ...(limits.minLumpSum === undefined ? {} : { minLumpSum: limits.minLumpSum }),
    ...(limits.maxLumpSum === undefined ? {} : { maxLumpSum: limits.maxLumpSum }),
    ...(limits.minMonthly === undefined ? {} : { minMonthly: limits.minMonthly }),
    ...(limits.maxMonthly === undefined ? {} : { maxMonthly: limits.maxMonthly }),
    ...(number(snapshot['regular_tier_cap_eur']) === undefined
      ? {}
      : { tierCap: number(snapshot['regular_tier_cap_eur']) ?? 0 }),
    ...(fraction(snapshot['other_balance_aer_pct']) === undefined
      ? {}
      : { aboveTierRate: fraction(snapshot['other_balance_aer_pct']) ?? 0 }),
    ...(bonusAmount === undefined
      ? {}
      : {
          bonus: {
            amount: bonusAmount,
            /*
             * Every one of these is in the pack's `bonus_conditions` as a sentence. They are
             * restated as numbers because the engine has to check them, and they are checked
             * against the prose in `savings-options.test.ts` so the two cannot drift.
             */
            requiresMortgageHere: true,
            minMonthly: 200,
            minMonths: 6,
            minTotal: 5000,
            withinMonths: 30,
          },
        }),
    watch: product.constraints_and_cautions,
  }
}

/** The savings accounts the engine may arrange across, from whichever catalogue a turn holds. */
export function savingsOptionsFrom(
  products: readonly KnowledgeProduct[],
): readonly SavingsOption[] {
  return products
    .filter((product) => product.id.startsWith('savings.'))
    .filter((product) => !NOT_FOR_A_GOAL.includes(product.id))
    .flatMap((product) => {
      const option = optionFor(product)
      return option === null ? [] : [option]
    })
}

/** The published set, for tests and for anything that has not loaded a catalogue. */
export const demoSavingsOptions: readonly SavingsOption[] = savingsOptionsFrom(
  demoKnowledgeBase.products,
)
