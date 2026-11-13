import type { DepositMarketProduct } from '../../market/schema.ts'
import type { KnowledgeProduct } from './kb-types.ts'
import { marketOf } from './market.ts'

/**
 * The headline figure for a product, read out of the pack's pricing object.
 *
 * For a deposit account the rate is the whole question — "how much are you giving me for saving
 * with you" — and the comparison card was showing features and no figure, which made three
 * savings accounts look interchangeable when one of them pays a full point more.
 *
 * The pack states pricing in a different shape for almost every family: `aer_variable_pct`,
 * `aer_fixed_first_12m_pct`, `apr_pct`, `typical_apr_pct`, a term ladder, or prose. So this
 * reads the shapes it knows and returns null for the rest. A product with no readable figure
 * shows none, which is the honest outcome — inventing one for the sake of a tidy card is the
 * single thing this catalogue exists to prevent.
 */

export type Rate = {
  /** What to put on the card, e.g. "3% AER fixed for 12 months". */
  readonly headline: string
  /** The catch, where there is one worth seeing beside it. */
  readonly note: string | null
}

function pct(value: unknown): string | null {
  return typeof value === 'number' ? `${String(value)}%` : null
}

function euro(value: unknown): string | null {
  return typeof value === 'number' ? `€${value.toLocaleString('en-IE')}` : null
}

/**
 * The figure from market data, which is where every product the refresh covers gets one.
 *
 * The same headlines the pack shapes produced, so a card reads the same whichever source it
 * came from; the note gains whatever else the page states (SuperSaver's reversion rate and its
 * €30,000 tier), because the catch belongs beside the headline.
 */
function marketRate(market: DepositMarketProduct): Rate {
  const rates = market.rates
  const tier =
    rates.tierCapEur === undefined || rates.aboveTierAerPct === undefined
      ? null
      : `${String(rates.aboveTierAerPct)}% on anything above ${euro(rates.tierCapEur) ?? ''}`

  if (rates.terms !== undefined) {
    const longestFirst = [...rates.terms].sort((a, b) => b.months - a.months)
    const best = Math.max(...rates.terms.map((term) => term.aerPct))
    return {
      headline: `up to ${String(best)}% AER fixed`,
      note: longestFirst
        .map((term) => `${String(term.months)}m: ${String(term.aerPct)}%`)
        .join(', '),
    }
  }

  const headline = rates.aerPct ?? 0
  if (rates.basis === 'fixed' && rates.fixedMonths !== undefined) {
    const then =
      rates.thenAerPct === undefined
        ? 'The rate after it is not stated'
        : `Then the standard variable rate, ${String(rates.thenAerPct)}% AER`
    const notes = [then, tier].filter((note): note is string => note !== null)
    return {
      headline: `${String(headline)}% AER fixed for ${String(rates.fixedMonths)} months`,
      note: notes.length === 0 ? null : notes.join('; '),
    }
  }

  // A lump sum paid at a different rate means the headline is for monthly saving only.
  const monthlyOnly = rates.lumpSumAerPct === undefined ? '' : ' on monthly savings'
  const basis = rates.basis === null ? '' : ` ${rates.basis}`
  return { headline: `${String(headline)}% AER${basis}${monthlyOnly}`, note: tier }
}

export function rateOf(product: KnowledgeProduct): Rate | null {
  const market = marketOf(product)
  if (market !== null) return marketRate(market)

  const pricing = product.pricing_and_rates
  const snapshot = (pricing.snapshot ?? {}) as Record<string, unknown>

  // A fixed introductory rate, which is the one where the catch matters most.
  const intro = pct(snapshot['aer_fixed_first_12m_pct'])
  if (intro !== null) {
    const then = snapshot['then']
    return {
      headline: `${intro} AER fixed for 12 months`,
      note: typeof then === 'string' ? `Then ${then.replace(/^Standard /, 'the standard ')}` : null,
    }
  }

  /*
   * A tiered rate. MortgageSaver pays one rate on regular contributions up to a cap and much
   * less above it, and quoting the top rate alone would be the most flattering reading rather
   * than the true one.
   */
  const regular = pct(snapshot['regular_aer_variable_pct'])
  if (regular !== null) {
    const cap = euro(snapshot['regular_tier_cap_eur'])
    const above = pct(snapshot['other_balance_aer_pct'])
    return {
      headline: `${regular} AER variable on monthly savings`,
      note: cap === null || above === null ? null : `${above} on anything above ${cap}`,
    }
  }

  const variable = pct(snapshot['aer_variable_pct']) ?? pct(snapshot['variable_interest_pct'])
  if (variable !== null) return { headline: `${variable} AER variable`, note: null }

  // A term ladder: the longest term is the headline, the rest is the shape of the choice.
  const ladder = (['18m', '12m', '6m'] as const).flatMap((term) => {
    const rate = pct(snapshot[`${term}_aer_pct`])
    return rate === null ? [] : [{ term: String(term), rate }]
  })

  if (ladder.length > 0) {
    const best = ladder[0]
    return {
      headline: `up to ${best?.rate ?? ''} AER fixed`,
      note: ladder.map((entry) => `${entry.term}: ${entry.rate}`).join(', '),
    }
  }

  // Borrowing. `typical_apr_pct` is the one a customer is shown, so it leads.
  const typical = pct(pricing['typical_apr_pct'])
  if (typical !== null) {
    const purchase = pct(pricing['purchase_interest_variable_pct'])
    return {
      headline: `${typical} APR typical`,
      note: purchase === null ? null : `${purchase} variable on purchases`,
    }
  }

  const apr = pct(snapshot['apr_pct']) ?? pct(pricing['apr_snapshot_from_pct'])
  if (apr !== null) return { headline: `${apr} APR`, note: null }

  const range = pricing['apr_snapshot_pct']
  if (Array.isArray(range) && range.length === 2 && range.every((n) => typeof n === 'number')) {
    return { headline: `${String(range[0])}%–${String(range[1])}% APR`, note: null }
  }

  const fee = pricing['maintenance_fee_eur_month']
  if (typeof fee === 'number') {
    return { headline: fee === 0 ? 'No monthly fee' : `${euro(fee) ?? ''} a month`, note: null }
  }

  /*
   * Everything else — mortgage rate tables, insurance premiums, FX — is prose in the pack
   * because it genuinely varies. Null, and the card simply has no figure on it.
   */
  return null
}

/** How old the figure is, where the pack says. Shown so nobody reads a snapshot as today's. */
export function rateAsOf(product: KnowledgeProduct): string | null {
  const asOf = product.pricing_and_rates['source_rate_as_of']
  return typeof asOf === 'string' ? asOf : null
}
