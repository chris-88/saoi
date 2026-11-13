import { describe, expect, it } from 'vitest'
import { CCPC_PROVIDERS } from '../scripts/market/ccpc-providers.ts'
import { MARKET_PROVIDERS } from '../scripts/market/providers.ts'
import {
  PROVIDER_DOMAINS,
  PROVIDER_NAMES,
  providerDomainOf,
  providerIdOf,
  providerNameOf,
} from '../supabase/functions/_shared/market/provider-names.ts'

describe('provider names', () => {
  it('names every provider id CCPC maps to', () => {
    const missing = Object.values(CCPC_PROVIDERS)
      .map((mapping) => mapping.id)
      .filter((id) => PROVIDER_NAMES[id] === undefined)
    expect(missing).toEqual([])
  })

  it('names every provider read from its own site', () => {
    const missing = MARKET_PROVIDERS.map((reader) => reader.provider).filter(
      (id) => PROVIDER_NAMES[id] === undefined,
    )
    expect(missing).toEqual([])
  })

  it('falls back to the id for one it does not know', () => {
    expect(providerNameOf('boi')).toBe('Bank of Ireland')
    expect(providerNameOf('new_bank')).toBe('new_bank')
  })

  it('has a domain entry (a site or an explicit null) for every named provider', () => {
    expect(Object.keys(PROVIDER_DOMAINS).sort()).toEqual(Object.keys(PROVIDER_NAMES).sort())
    for (const domain of Object.values(PROVIDER_DOMAINS)) {
      if (domain !== null) expect(domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
    }
  })

  it('gives a domain, null for the unknown', () => {
    expect(providerDomainOf('boi')).toBe('bankofireland.com')
    expect(providerDomainOf('raisin_bank')).toBe('raisin.ie')
    expect(providerDomainOf('credit_union')).toBeNull()
    expect(providerDomainOf('new_bank')).toBeNull()
  })

  it('reads a provider id out of the name a customer or a plan gives', () => {
    expect(providerIdOf('AIB')).toBe('aib')
    expect(providerIdOf('Bank of Ireland')).toBe('boi')
    expect(providerIdOf('BoI')).toBe('boi')
    expect(providerIdOf('bunq')).toBe('bunq')
    expect(providerIdOf('Permanent TSB')).toBe('ptsb')
    expect(providerIdOf('My credit union down the road')).toBeNull()
    expect(providerIdOf(null)).toBeNull()
    expect(providerIdOf('toString')).toBeNull()
  })
})
