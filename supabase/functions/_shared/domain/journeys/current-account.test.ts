import { describe, expect, it } from 'vitest'
import { currentAccount, jointAccount } from './index.ts'
import { needCatalogue } from '../needs/catalogue.ts'
import { factCatalogue } from '../facts.ts'

/**
 * A current account in one name.
 *
 * Somebody banking on their own was told the only current account on offer was a joint one,
 * because the joint journey was built first — it is the one that demonstrates invitation and
 * partner completion. A gap in the catalogue read as a gap in the bank.
 */
describe('the current account journey', () => {
  it('asks nothing of a second person', () => {
    expect(currentAccount.supportsPartner).toBe(false)

    for (const requirement of currentAccount.requirements) {
      expect(requirement.subject, requirement.id).toBe('primary')
    }
  })

  it('asks for less than the joint account, which needs two of everything', () => {
    expect(currentAccount.requirements.length).toBeLessThan(jointAccount.requirements.length)
  })

  it('asks nothing about income, because nothing is being lent', () => {
    const facts = currentAccount.requirements.flatMap((r) => (r.kind === 'fact' ? [r.fact] : []))

    expect(facts.some((key) => key.startsWith('income.'))).toBe(false)
    expect(facts.some((key) => key.startsWith('liabilities.'))).toBe(false)
  })

  it('uses only fact keys the catalogue defines', () => {
    for (const requirement of currentAccount.requirements) {
      if (requirement.kind !== 'fact') continue
      expect(factCatalogue[requirement.fact], requirement.fact).toBeDefined()
    }
  })

  it('takes its declaration fresh, like every other account', () => {
    const terms = currentAccount.requirements.find((r) => r.kind === 'declaration')

    expect(terms).toBeDefined()
    expect(terms?.kind === 'declaration' && terms.fresh).toBe(true)
  })
})

describe('the need that reaches it', () => {
  const need = needCatalogue.find((candidate) => candidate.id === 'everyday_banking')

  it('exists, so the product can be discovered and not only asked for', () => {
    expect(need).toBeDefined()
    expect(need?.products).toEqual(['current_account'])
  })

  it('says nothing to somebody already paid into an account here', () => {
    expect(need?.suppressions.map((rule) => rule.id)).toContain('already_banks_here')
  })

  it('is high priority, because a first account is the whole reason some people come', () => {
    // Below the mortgage, which is very high: nobody needs this to get one.
    expect(need?.priority).toBe('high')
  })

  it('frames it as what it enables rather than as a requirement', () => {
    expect(need?.framing).toMatch(/never a condition of anything else/i)
  })
})
