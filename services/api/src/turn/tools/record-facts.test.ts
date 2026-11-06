import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordFacts, writeEvent } from '@shared/db/case-repository.ts'
import { toolContext } from './_testing.ts'
import { recordFactsTool } from './record-facts.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordFacts: vi.fn(),
  writeEvent: vi.fn(() => Promise.resolve()),
  loadCase: vi.fn(() => Promise.resolve(null)),
}))

beforeEach(() => {
  vi.mocked(recordFacts).mockReset()
  vi.mocked(writeEvent).mockClear()
})

describe('record_facts', () => {
  it('writes an event per accepted fact', async () => {
    vi.mocked(recordFacts).mockResolvedValue({ accepted: ['household.buyingWith'], rejected: [] })
    const ctx = toolContext()

    const outcome = await recordFactsTool.run(
      { facts: [{ key: 'household.buyingWith', value: 'partner' }] },
      ctx,
    )

    expect(outcome.result).toBe('Recorded 1.')
    expect(writeEvent).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({
        type: 'context_captured',
        payload: { key: 'household.buyingWith' },
      }),
    )
    expect(ctx.rejections).toEqual([])
  })

  it('reports a rejected fact and notes it for the turn', async () => {
    vi.mocked(recordFacts).mockResolvedValue({
      accepted: [],
      rejected: [{ key: 'health.condition', reason: 'not extractable' }],
    })
    const ctx = toolContext()

    const outcome = await recordFactsTool.run(
      { facts: [{ key: 'health.condition' as never, value: 'x' }] },
      ctx,
    )

    expect(outcome.result).toBe('Recorded 0. Not recorded — health.condition: not extractable')
    expect(outcome.refused).toBeUndefined()
    expect(writeEvent).not.toHaveBeenCalled()
    expect(ctx.rejections).toEqual([
      { name: 'record_facts', error: 'health.condition: not extractable' },
    ])
  })
})
