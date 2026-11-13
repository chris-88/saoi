import { describe, expect, it } from 'vitest'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import {
  LOOKUP_ANSWER_RULE,
  LOOKUP_MISS_RULE,
  lookupProducts,
  lookupResultText,
  marketSummary,
  parseQuery,
} from './lookup.ts'
import { normaliseMarket } from './normalise.ts'

const MARKET = normaliseMarket(MARKET_FIXTURE)

describe('parseQuery', () => {
  it('takes a term out of the words and drops quoted rates and filler', () => {
    expect(parseQuery('BOI 18m fix at 2.48%')).toEqual({ words: ['boi', 'fix'], term: 18 })
    expect(parseQuery('AIB 24 month fixed for 2.26%')).toEqual({
      words: ['aib', 'fixed'],
      term: 24,
    })
    expect(parseQuery('a 2 year fixed mortgage')).toEqual({
      words: ['fixed', 'mortgage'],
      term: 24,
    })
    expect(parseQuery('MoCo')).toEqual({ words: ['moco'], term: null })
  })
})

describe('lookupProducts', () => {
  it('finds a provider’s products by its name alone', () => {
    const outcome = lookupProducts(MARKET, { query: 'MoCo' })
    expect(outcome.matches.length).toBeGreaterThan(0)
    expect(outcome.matches.every((fact) => fact.id.startsWith('moco:'))).toBe(true)
    const easySaver = outcome.matches[0]
    expect(easySaver?.product).toBe('MoCo EasySaver')
    expect(easySaver?.rate).toBe('2.10% AER variable')
    expect(easySaver?.access).toBe('instant access')
    expect(easySaver?.conditions.join(' ')).toMatch(/opened now/)
  })

  it('finds the 24-month term of AIB’s fixed term deposit, with its source and day', () => {
    const outcome = lookupProducts(MARKET, { query: 'AIB 24 month fixed' })
    expect(outcome.matches).toHaveLength(1)
    const fact = outcome.matches[0]
    expect(fact).toMatchObject({
      provider: 'AIB',
      product: 'Personal Fixed Term Deposit',
      category: 'deposit',
      source: 'CCPC',
      checkedOn: '2026-11-09',
      confirmed: true,
    })
    expect(fact?.rate).toMatch(/^2\.26% AER for 2 years, fixed for the term; also 6 months 1\.50%/)
    expect(fact?.attribution).toContain('Competition and Consumer Protection Commission')
    expect(outcome.termNotListed).toBeNull()
  })

  it('finds Bank of Ireland’s 18-month fixed by the bank’s name and the customer’s words', () => {
    const outcome = lookupProducts(MARKET, { query: 'Bank of Ireland 18m fix at 2.48%' })
    expect(outcome.matches.map((fact) => fact.id)).toEqual(['boi:savings.advantage_fixed'])
    expect(outcome.matches[0]?.rate).toMatch(/^2\.48% AER for 18 months/)
  })

  it('says when the products found do not list the term asked for', () => {
    const outcome = lookupProducts(MARKET, { query: 'BOI Advantage fixed 24 month' })
    expect(outcome.matches.map((fact) => fact.id)).toEqual(['boi:savings.advantage_fixed'])
    expect(outcome.termNotListed).toBe(24)
    expect(lookupResultText(outcome)).toContain('None of these lists a 24-month term.')
  })

  it('narrows by category and caps the list, counting the rest', () => {
    const outcome = lookupProducts(MARKET, { query: 'boi', category: 'mortgage', limit: 3 })
    expect(outcome.matches).toHaveLength(3)
    expect(outcome.matches.every((fact) => fact.category === 'mortgage')).toBe(true)
    expect(outcome.more).toBeGreaterThan(0)
  })

  it('finds nothing for a provider the market does not hold, and says so', () => {
    const outcome = lookupProducts(MARKET, { query: 'Revolut savings' })
    expect(outcome.matches).toEqual([])
    const text = lookupResultText(outcome)
    expect(text).toContain('found nothing for “Revolut savings”')
    expect(text).toContain(LOOKUP_MISS_RULE)
  })

  it('keeps to the provider named when one word matches nothing', () => {
    const outcome = lookupProducts(MARKET, { query: 'AIB fixed bond' })
    expect(outcome.partial).toBe(true)
    expect(outcome.matches.every((fact) => fact.provider === 'AIB')).toBe(true)
    expect(outcome.unmatched).toEqual(['bond'])
  })
})

describe('lookupResultText', () => {
  it('states each product as facts, then how to answer from them, with no advice words', () => {
    const text = lookupResultText(lookupProducts(MARKET, { query: 'AIB 24 month fixed' }))
    expect(text).toContain('1. AIB, Personal Fixed Term Deposit (deposit; id aib:')
    expect(text).toContain('Rate: 2.26% AER for 2 years')
    expect(text).toContain('Term or access: fixed term: 6 months, 12 months, 2 years')
    expect(text).toMatch(
      /Source: CCPC \(Source: Competition and Consumer Protection Commission, www\.ccpc\.ie\), checked 9 Nov(ember)? 2026\./,
    )
    expect(text.endsWith(LOOKUP_ANSWER_RULE)).toBe(true)
    expect(adviceWordsIn(text)).toEqual([])
  })

  it('holds every fixed line and every product in the fixture to the advice words', () => {
    expect(adviceWordsIn(`${LOOKUP_ANSWER_RULE}\n${LOOKUP_MISS_RULE}`)).toEqual([])
    for (const view of MARKET.products) {
      const text = lookupResultText(lookupProducts(MARKET, { query: view.name, limit: 8 }))
      expect(adviceWordsIn(text), view.id).toEqual([])
    }
  })
})

describe('marketSummary', () => {
  it('counts by category and provider and names the day last checked, with no figure', () => {
    const summary = marketSummary(MARKET)
    expect(summary.total).toBe(MARKET.products.length)
    expect(summary.byCategory.reduce((sum, entry) => sum + entry.count, 0)).toBe(summary.total)
    expect(summary.byProvider.map((entry) => entry.name)).toContain('AIB')
    expect(summary.checkedOn).toMatch(/^2026-11-\d{2}$/)
  })
})
