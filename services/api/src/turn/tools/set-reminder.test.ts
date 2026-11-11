import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReminder } from '@shared/db/alerts.ts'
import { CASE, toolContext } from './_testing.ts'
import { setReminderTool } from './set-reminder.ts'

vi.mock('@shared/db/alerts.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createReminder: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(createReminder).mockReset()
})

describe('set_reminder', () => {
  it('keeps the date as the customer gave it, against their case and seat', async () => {
    vi.mocked(createReminder).mockResolvedValue({
      id: '9f8b0c7e-0000-4000-8000-000000000001',
      kind: 'fixed_rate_ends',
      label: 'AIB fixed rate',
      dueOn: '2099-03-01',
      productId: null,
      createdAt: '2026-11-11T09:00:00.000Z',
    })
    const outcome = await setReminderTool.run(
      { kind: 'fixed_rate_ends', dueOn: '2099-03-01', label: 'AIB fixed rate' },
      toolContext(),
    )
    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toBeUndefined()
    expect(outcome.result).toMatch(/^Kept: AIB fixed rate, 1 Mar 2099\./)
    expect(createReminder).toHaveBeenCalledWith(expect.anything(), {
      caseId: CASE,
      kind: 'fixed_rate_ends',
      label: 'AIB fixed rate',
      dueOn: '2099-03-01',
      createdBy: 'participant-primary',
      actor: 'model',
    })
  })

  it('refuses a date that has passed or does not exist, and writes nothing', async () => {
    for (const dueOn of ['2020-01-01', '2099-02-30']) {
      const outcome = await setReminderTool.run(
        { kind: 'deposit_matures', dueOn, label: 'Deposit' },
        toolContext(),
      )
      expect(outcome.refused).toBe(true)
    }
    expect(createReminder).not.toHaveBeenCalled()
  })

  it('refuses when the date could not be kept', async () => {
    vi.mocked(createReminder).mockRejectedValue(new Error('database down'))
    const outcome = await setReminderTool.run(
      { kind: 'other', dueOn: '2099-03-01', label: 'Car insurance' },
      toolContext(),
    )
    expect(outcome).toEqual({ result: 'That date could not be kept just now.', refused: true })
  })
})
