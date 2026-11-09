/**
 * How products work together, which no product page says.
 *
 * A catalogue lists things one at a time. A banker sitting across a desk knows that two of them
 * used together beat either alone, and that is the knowledge a customer cannot get from a
 * website — so it is exactly what Saoirse is for.
 *
 * Facts only. Each of these states what is true of the products and what it costs or earns, and
 * leaves the choosing to the customer: the pack's own rules forbid calling anything "best"
 * without an authorised basis, and a combination is still a recommendation if it is phrased as
 * one. "People saving a deposit often do this, and here is the arithmetic" is not.
 *
 * Every figure here is read from the products' market records, the same ones the cards and
 * the savings engine use, so when a rate moves on the site the arithmetic here moves with it.
 */

import type { KnowledgeProduct } from './kb-types.ts'
import { marketOf, publishedProducts } from './market.ts'

export type Combination = {
  readonly id: string
  readonly name: string
  /** The situation it applies to, in the terms a case would describe. */
  readonly when: string
  /** Catalogue ids, so nothing here can name a product that does not exist. */
  readonly products: readonly string[]
  /** What the arrangement actually is. */
  readonly how: readonly string[]
  /** The facts that make it work, each one checkable against the product objects. */
  readonly because: readonly string[]
  /** What would make it a bad idea, or stop it working. */
  readonly watch: readonly string[]
}

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

const inWords = (n: number): string => WORDS[n] ?? String(n)
const euro = (n: number): string => `€${n.toLocaleString('en-IE')}`

/**
 * MortgageSaver alongside SuperSaver, with every figure read from the two products' market
 * records. Absent, rather than restated from memory, when either record is missing or the
 * arithmetic no longer favours SuperSaver for the monthly money: the advice is only as true as
 * the rates under it.
 */
function depositStack(products: readonly KnowledgeProduct[]): Combination | null {
  const market = (id: string) => {
    const product = products.find((candidate) => candidate.id === id)
    return product === undefined ? null : marketOf(product)
  }
  const superSaver = market('savings.supersaver')?.rates
  const mortgageSaver = market('savings.mortgagesaver')
  const bonus = mortgageSaver?.conditions.bonus
  const ms = mortgageSaver?.rates

  if (
    superSaver?.aerPct === undefined ||
    superSaver.aerPct === null ||
    superSaver.fixedMonths === undefined ||
    ms?.aerPct === undefined ||
    ms.aerPct === null ||
    ms.tierCapEur === undefined ||
    ms.aboveTierAerPct === undefined ||
    bonus === undefined
  ) {
    return null
  }

  // €1,000 a month over a year averages €6,500 held, which is what the gap is earned on.
  const gap = Math.round(((superSaver.aerPct - ms.aerPct) / 100) * 6500)
  if (gap <= 0) return null

  const fixedPeriod = superSaver.fixedMonths === 12 ? 'fixed year' : 'fixed period'
  const otherBalance = ms.lumpSumAerPct ?? ms.aboveTierAerPct

  return {
    id: 'deposit_stack',
    name: 'MortgageSaver alongside SuperSaver',
    when: 'saving monthly towards a first-home deposit, especially with a balance already put by',
    products: ['savings.mortgagesaver', 'savings.supersaver'],
    how: [
      `Keep at least ${euro(bonus.minMonthlyEur)} a month going into MortgageSaver. That is what keeps the first-time-buyer bonus alive, and it is the cheapest way to qualify for it.`,
      'Put the rest of the monthly saving into SuperSaver while its rate is fixed.',
      `When the ${fixedPeriod} ends and SuperSaver drops to the standard variable rate, move that balance into MortgageSaver — which takes lump sums — and start a fresh SuperSaver for the next year.`,
    ],
    because: [
      `SuperSaver pays ${String(superSaver.aerPct)}% AER fixed for the first ${String(superSaver.fixedMonths)} months; MortgageSaver pays ${String(ms.aerPct)}% AER on monthly contributions. On €1,000 a month that is roughly ${euro(gap)} a year of difference — real, but small.`,
      `The MortgageSaver first-time-buyer bonus is ${euro(bonus.amountEur)} before DIRT, which is worth more than any rate difference between these accounts. It needs ${euro(bonus.minMonthlyEur)} a month for ${inWords(bonus.minMonths)} consecutive months, ${euro(bonus.minTotalEur)} saved before drawdown, and a Demo Bank mortgage drawn down within ${String(bonus.withinMonths)} months.`,
      'SuperSaver takes no lump sums, so the rotation only ever moves one way: out of SuperSaver and into MortgageSaver.',
    ],
    watch: [
      `A lump sum sitting in MortgageSaver earns the "other balance" rate of ${String(otherBalance)}%, not the ${String(ms.aerPct)}% headline — that only applies to monthly contributions, and only up to a ${euro(ms.tierCapEur)} tier. Somebody moving a large balance in should know they are doing it for the bonus, not for the rate.`,
      `The bonus depends on drawing down a Demo Bank mortgage within ${String(bonus.withinMonths)} months. If they buy later, or borrow elsewhere, it does not pay.`,
      'Two direct debits instead of one. Worth saying out loud, because it is the part that makes this feel like effort.',
    ],
  }
}

/** The combinations whose figures hold for the products this turn has. */
export function combinationsFor(products: readonly KnowledgeProduct[]): readonly Combination[] {
  return [depositStack(products)].filter((combination) => combination !== null)
}

export const demoCombinations: readonly Combination[] = combinationsFor(publishedProducts)

/** The prompt section. Empty when a tenant has none, which costs nothing. */
export function combinationsSection(
  products: readonly KnowledgeProduct[] = publishedProducts,
): string {
  const combinations = combinationsFor(products)
  if (combinations.length === 0) return ''

  const describe = (combination: Combination): string =>
    [
      `## ${combination.name}`,
      `For somebody ${combination.when}.`,
      'How it works:',
      ...combination.how.map((step, index) => `${String(index + 1)}. ${step}`),
      'Why:',
      ...combination.because.map((reason) => `- ${reason}`),
      'What to say about the downside:',
      ...combination.watch.map((caution) => `- ${caution}`),
    ].join('\n')

  return [
    '# Products that work together',
    '',
    'A product page describes one thing at a time. These are the arrangements a person behind a',
    'desk would know about, and the reason somebody is better off talking to you than reading',
    'the site. Raise one when the situation fits, lay out the arithmetic and the catch together,',
    'and let them decide — never present a combination as the right answer, and never say it is',
    'the best thing to do. The figures are the same snapshots as the rest of the catalogue.',
    '',
    ...combinations.map(describe),
  ].join('\n\n')
}
