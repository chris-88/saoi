import type { SavingsOption } from '../../domain/savings/arrange.ts'
import type { KnowledgeProduct } from './kb-types.ts'
import { marketOf, publishedProducts } from './market.ts'

/**
 * Demo Bank's savings accounts, in the shape the arrangement engine needs.
 *
 * The engine is portable and knows nothing about this bank (Invariant 11), so the limits and
 * rates it reasons about have to be handed to it. They come from market data
 * (`pricing_and_rates.market`, laid over the catalogue by `withMarketData`): the rates, the
 * monthly and lump-sum limits and the bonus conditions as the product pages state them, read
 * by `npm run market:refresh`. They used to be restated here from the pack's prose, which is
 * how a rate change on the site went unnoticed for a month. The catalogue still supplies the
 * name and the cautions.
 *
 * A product with no market record is not an option: no rate, no arithmetic.
 */

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

/** A published percentage as the fraction the engine computes with. */
const fraction = (pct: number): number => pct / 100

function optionFor(product: KnowledgeProduct): SavingsOption | null {
  const market = marketOf(product)
  if (market === null) return null
  const { rates, conditions } = market
  /*
   * A source that does not say whether the account takes monthly saving cannot be arranged.
   * CCPC lists regular savers (SuperSaver, GoalSaver) without saying whether they take a lump
   * sum: no lump sum is placed in one, which assumes nothing it could take (2026-11-13).
   */
  if (conditions.takesMonthly === undefined) return null
  if (conditions.takesLumpSum === undefined && !conditions.takesMonthly) return null
  const takesMonthly = conditions.takesMonthly
  const takesLumpSum = conditions.takesLumpSum ?? false

  /*
   * The headline is the rate on money held, and for MortgageSaver it only applies to monthly
   * contributions up to the tier: `tierCap` and `aboveTierRate` travel with it, and the engine
   * uses those to work out what a lump sum would actually earn. Reading the headline alone is
   * how €32,000 came to be offered a home paying 0.5%.
   */
  const terms = [...(rates.terms ?? [])]
    .sort((a, b) => a.months - b.months)
    .map((term) => ({ months: term.months, annualRate: fraction(term.aerPct) }))
  const bonus = conditions.bonus

  return {
    id: product.id,
    name: product.name,
    annualRate: rates.aerPct === null ? null : fraction(rates.aerPct),
    ...(terms.length > 0 ? { terms } : {}),
    takesLumpSum,
    takesMonthly,
    ...(conditions.minLumpSumEur === undefined ? {} : { minLumpSum: conditions.minLumpSumEur }),
    ...(conditions.maxLumpSumEur === undefined ? {} : { maxLumpSum: conditions.maxLumpSumEur }),
    ...(conditions.minMonthlyEur === undefined ? {} : { minMonthly: conditions.minMonthlyEur }),
    ...(conditions.maxMonthlyEur === undefined ? {} : { maxMonthly: conditions.maxMonthlyEur }),
    ...(rates.tierCapEur === undefined || rates.aboveTierAerPct === undefined
      ? {}
      : { tierCap: rates.tierCapEur, aboveTierRate: fraction(rates.aboveTierAerPct) }),
    ...(rates.lumpSumAerPct === undefined ? {} : { lumpSumRate: fraction(rates.lumpSumAerPct) }),
    ...(bonus === undefined
      ? {}
      : {
          bonus: {
            amount: bonus.amountEur,
            requiresMortgageHere: bonus.requiresMortgageHere,
            minMonthly: bonus.minMonthlyEur,
            minMonths: bonus.minMonths,
            minTotal: bonus.minTotalEur,
            withinMonths: bonus.withinMonths,
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
export const demoSavingsOptions: readonly SavingsOption[] = savingsOptionsFrom(publishedProducts)
