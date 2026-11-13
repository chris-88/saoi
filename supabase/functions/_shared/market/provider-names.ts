/**
 * The readable name of every provider id: the one table the admin's market views read. Ids
 * come from `scripts/market/ccpc-providers.ts` (CCPC's names) and the bank-direct readers
 * (`boi`, `bunq`, `moco`); a bank reached through Raisin is named as the bank that holds the
 * deposit, without the platform. An id is added here when it is added there
 * (`tests/market-provider-names.test.ts` holds the two together).
 */
export const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  aib: 'AIB',
  boi: 'Bank of Ireland',
  ptsb: 'PTSB',
  ebs: 'EBS',
  bunq: 'bunq',
  moco: 'MoCo',
  revolut: 'Revolut',
  an_post_money: 'An Post Money',
  avant_money: 'Avant Money',
  credit_union: 'Credit Union',
  credit_union_mortgages: 'Credit Union Mortgages',
  haven: 'Haven Mortgages',
  ics_mortgages: 'ICS Mortgages',
  nua_money: 'Nua Money',
  state_savings: 'State Savings',
  bankinter: 'Bankinter',
  raisin_bank: 'Raisin Bank',
  banca_cf: 'Banca CF+',
  nordax: 'Nordax Bank',
  creditplus: 'Creditplus Bank',
  ibl_banca: 'IBL Banca',
  aareal: 'Aareal Bank',
}

/** The readable name for a provider id; the id itself when the table has none. */
export function providerNameOf(id: string): string {
  return PROVIDER_NAMES[id] ?? id
}
