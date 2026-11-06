/**
 * The shape of the supplied mortgage-rate pack.
 *
 * Hand-written rather than inferred, for the reason `kb-types.ts` exists: typing a supplied
 * pack is what catches the fields nobody noticed. Here it is `notes` and
 * `minimum_mortgage_amount_eur`, both of which decide whether a rate may be shown at all.
 */

/** Who the customer is. A rate belongs to one or more of these and to no others. */
export type MortgageCustomerType =
  'first_time_buyer' | 'mover' | 'switcher' | 'existing_demo_mortgage' | 'buy_to_let_new'

/** The published BER bands. `A0` exists in the new scale and not in this table — see below. */
export type BerBand = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'BER Exempt' | 'any'

export type RateFamily =
  | 'standard_fixed_cashback'
  | 'high_value_fixed'
  | 'standard_variable'
  | 'existing_fixed'
  | 'buy_to_let_fixed'
  | 'buy_to_let_variable'

export type MortgageRate = {
  readonly id: string
  readonly customer_types: readonly MortgageCustomerType[]
  readonly rate_family: RateFamily
  /** Null on a variable rate, which has no fixed period. */
  readonly term_years: number | null
  readonly ber: BerBand
  readonly interest_rate_pct: number
  readonly aprc_pct: number | null
  readonly cashback: { readonly eligible: boolean; readonly structure?: string }
  /** The High Value Mortgage floor. A rate with one may not be shown below it. */
  readonly minimum_mortgage_amount_eur: number | null
  readonly notes: readonly string[]
}

export type MortgageRateCatalogue = {
  readonly metadata: {
    readonly retrieved_on: string
    readonly public_rates_table_last_update: string
    readonly source_url: string
    readonly important_freshness_note: string
    readonly ber_scale_note: string
    readonly name: string
    readonly version: string
  }
  readonly product_rules: Readonly<Record<string, unknown>>
  /** The pack's own guidance on how to answer. Composed into the prompt verbatim. */
  readonly saoirse_answering_rules: readonly string[]
  readonly rates: readonly MortgageRate[]
}
