import { describe, expect, it } from 'vitest'
import { CORE_STATEMENT } from '../../market/disclosures.ts'
import { ABOUT } from './about.ts'

describe('what Saoi says about itself (decision 2026-11-10)', () => {
  it('earns nothing from any provider, never mentions referral fees, and says it is not regulated', () => {
    const text = ABOUT.earnings.text
    expect(text).toMatch(/Saoi is free, and it earns nothing from any provider/)
    expect(text).not.toMatch(/intends to earn|the way a broker does|earns nothing today/)
    expect(text).toMatch(/home calculator keeps one anonymous\s+row of bands/)
    // The AI usage record (2026-11-14): what is kept when an AI calls, and what never is.
    expect(text.replace(/\s+/g, ' ')).toContain(
      'When an AI calls Saoi, Saoi records which assistant, which tool, the figures in bands and any search words, and the time; no name, address or account.',
    )
    expect(text).toContain(CORE_STATEMENT)
    for (const about of Object.values(ABOUT)) {
      // "regulated by the Central Bank" only ever follows "not".
      expect(about.text.replaceAll('not regulated by the Central Bank', '')).not.toMatch(
        /regulated by the Central Bank/,
      )
      expect(about.text).not.toMatch(/\b(independent|adviser|broker)\b/i)
      expect(about.text).not.toMatch(/referral/i)
    }
  })
})
