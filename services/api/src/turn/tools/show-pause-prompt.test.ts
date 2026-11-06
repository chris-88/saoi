import { describe, expect, it } from 'vitest'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showPausePromptTool } from './show-pause-prompt.ts'

describe('show_pause_prompt', () => {
  it('offers the pause card for an application the loan advisory applies to', async () => {
    const loan = application('personal_loan', 'in_progress')
    const mortgage = application('mortgage', 'in_progress', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    const ctx = toolContext({ loaded: loadedCase(CASE, { applications: [loan, mortgage] }) })

    const outcome = await showPausePromptTool.run({ applicationId: APP_ID }, ctx)

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({ type: 'pause_prompt', applicationId: APP_ID })
  })

  it('refuses an application that is not on the case', async () => {
    const outcome = await showPausePromptTool.run({ applicationId: APP_ID }, toolContext())

    expect(outcome).toEqual({ result: 'There is no such application.', refused: true })
  })
})
