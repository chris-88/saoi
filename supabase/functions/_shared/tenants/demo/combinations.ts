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
 * Every figure here is read from the same snapshots as the rest of the catalogue, so the same
 * caution applies: they move, and the live ones are on the product pages.
 */

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

export const demoCombinations: readonly Combination[] = [
  {
    id: 'deposit_stack',
    name: 'MortgageSaver alongside SuperSaver',
    when: 'saving monthly towards a first-home deposit, especially with a balance already put by',
    products: ['savings.mortgagesaver', 'savings.supersaver'],
    how: [
      'Keep at least €200 a month going into MortgageSaver. That is what keeps the first-time-buyer bonus alive, and it is the cheapest way to qualify for it.',
      'Put the rest of the monthly saving into SuperSaver while its rate is fixed.',
      'When the fixed year ends and SuperSaver drops to the standard variable rate, move that balance into MortgageSaver — which takes lump sums — and start a fresh SuperSaver for the next year.',
    ],
    because: [
      'SuperSaver pays 3% AER fixed for the first 12 months; MortgageSaver pays 2% AER on monthly contributions. On €1,000 a month that is roughly €65 a year of difference — real, but small.',
      'The MortgageSaver first-time-buyer bonus is €2,000 before DIRT, which is worth more than any rate difference between these accounts. It needs €200 a month for six consecutive months, €5,000 saved before drawdown, and a Demo Bank mortgage drawn down within 30 months.',
      'SuperSaver takes no lump sums, so the rotation only ever moves one way: out of SuperSaver and into MortgageSaver.',
    ],
    watch: [
      'A lump sum sitting in MortgageSaver earns the "other balance" rate of 0.5%, not the 2% headline — that only applies to monthly contributions, and only up to a €15,000 tier. Somebody moving a large balance in should know they are doing it for the bonus, not for the rate.',
      'The bonus depends on drawing down a Demo Bank mortgage within 30 months. If they buy later, or borrow elsewhere, it does not pay.',
      'Two direct debits instead of one. Worth saying out loud, because it is the part that makes this feel like effort.',
    ],
  },
]

/** The prompt section. Empty when a tenant has none, which costs nothing. */
export function combinationsSection(): string {
  if (demoCombinations.length === 0) return ''

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
    ...demoCombinations.map(describe),
  ].join('\n\n')
}
