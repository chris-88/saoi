import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeEvent } from '@shared/db/case-repository.ts'
import { syncFormApplications } from '@shared/db/form-applications.ts'
import { recordFormAnswers } from '@shared/db/record-form-answers.ts'
import { APP_ID } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { recordFormAnswersTool } from './record-form-answers.ts'

vi.mock('@shared/db/case-repository.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeEvent: vi.fn(() => Promise.resolve()),
}))
vi.mock('@shared/db/form-applications.ts', () => ({ syncFormApplications: vi.fn() }))
vi.mock('@shared/db/record-form-answers.ts', () => ({ recordFormAnswers: vi.fn() }))

beforeEach(() => {
  vi.mocked(recordFormAnswers).mockReset()
  vi.mocked(syncFormApplications).mockReset()
  vi.mocked(writeEvent).mockClear()
})

const input = { applicationId: APP_ID, answers: [{ fieldId: '12', value: 'Dublin' }] }

describe('record_form_answers', () => {
  it('resyncs the form and writes an event when an answer is accepted', async () => {
    vi.mocked(recordFormAnswers).mockResolvedValue({ accepted: ['12'], rejected: [] })
    const ctx = toolContext()

    const outcome = await recordFormAnswersTool.run(input, ctx)

    expect(outcome.result).toBe('Recorded 1 answer.')
    expect(syncFormApplications).toHaveBeenCalledWith(ctx.admin, CASE)
    expect(writeEvent).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({ type: 'form_answered', payload: { fields: 1 } }),
    )
  })

  it('records nothing and notes the rejection when every answer bounces', async () => {
    vi.mocked(recordFormAnswers).mockResolvedValue({
      accepted: [],
      rejected: [{ fieldId: '12', reason: 'not a question on this form' }],
    })
    const ctx = toolContext()

    const outcome = await recordFormAnswersTool.run(input, ctx)

    expect(outcome.result).toBe('Nothing recorded. not a question on this form')
    expect(syncFormApplications).not.toHaveBeenCalled()
    expect(writeEvent).not.toHaveBeenCalled()
    expect(ctx.rejections).toEqual([
      { name: 'record_form_answers', error: '12: not a question on this form' },
    ])
  })
})
