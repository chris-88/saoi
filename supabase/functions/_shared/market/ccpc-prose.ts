import type { MarketProduct } from './schema.ts'

/**
 * What a CCPC row's own prose states about its rate, read where CCPC's fields leave it out
 * (Chris, 2026-11-13: CCPC is the source of every rate; provider sites are not read for rates).
 *
 * The provider pages used to supply what CCPC's fields do not: bunq's threshold bonus, MoCo's
 * rate for new accounts, SuperSaver's twelve fixed months, MortgageSaver's bonus. Now the row's
 * own words (`conditions.prose`) are the only input. A period, a bonus or a limit is read when
 * the words state it; nothing is inferred from a product's name or assumed from what a provider
 * page once said. What is not stated stays unknown, and the figures stop where it does.
 */

export type ProseReading = {
  /** "Get a fixed regular savings rate for 12 months": a fixed rate for this many months. */
  readonly fixedMonths: number | null
  /** "for new customers": the rate is for accounts opened now. */
  readonly newAccountsOnly: boolean
  /** "€2,000 top up on savings when customers draw down a BOI FTB mortgage". */
  readonly bonus: { readonly amountEur: number; readonly words: string } | null
  /**
   * Words that make a rate conditional: a bonus rate, an introductory or promotional rate. Such a rate may be paid only for a period or on part of the balance. Null: none.
   */
  readonly conditional: string | null
}

const euros = (text: string): number => Number(text.replaceAll(',', ''))

/** The sentence (or line) of `text` holding the match at `index`. */
function sentenceAt(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf('\n', index),
    text.lastIndexOf('. ', index) === -1 ? -1 : text.lastIndexOf('. ', index) + 1,
  )
  const ends = [text.indexOf('\n', index), text.indexOf('. ', index)].filter((at) => at !== -1)
  const end = ends.length === 0 ? text.length : Math.min(...ends) + 1
  return text
    .slice(start + 1, end)
    .replace(/^[\s\-•]+/, '')
    .trim()
}

const FIXED_FOR = [
  /\bfixed (?:regular savings |savings |interest )?rate (?:of [\d.]+% (?:AER )?)?for (?:the first )?(\d{1,3}) months\b/i,
  /\b(\d{1,3})[- ]month (?:fixed|introductory) (?:interest )?rate\b/i,
  /\bintroductory (?:interest )?rate\b[^.\n]*?\bfor (?:the first )?(\d{1,3}) months\b/i,
]
const NEW_ACCOUNTS = /\bfor new (?:customers|accounts|account holders)\b|\bnew customers only\b/i
const BONUS = /€\s?(\d{1,3}(?:,\d{3})*|\d+)\s*(?:top[- ]?up|bonus|cash bonus)\b/i
/*
 * Not "threshold" alone: MortgageSaver's "maximum threshold of €15,000" is a stated band, which
 * CCPC's tiers already carry. bunq's "the bonus rate applies up to a threshold" is a bonus rate.
 */
const CONDITIONAL =
  /\bbonus (?:rate|interest)\b|\bintroductory (?:rate|offer)\b|\bpromotional rate\b/i

export function readProse(product: MarketProduct): ProseReading {
  const text = Object.values(product.conditions.prose ?? {}).join('\n')
  const fixed = FIXED_FOR.map((pattern) => pattern.exec(text)).find((match) => match !== null)
  const bonus = BONUS.exec(text)
  const conditional = CONDITIONAL.exec(text)
  return {
    fixedMonths: fixed?.[1] === undefined ? null : Number(fixed[1]),
    newAccountsOnly: NEW_ACCOUNTS.test(text),
    bonus:
      bonus?.[1] === undefined
        ? null
        : { amountEur: euros(bonus[1]), words: sentenceAt(text, bonus.index) },
    conditional: conditional === null ? null : sentenceAt(text, conditional.index),
  }
}

/**
 * The row with what its prose states written into the fields CCPC left empty: a fixed period
 * (`rates.fixedMonths`, the rate after it unknown unless stated) and the rate for new accounts.
 * A field CCPC states is never overwritten. The bonus is not written here: the stored bonus
 * shape needs conditions CCPC does not state, so it travels on the view instead. Whether a
 * regular saver takes a lump sum, and at what rate, is left unknown even where the prose
 * mentions lump sums (MortgageSaver): what a lump sum earns there is not stated plainly.
 */
export function withProseRead(product: MarketProduct): MarketProduct {
  if (product.rates.kind !== 'deposit') return product
  const read = readProse(product)
  const rates = product.rates
  const fixed =
    read.fixedMonths !== null &&
    rates.fixedMonths === undefined &&
    rates.termMonths === undefined &&
    rates.terms === undefined
  const unknown = new Set(product.unknown ?? [])
  if (fixed && rates.thenAerPct === undefined) unknown.add('rates.thenAerPct')
  if (fixed) unknown.delete('rates.basis')
  return {
    ...product,
    rates: fixed
      ? { ...rates, basis: rates.basis ?? 'fixed', fixedMonths: read.fixedMonths ?? 0 }
      : rates,
    conditions: {
      ...product.conditions,
      ...(read.newAccountsOnly && product.conditions.rateForNewAccounts === undefined
        ? { rateForNewAccounts: true }
        : {}),
    },
    ...(product.unknown === undefined && unknown.size === 0
      ? {}
      : { unknown: [...unknown].sort() }),
  }
}
