/**
 * CCPC's provider names, mapped to Saoi's provider ids.
 *
 * `provider` on a row is always the bank, never CCPC. A deposit sold through a platform (Raisin)
 * belongs to the bank that holds it; the platform is kept in the row's details. A name not
 * listed here gets an id generated from it and is called out in the refresh output, so a new
 * entrant is noticed and added here rather than silently invented each week.
 */

export type ProviderMapping = { readonly id: string; readonly platform?: string }

export const CCPC_PROVIDERS: Readonly<Record<string, ProviderMapping>> = {
  AIB: { id: 'aib' },
  'Bank of Ireland': { id: 'boi' },
  ptsb: { id: 'ptsb' },
  'EBS d.a.c': { id: 'ebs' },
  bunq: { id: 'bunq' },
  MoCo: { id: 'moco' },
  Revolut: { id: 'revolut' },
  'An Post Money': { id: 'an_post_money' },
  'Avant Money': { id: 'avant_money' },
  'Credit Union': { id: 'credit_union' },
  'Credit Union Mortgages': { id: 'credit_union_mortgages' },
  'Haven Mortgages Limited': { id: 'haven' },
  'ICS Mortgages': { id: 'ics_mortgages' },
  'Nua Money Limited': { id: 'nua_money' },
  'Ireland State Savings': { id: 'state_savings' },
  Bankinter: { id: 'bankinter' },
  'Raisin Bank': { id: 'raisin_bank' },
  'Banca CF+ via Raisin Ireland': { id: 'banca_cf', platform: 'Raisin' },
  'Nordax Bank via Raisin': { id: 'nordax', platform: 'Raisin' },
  'Creditplus Bank via Raisin': { id: 'creditplus', platform: 'Raisin' },
  'IBL Banca via Raisin': { id: 'ibl_banca', platform: 'Raisin' },
  'Aareal Bank via Raisin.ie': { id: 'aareal', platform: 'Raisin' },
}

const tidy = (name: string): string => name.replace(/\s+/g, ' ').trim()

const BY_NAME = new Map(Object.entries(CCPC_PROVIDERS).map(([name, value]) => [tidy(name), value]))

/** The mapping for a CCPC provider name, or a generated one marked `generated`. */
export function providerFor(name: string): ProviderMapping & { readonly generated: boolean } {
  const known = BY_NAME.get(tidy(name))
  if (known !== undefined) return { ...known, generated: false }

  const platform = /\bvia\s+(Raisin)/i.exec(name)?.[1]
  const id = tidy(name)
    .toLowerCase()
    .replace(/\bvia\s+.*$/, '')
    .replace(/\b(d\.?a\.?c|limited|ltd|plc|dac)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return {
    id: id.length >= 2 ? id : 'provider_unknown',
    ...(platform === undefined ? {} : { platform }),
    generated: true,
  }
}
