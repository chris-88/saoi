import { describe, expect, it } from 'vitest'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showFormTool } from './show-form.ts'

describe('show_form', () => {
  it('asks for consent before any health question when the journey requires it', async () => {
    const loaded = loadedCase(CASE, { applications: [application('protection', 'in_progress')] })

    const outcome = await showFormTool.run({ applicationId: APP_ID }, toolContext({ loaded }))

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({ type: 'consent', applicationId: APP_ID })
  })

  it('refuses when no form is outstanding for the application', async () => {
    const loaded = loadedCase(CASE, { applications: [application('savings', 'in_progress')] })

    const outcome = await showFormTool.run({ applicationId: APP_ID }, toolContext({ loaded }))

    expect(outcome).toEqual({
      result: 'There is no form outstanding for that application.',
      refused: true,
    })
  })
})
