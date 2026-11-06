import { describe, expect, it } from 'vitest'
import { asApplicationId, asFactId, type FactKey } from '@shared/domain/facts.ts'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showReviewTool } from './show-review.ts'

const fact = (key: string, value: unknown, subject = 'participant-primary') => ({
  id: asFactId(`fact-${key}`),
  key: key as FactKey,
  subject: subject as never,
  value,
  source: 'customer_stated' as const,
  verified: false,
  capturedFor: asApplicationId(APP_ID),
  supersededBy: null,
  capturedAt: '2026-11-01T10:00:00.000Z',
})

describe('show_review', () => {
  it('builds the review card from the case once everything blocking is in', async () => {
    const loaded = loadedCase(CASE, {
      applications: [application('savings', 'in_progress')],
      facts: [
        fact('identity.fullName', 'Aoife Byrne'),
        fact('identity.dateOfBirth', '1990-04-12'),
        fact('identity.address', '1 Main Street, Dublin'),
        fact('identity.ppsn', '1234567AB'),
        fact('goals.savingsTarget', 20000, 'household'),
        fact('goals.monthlySaving', 500, 'household'),
      ],
    })

    const outcome = await showReviewTool.run({ applicationId: APP_ID }, toolContext({ loaded }))

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({ type: 'review', applicationId: APP_ID })
    expect(outcome.result).toMatch(/^Review shown\. Nothing is submitted/)
  })

  it('refuses a review while real information is still missing', async () => {
    const loaded = loadedCase(CASE, { applications: [application('mortgage', 'in_progress')] })

    const outcome = await showReviewTool.run({ applicationId: APP_ID }, toolContext({ loaded }))

    expect(outcome.refused).toBe(true)
    expect(outcome.result).toMatch(/^Not ready to review\. Still needed: /)
  })
})
