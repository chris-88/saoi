import { describe, expect, it } from 'vitest'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showFormDeclarationsTool } from './show-form-declarations.ts'

describe('show_form_declarations', () => {
  it('shows the declarations the form still needs, in its own wording', async () => {
    const loaded = loadedCase(CASE, {
      applications: [application('savings', 'in_progress')],
      formApplications: [{ id: 'form-app-1', formId: '1833', answers: {} }],
    })

    const outcome = await showFormDeclarationsTool.run(
      { applicationId: APP_ID },
      toolContext({ loaded }),
    )

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({ type: 'form_declarations', applicationId: APP_ID })
  })

  it('refuses a product with no bank form behind it', async () => {
    const loaded = loadedCase(CASE, { applications: [application('mortgage', 'in_progress')] })

    const outcome = await showFormDeclarationsTool.run(
      { applicationId: APP_ID },
      toolContext({ loaded }),
    )

    expect(outcome).toEqual({
      result: 'That application has no bank form behind it.',
      refused: true,
    })
  })
})
