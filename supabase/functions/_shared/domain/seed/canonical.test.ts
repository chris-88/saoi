import { describe, expect, it } from 'vitest'
import { factCatalogue, isFactKey, parseFactValue } from '../facts.ts'
import { PRODUCTS } from '../journey.ts'
import {
  bankHeldFacts,
  canonicalCase,
  canonicalCustomer,
  canonicalPartner,
  canonicalProductInterests,
  discoverableFacts,
  type SeedFact,
} from './canonical.ts'

const allSeedFacts: readonly SeedFact[] = [...bankHeldFacts, ...discoverableFacts]

/**
 * The seed is data, so it can drift out of step with the catalogue silently. These tests are
 * what stop a reset from loading a case the requirement engine cannot read.
 */
describe('the canonical seed', () => {
  it('uses only fact keys the catalogue defines', () => {
    const unknown = allSeedFacts.filter((fact) => !isFactKey(fact.key)).map((fact) => fact.key)
    expect(unknown).toEqual([])
  })

  it('holds a valid value for every fact', () => {
    const invalid: string[] = []
    for (const fact of allSeedFacts) {
      const result = parseFactValue(fact.key, fact.value)
      if (!result.ok) invalid.push(`${fact.key}: ${result.issues.join('; ')}`)
    }
    expect(invalid).toEqual([])
  })

  it('puts every fact against a subject the catalogue agrees with', () => {
    const mismatched: string[] = []
    for (const fact of allSeedFacts) {
      const expected = factCatalogue[fact.key].subject
      const isHousehold = fact.subject === 'household'
      if (expected === 'household' && !isHousehold)
        mismatched.push(`${fact.key} is household-level`)
      if (expected === 'person' && isHousehold) mismatched.push(`${fact.key} belongs to a person`)
    }
    expect(mismatched).toEqual([])
  })

  it('seeds no special-category data: health is only ever collected live, with consent', () => {
    const special = allSeedFacts.filter((fact) => factCatalogue[fact.key].sensitivity === 'special')
    expect(special).toEqual([])
  })

  it('offers every supported product exactly once (§7)', () => {
    const products = canonicalProductInterests.map((interest) => interest.product)
    expect([...products].sort()).toEqual([...PRODUCTS].sort())
  })

  it("treats the mortgage as the customer's own request and the rest as discovered (§6 Stage 3)", () => {
    const mortgage = canonicalProductInterests.find((i) => i.product === 'mortgage')
    expect(mortgage?.discovered).toBe(false)
    expect(
      canonicalProductInterests.filter((i) => i.product !== 'mortgage').every((i) => i.discovered),
    ).toBe(true)
  })

  it('carries the deliberately stale marital status the bank still holds', () => {
    const banksVersion = bankHeldFacts.find((f) => f.key === 'identity.maritalStatus')
    const customersVersion = discoverableFacts.find((f) => f.key === 'identity.maritalStatus')

    expect(banksVersion?.value).toBe('single')
    expect(customersVersion?.value).toBe('married')
  })

  it('names the partner Emma, as the requirements do', () => {
    expect(canonicalPartner.firstName).toBe('Emma')
  })

  it('keeps every contact detail unroutable, because the data is synthetic (Invariant 10)', () => {
    for (const person of [canonicalCustomer, canonicalPartner]) {
      expect(person.email, person.label).toMatch(/\.invalid$/)
    }
    expect(canonicalCase.customer.bankReference).toMatch(/SYNTHETIC/)
  })
})
