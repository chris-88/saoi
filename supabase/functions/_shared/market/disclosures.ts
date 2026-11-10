/**
 * What Saoi says about itself wherever results appear (Chris, 2026-11-10, decision
 * `2026-11-10-saoi-compare-with-customer-filters`; wording from the regulatory boundary note,
 * section 5). Saoi compares; the customer sets the filters and chooses. Never "regulated by",
 * "adviser", "independent" or "broker".
 */

/** The core statement, in full: the about pages, the docs, the app. */
export const CORE_STATEMENT =
  'Saoi compares products and does the arithmetic on the figures you give. It is information, not advice or a recommendation, and it does not say which product is right for you. Saoi is not regulated by the Central Bank of Ireland, so Central Bank consumer protection rules and compensation schemes do not cover it. Saoi earns nothing from any provider. Rates change; the provider’s own terms are what count.'

/** The plain statement under every result: tool text, card footers, the app. */
export const RESULT_STATEMENT =
  'Saoi is not regulated by the Central Bank of Ireland and does not give advice; it compares products on the figures you give.'

/** The closing line of every presentation. */
export const CLOSING_LINE = `These are options with their figures, for the inputs given; the customer decides. ${RESULT_STATEMENT}`

/**
 * The statutory mortgage warnings, shown voluntarily with every mortgage result, worded as the
 * boundary note quotes them (Consumer Protection Code warnings, as bonkers.ie shows them).
 */
export const MORTGAGE_WARNINGS = [
  'Warning: if you do not keep up your repayments you may lose your home.',
  'Warning: the cost of your monthly repayments may increase.',
  'Warning: if you do not meet the repayments on your loan, your account will go into arrears.',
] as const

/** Words a result must never use about a product for the customer (tests hold every result to it). */
export const ADVICE_WORDS =
  /\b(recommend(ed|s|ation)?|your path|the best option for you|right for you|you should|make this plan happen|fastest combination|Your home: keys)\b/i

/** The advice words in a text, once Saoi's own statements (which name what it is not) are taken out. */
export function adviceWordsIn(text: string): string[] {
  const stripped = [CORE_STATEMENT, RESULT_STATEMENT].reduce(
    (rest, statement) => rest.replaceAll(statement, ''),
    text,
  )
  return [...stripped.matchAll(new RegExp(ADVICE_WORDS.source, 'gi'))].map((match) => match[0])
}
