import { beforeEach, describe, expect, it, vi } from 'vitest'
import { proposePlan } from '@shared/db/plans.ts'
import { toolContext } from './_testing.ts'
import { proposePlanTool } from './propose-plan.ts'

vi.mock('@shared/db/plans.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  proposePlan: vi.fn(),
}))

/** Enough of the Supabase query builder for `plans` lookups: the rows are what the test gives. */
const adminWithPlans = (rows: { id: string; goal: string }[]) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    }),
  }) as never

beforeEach(() => {
  vi.mocked(proposePlan).mockReset()
})

describe('propose_plan', () => {
  it('saves a draft and offers it as a card', async () => {
    vi.mocked(proposePlan).mockResolvedValue('plan-1')

    const outcome = await proposePlanTool.run(
      { goal: 'other', title: 'Save for a wedding' },
      toolContext({ admin: adminWithPlans([]) }),
    )

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({
      type: 'plan_proposal',
      planId: 'plan-1',
      title: 'Save for a wedding',
      confirmLabel: 'Keep this plan',
    })
  })

  it('refuses a second plan for the same goal', async () => {
    const outcome = await proposePlanTool.run(
      { goal: 'other', title: 'Save for a wedding' },
      toolContext({ admin: adminWithPlans([{ id: 'plan-0', goal: 'other' }]) }),
    )

    expect(outcome.refused).toBe(true)
    expect(outcome.result).toMatch(/^They already have a plan for this goal/)
    expect(proposePlan).not.toHaveBeenCalled()
  })

  it('refuses when the draft could not be saved', async () => {
    vi.mocked(proposePlan).mockResolvedValue(null)

    const outcome = await proposePlanTool.run(
      { goal: 'other', title: 'Save for a wedding' },
      toolContext({ admin: adminWithPlans([]) }),
    )

    expect(outcome).toEqual({ result: 'That plan could not be saved just now.', refused: true })
  })
})
