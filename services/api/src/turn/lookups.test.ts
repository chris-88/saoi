import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHoldings } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { productsHoldings, productsPlan } from '@shared/domain/market/products-card.fixture.ts'
import { PRESETS, toneBucket } from '@shared/llm/persona.ts'
import { loadedCase } from '../testing.actions.ts'
import { admit } from './gate.ts'
import { holdsMarketFigures } from './lookups.ts'

vi.mock('@shared/db/holdings.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadHoldings: vi.fn(),
}))
vi.mock('@shared/db/saved-plans.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadClaimedPlans: vi.fn(),
}))

const competitor = { category: 'competitor', profanity: false, sensitive: false } as const

/** A message the classifier reads as about another provider, through the turn's own test. */
async function askAboutAnotherBank(): Promise<boolean> {
  const gate = await admit({
    isCustomerTurn: true,
    customerMessage: 'How does my AIB account compare with bunq?',
    loaded: loadedCase('case'),
    classify: vi.fn(() => Promise.resolve(competitor)),
    tone: toneBucket(PRESETS.default),
    comparesProviders: await holdsMarketFigures({} as never, 'case'),
  })
  return gate.allowed
}

beforeEach(() => {
  vi.mocked(loadHoldings).mockReset().mockResolvedValue([])
  vi.mocked(loadClaimedPlans).mockReset().mockResolvedValue([])
})

describe('holdsMarketFigures: one test for show_products and the cross-provider gate', () => {
  it('is true with a claimed plan, with holdings alone, and false with neither', async () => {
    expect(await holdsMarketFigures({} as never, 'case')).toBe(false)

    vi.mocked(loadHoldings).mockResolvedValue(productsHoldings())
    expect(await holdsMarketFigures({} as never, 'case')).toBe(true)

    vi.mocked(loadHoldings).mockResolvedValue([])
    vi.mocked(loadClaimedPlans).mockResolvedValue([{ id: 'plan-1', plan: productsPlan() }])
    expect(await holdsMarketFigures({} as never, 'case')).toBe(true)
  })

  it('counts a holdings read that fails as none', async () => {
    vi.mocked(loadHoldings).mockRejectedValue(new Error('down'))
    expect(await holdsMarketFigures({} as never, 'case')).toBe(false)
  })

  it('lets a customer with holdings and no plan ask how their account compares', async () => {
    expect(await askAboutAnotherBank()).toBe(false)
    vi.mocked(loadHoldings).mockResolvedValue(productsHoldings())
    expect(await askAboutAnotherBank()).toBe(true)
  })
})
