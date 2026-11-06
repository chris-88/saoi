import { beforeEach, describe, expect, it, vi } from 'vitest'
import { arrange } from '@shared/domain/savings/arrange.ts'
import { loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showArrangementTool } from './show-arrangement.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadCase: vi.fn(() => Promise.resolve(loadedCase('0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11'))),
}))
vi.mock('@shared/domain/savings/arrange.ts', () => ({ arrange: vi.fn() }))

beforeEach(() => {
  vi.mocked(arrange).mockReset()
})

describe('show_arrangement', () => {
  it('renders the split the engine worked out', async () => {
    vi.mocked(arrange).mockReturnValue({
      needs: [],
      allocations: [
        {
          productId: 'savings.supersaver',
          name: 'SuperSaver',
          amount: 500,
          cadence: 'monthly',
          termMonths: null,
          annualRate: 0.02,
          job: 'Everyday saving',
          watch: [],
        },
      ],
      firstYearInterest: 120,
      bonus: null,
      notes: [],
    } as never)

    const outcome = await showArrangementTool.run({}, toolContext())

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({
      type: 'arrangement',
      allocations: [{ catalogueId: 'savings.supersaver', amount: 500, cadence: 'monthly' }],
      firstYearInterest: 120,
    })
  })

  it('refuses while the facts the split depends on are missing', async () => {
    vi.mocked(arrange).mockReturnValue({
      needs: [{ why: 'How much do you save each month?' }],
      allocations: [],
    } as never)

    const outcome = await showArrangementTool.run({}, toolContext())

    expect(outcome.refused).toBe(true)
    expect(outcome.result).toBe(
      'Not yet. Before this can be arranged, ask: How much do you save each month? One question, then show it next turn.',
    )
    expect(CASE).toBeTruthy()
  })
})
