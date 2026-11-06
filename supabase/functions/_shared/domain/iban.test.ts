import { describe, expect, it } from 'vitest'
import { formatIban, SYNTHETIC_BIC, syntheticIban } from './iban.ts'

const ONE = '3f8b0c7e-0000-4000-8000-000000000001'
const TWO = '3f8b0c7e-0000-4000-8000-000000000002'

/**
 * The check the module is held to, written independently of it: move the first four
 * characters to the end, write each letter as two digits, and the whole number leaves a
 * remainder of 1 when divided by 97. BigInt here where the module reduces digit by digit, so
 * the two cannot share a mistake.
 */
function validIban(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const digits = [...rearranged]
    .map((char) => (/[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char))
    .join('')
  return BigInt(digits) % BigInt(97) === BigInt(1)
}

describe('syntheticIban', () => {
  it('has the Irish shape, under a bank code nobody holds (Invariant 10)', () => {
    const iban = syntheticIban(ONE)
    expect(iban).toHaveLength(22)
    expect(iban).toMatch(/^IE\d{2}SAOI000000\d{8}$/)
    expect(SYNTHETIC_BIC).toBe('SAOIIE2D')
    expect(SYNTHETIC_BIC.startsWith('SAOI')).toBe(true)
  })

  it('carries check digits that validate under ISO 7064 mod 97-10', () => {
    for (const id of [
      ONE,
      TWO,
      'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ]) {
      const iban = syntheticIban(id)
      expect(validIban(iban), iban).toBe(true)
      const check = Number(iban.slice(2, 4))
      expect(check, iban).toBeGreaterThanOrEqual(2)
      expect(check, iban).toBeLessThanOrEqual(98)
    }
  })

  it('is deterministic in the application id', () => {
    expect(syntheticIban(ONE)).toBe(syntheticIban(ONE))
    expect(syntheticIban(ONE)).toBe(syntheticIban(ONE.toUpperCase()))
  })

  it('differs between applications', () => {
    expect(syntheticIban(ONE)).not.toBe(syntheticIban(TWO))
  })
})

describe('formatIban', () => {
  it('groups by four for reading, and is idempotent', () => {
    const iban = syntheticIban(ONE)
    const shown = formatIban(iban)
    expect(shown).toMatch(/^IE\d{2} SAOI 0000 00\d{2} \d{4} \d{2}$/)
    expect(shown.replace(/ /g, '')).toBe(iban)
    expect(formatIban(shown)).toBe(shown)
  })
})
