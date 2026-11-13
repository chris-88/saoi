import { describe, expect, it } from 'vitest'
import { CCPC_PROVIDERS } from '../scripts/market/ccpc-providers.ts'
import { MARKET_PROVIDERS } from '../scripts/market/providers.ts'
import {
  PROVIDER_NAMES,
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
})
