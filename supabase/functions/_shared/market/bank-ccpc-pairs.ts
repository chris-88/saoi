/**
 * Which CCPC row is the same product as a row read from the provider's own site.
 *
 * Bank of Ireland is read two ways: from its own pages (`bank`) and from CCPC (`ccpc`). CCPC
 * lists Advantage as three products (one per term) where the bank's page is one product with a
 * ladder, and names products its own way, so the pairing is by name, recorded here once. The
 * refresh cross-checks each pair (`scripts/market/crosscheck.ts`); the comparison engine
 * (`domain/market/normalise.ts`) shows the bank row and sets the CCPC rows aside, naming them.
 *
 * A CCPC product that matches no pair stays in the comparison as CCPC lists it: "31 Day Set
 * Notice Account" is a different product from "365 31-Day Notice", and is not paired.
 */

export type BankCcpcPair = {
  readonly provider: string
  /** The bank-direct row's product id. */
  readonly bankId: string
  /** Matches CCPC's product name. */
  readonly ccpcName: RegExp
  readonly category: 'savings' | 'deposit'
  /** For one rung of a ladder: which term. */
  readonly termMonths?: number
}

export const BANK_CCPC_PAIRS: readonly BankCcpcPair[] = [
  { provider: 'boi', bankId: 'savings.supersaver', ccpcName: /^SuperSaver/i, category: 'savings' },
  { provider: 'boi', bankId: 'savings.goalsaver', ccpcName: /^GoalSaver/i, category: 'savings' },
  {
    provider: 'boi',
    bankId: 'savings.mortgagesaver',
    ccpcName: /^MortgageSaver/i,
    category: 'savings',
  },
  {
    provider: 'boi',
    bankId: 'savings.instant_access',
    ccpcName: /^Instant Access Demand/i,
    category: 'deposit',
  },
  {
    provider: 'boi',
    bankId: 'savings.notice_31_day',
    ccpcName: /^365 31-?Day Notice/i,
    category: 'deposit',
  },
  ...[6, 12, 18].map((months) => ({
    provider: 'boi',
    bankId: 'savings.advantage_fixed',
    ccpcName: new RegExp(`^Advantage ${String(months)} Month Fixed`, 'i'),
    category: 'deposit' as const,
    termMonths: months,
  })),
]
