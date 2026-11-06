import { describe, expect, it } from 'vitest'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { requestUploadTool } from './request-upload.ts'

/** The `application_requests` insert, answering with a row id or an error. */
const adminInserting = (result: { data: { id: string } | null; error: object | null }) =>
  ({
    from: () => ({
      insert: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }),
    }),
  }) as never

const loaded = loadedCase(CASE, { applications: [application('current_account', 'in_progress')] })

describe('request_upload', () => {
  it('opens a request for the next outstanding document and shows the upload card', async () => {
    const ctx = toolContext({
      loaded,
      admin: adminInserting({ data: { id: 'request-1' }, error: null }),
    })

    const outcome = await requestUploadTool.run(
      { applicationId: APP_ID, documentType: 'photo_id' },
      ctx,
    )

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({
      type: 'upload_request',
      requestId: 'request-1',
      applicationId: APP_ID,
      documentType: 'photo_id',
    })
  })

  it('refuses an application that is not on the case', async () => {
    const outcome = await requestUploadTool.run({ applicationId: APP_ID }, toolContext())

    expect(outcome).toEqual({ result: 'There is no such application.', refused: true })
  })

  it('says so, without a card, when the request cannot be saved', async () => {
    const ctx = toolContext({
      loaded,
      admin: adminInserting({ data: null, error: { message: 'boom' } }),
    })

    const outcome = await requestUploadTool.run({ applicationId: APP_ID }, ctx)

    expect(outcome).toEqual({ result: 'That could not be requested just now.' })
  })
})
