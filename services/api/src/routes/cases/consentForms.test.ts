import { describe, expect, it } from 'vitest'
import { asApplicationId } from '@shared/domain/facts.ts'
import { resolveFormState } from '@shared/domain/forms/state.ts'
import { formSnapshot } from '@shared/tenants/demo/forms/snapshots.ts'
import { CASE_ID, USER_ID } from '../../testing.ts'
import { APP_ID, application, loadedCase, writesOf } from '../../testing.actions.ts'
import { LOAN_APP_ID, PROTECTION_APP_ID, world } from './actions.fixture.ts'

const consentPath = `/applications/${PROTECTION_APP_ID}/consent`
const healthPath = `/applications/${PROTECTION_APP_ID}/health-answers`
const declarationsPath = `/applications/${LOAN_APP_ID}/form-declarations`

describe('POST /applications/:id/consent', () => {
  it('records a consent the journey asks for', async () => {
    const { call, actions } = world()
    const got = await call('primary', consentPath, { requirementId: 'health-consent' })
    expect(got.body).toMatchObject({ summary: 'Thanks — noted.' })
    expect(writesOf(actions)).toEqual([
      {
        name: 'grantConsent',
        args: {
          caseId: CASE_ID,
          applicationId: PROTECTION_APP_ID,
          requirementId: 'health-consent',
          participantId: `participant-primary-${USER_ID}`,
        },
      },
    ])
  })

  it('refuses a requirement that is not a confirmation, or not on the journey', async () => {
    const { call, actions } = world()
    expect((await call('primary', consentPath, { requirementId: 'nonsense' })).status).toBe(400)
    // A fact requirement is not something to consent to.
    expect((await call('primary', consentPath, { requirementId: 'income' })).status).toBe(400)
    expect(actions.calls).toEqual([])
  })
})

describe('POST /applications/:id/health-answers', () => {
  const consented = (actions: ReturnType<typeof world>['actions']) => {
    actions.loaded = loadedCase(CASE_ID, {
      applications: [application('protection', 'waiting_customer', PROTECTION_APP_ID)],
      confirmations: [
        { applicationId: asApplicationId(PROTECTION_APP_ID), requirementId: 'health-consent' },
      ],
    })
  }

  it('is refused before consent, and writes nothing (Invariant 6)', async () => {
    const { call, actions } = world()
    const got = await call('primary', healthPath, {
      values: [{ key: 'protection.health.smoker', value: false }],
    })
    expect(got.status).toBe(403)
    expect(got.body).toMatchObject({
      error: { message: 'Health questions cannot be answered before consent.' },
    })
    expect(actions.calls).toEqual([])
  })

  it('writes special-category facts for this participant and application once consented', async () => {
    const { call, actions } = world()
    consented(actions)
    const got = await call('primary', healthPath, {
      values: [{ key: 'protection.health.smoker', value: false }],
    })
    expect(got.status).toBe(200)
    expect(writesOf(actions)).toMatchObject([
      {
        name: 'saveHealthFacts',
        args: {
          caseId: CASE_ID,
          applicationId: PROTECTION_APP_ID,
          rows: [
            {
              key: 'protection.health.smoker',
              value: false,
              participant_id: `participant-primary-${USER_ID}`,
              captured_for: PROTECTION_APP_ID,
              source: 'customer_stated',
            },
          ],
        },
      },
    ])
  })

  it.each([
    ['a key we do not collect', { key: 'nope.nothing', value: 1 }],
    [
      'an ordinary fact (it would dodge the normal checks)',
      { key: 'income.annualBasic', value: 50000 },
    ],
    ['a value of the wrong type', { key: 'protection.health.smoker', value: 'maybe' }],
  ])('refuses %s, writing none of the batch', async (_name, entry) => {
    const { call, actions } = world()
    consented(actions)
    const got = await call('primary', healthPath, {
      values: [{ key: 'protection.health.smoker', value: true }, entry],
    })
    expect(got.status).toBe(400)
    expect(actions.calls).toEqual([])
  })
})

describe('POST /applications/:id/form-declarations', () => {
  it('404s when nothing has been collected for the form', async () => {
    const { call, actions } = world()
    actions.loaded = loadedCase(CASE_ID, {
      applications: [application('personal_loan', 'waiting_customer', LOAN_APP_ID)],
    })
    const got = await call('primary', declarationsPath, { fieldIds: ['1'] })
    expect(got.status).toBe(404)
  })

  it('refuses a field that is not an active declaration on the form', async () => {
    const { call, actions } = world()
    actions.loaded = loadedCase(CASE_ID, {
      applications: [application('personal_loan', 'waiting_customer', LOAN_APP_ID)],
    })
    actions.formApplicationRow = { id: 'form-1', answers: {} }
    const got = await call('primary', declarationsPath, { fieldIds: ['not-a-field'] })
    expect(got.status).toBe(400)
    expect(got.body).toMatchObject({
      error: { message: 'That is not a declaration on this form.' },
    })
    expect(actions.calls).toEqual([])
  })

  it('stores the form’s own wording for a live declaration', async () => {
    const snapshot = formSnapshot('1940')
    if (!snapshot) throw new Error('no snapshot')
    const live = resolveFormState(snapshot.definition, {}).active.find(
      (field) => field.type === 'checkbox',
    )
    if (!live) throw new Error('the loan form has no live declaration on a blank branch')

    const { call, actions } = world()
    actions.loaded = loadedCase(CASE_ID, {
      applications: [application('personal_loan', 'waiting_customer', LOAN_APP_ID)],
    })
    actions.formApplicationRow = { id: 'form-1', answers: {} }
    const got = await call('primary', declarationsPath, { fieldIds: [live.id] })

    expect(got.status).toBe(200)
    expect(got.body).toMatchObject({ summary: '1 declaration recorded.' })
    expect(writesOf(actions)).toMatchObject([
      {
        name: 'saveDeclarations',
        args: {
          formId: '1940',
          applicationId: LOAN_APP_ID,
          writes: [
            {
              form_application_id: 'form-1',
              field_id: live.id,
              wording: live.label.slice(0, 2000),
              participant_id: `participant-primary-${USER_ID}`,
            },
          ],
        },
      },
    ])
  })

  it('refuses an application with no form behind it', async () => {
    const { call } = world()
    const got = await call('primary', `/applications/${APP_ID}/form-declarations`, {
      fieldIds: ['1'],
    })
    expect(got.status).toBe(400)
  })
})
