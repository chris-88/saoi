import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeEvent } from '@shared/db/case-repository.ts'
import { toolContext } from './_testing.ts'
import { showProductOptionsTool } from './show-product-options.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
  loadCase: vi.fn(() => Promise.resolve(null)),
}))

beforeEach(() => {
  vi.mocked(writeEvent).mockClear()
})

describe('show_product_options', () => {
  it('offers a product the customer asked for by name and records the offer', async () => {
    const ctx = toolContext({ customerMessage: 'Can I open a savings account please' })

    const outcome = await showProductOptionsTool.run(
      { products: [{ product: 'savings', reason: 'You asked for one.' }] },
      ctx,
    )

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({
      type: 'product_options',
      options: [{ product: 'savings', reason: 'You asked for one.', previouslyDeclined: false }],
    })
    expect(writeEvent).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({ type: 'product_offered', actor: 'model' }),
    )
  })

  it('is refused as too early while Saoirse does not yet understand the position', async () => {
    const outcome = await showProductOptionsTool.run(
      { products: [{ product: 'mortgage', reason: 'You want to buy.' }] },
      toolContext(),
    )

    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
    expect(outcome.result).toMatch(/^Too early/)
    expect(writeEvent).not.toHaveBeenCalled()
  })
})
