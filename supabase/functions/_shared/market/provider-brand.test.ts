import { describe, expect, it } from 'vitest'
import { PROVIDER_NAMES } from './provider-names.ts'
import {
  brandOf,
  contrastRatio,
  MARKET_BRANDS,
  MONOGRAM_MIN_CONTRAST,
  textOn,
} from './provider-brand.ts'

describe('provider brand colours', () => {
  it('has a colour only for a provider the market names, or the Raisin platform', () => {
    const unknown = Object.keys(MARKET_BRANDS).filter(
      (id) => id !== 'raisin' && PROVIDER_NAMES[id] === undefined,
    )
    expect(unknown).toEqual([])
  })

  it('puts the initials in white wherever white reaches 3:1, else black', () => {
    for (const [id, brand] of Object.entries(MARKET_BRANDS)) {
      expect(brand.bg, id).toMatch(/^#[0-9a-f]{6}$/i)
      expect(brand.fg, id).toBe(textOn(brand.bg))
      expect(contrastRatio(brand.bg, brand.fg), id).toBeGreaterThanOrEqual(
        brand.fg === '#fff' ? MONOGRAM_MIN_CONTRAST : 1,
      )
    }
  })

  it('gives null for a provider it does not know, and nothing from the prototype chain', () => {
    expect(brandOf('boi')).toEqual({ bg: '#0000ff', fg: '#fff' })
    expect(brandOf('new_bank')).toBeNull()
    expect(brandOf('toString')).toBeNull()
  })
})
