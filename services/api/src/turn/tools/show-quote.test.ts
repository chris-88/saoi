import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeEvent } from '@shared/db/case-repository.ts'
import { loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showQuoteTool } from './show-quote.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
}))

beforeEach(() => {
  vi.mocked(writeEvent).mockClear()
})

describe('show_quote', () => {
  it('shows the options worked out by the engine and records that a quote was shown', async () => {
    const outcome = await showQuoteTool.run(
      { product: 'mortgage', amount: 300_000, months: 360 },
      toolContext(),
    )

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({ type: 'quote', product: 'mortgage' })
    expect(writeEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'product_quoted',
        payload: { product: 'mortgage', basis: expect.any(String) as string },
      }),
    )
  })

  it('does not show a second quote while the first is on screen', async () => {
    const loaded = loadedCase(CASE, {
      messages: [{ role: 'assistant', content: '', cards: ['quote'], createdAt: '', timing: null }],
    })

    const outcome = await showQuoteTool.run(
      { product: 'mortgage', amount: 300_000, months: 360 },
      toolContext({ loaded }),
    )

    expect(outcome.card).toBeUndefined()
    expect(outcome.result).toMatch(/already on screen/)
    expect(writeEvent).not.toHaveBeenCalled()
  })

  it('refuses when there is nothing to work a quote out from', async () => {
    const outcome = await showQuoteTool.run({ product: 'mortgage' }, toolContext())

    expect(outcome.refused).toBe(true)
    expect(outcome.result).toMatch(/^No options to show: /)
  })
})
