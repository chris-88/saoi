import { describe, expect, it, vi } from 'vitest'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showFormUploadTool } from './show-form-upload.ts'

// Which page of the real form surfaces a document depends on dozens of answers; the tool's own
// job is to turn the next outstanding upload field into a card, so the form state is the stub.
vi.mock('@shared/domain/forms/state.ts', () => ({
  resolveFormState: vi.fn(() => ({
    outstanding: [
      {
        id: '77',
        type: 'fileupload',
        label: 'Proof of income',
        platform: { maxFileSize: '5', allowedExtensions: 'PDF, jpg' },
      },
    ],
  })),
}))

describe('show_form_upload', () => {
  it('asks for the next document the form wants, with the control’s own limits', () => {
    const loaded = loadedCase(CASE, {
      applications: [application('personal_loan', 'in_progress')],
      formApplications: [{ id: 'form-app-1', formId: '1940', answers: {} }],
    })

    const outcome = showFormUploadTool.run({ applicationId: APP_ID }, toolContext({ loaded }))

    expect(outcome).toMatchObject({
      card: {
        type: 'form_upload',
        formApplicationId: 'form-app-1',
        fieldId: '77',
        label: 'Proof of income',
        acceptedExtensions: ['pdf', 'jpg'],
        maxFileSizeMb: 5,
      },
    })
  })

  it('refuses before anything has been collected for the form', () => {
    const loaded = loadedCase(CASE, { applications: [application('savings', 'in_progress')] })

    const outcome = showFormUploadTool.run({ applicationId: APP_ID }, toolContext({ loaded }))

    expect(outcome).toEqual({
      result: 'Nothing has been collected for that form yet.',
      refused: true,
    })
  })
})
