import { describe, expect, it } from 'vitest'
import { CASE_ID, USER_ID } from '../../testing.ts'
import { APP_ID, application, loadedCase, writesOf } from '../../testing.actions.ts'
import { LOAN_APP_ID, world } from './actions.fixture.ts'

const OTHER_APP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

describe('applications', () => {
  it('404s an application that is not on this case', async () => {
    const { call, actions } = world()
    for (const leaf of ['pause', 'resume', 'confirm', 'submit', 'consent']) {
      const got = await call('primary', `/applications/${OTHER_APP}/${leaf}`, {
        requirementId: 'terms',
      })
      expect(got.status, leaf).toBe(404)
    }
    expect(actions.calls).toEqual([])
  })

  describe('confirm', () => {
    it('stores a confirmation for a requirement the journey asks', async () => {
      const { call, actions } = world()
      const got = await call('primary', `/applications/${APP_ID}/confirm`, {
        requirementId: 'terms',
      })
      expect(got.body).toMatchObject({ summary: 'Confirmed.' })
      expect(writesOf(actions)).toEqual([
        {
          name: 'confirmRequirement',
          args: {
            applicationId: APP_ID,
            requirementId: 'terms',
            participantId: `participant-primary-${USER_ID}`,
            kind: 'confirmation',
          },
        },
      ])
    })

    it('refuses a requirement that is not part of the application', async () => {
      const { call, actions } = world()
      const got = await call('primary', `/applications/${APP_ID}/confirm`, {
        requirementId: 'nonsense',
      })
      expect(got.status).toBe(400)
      expect(actions.calls).toEqual([])
    })
  })

  describe('submit', () => {
    it('submits a ready application in one transaction, with its events', async () => {
      const { call, actions } = world()
      actions.loaded = loadedCase(CASE_ID, {
        applications: [application('current_account', 'ready')],
      })
      const got = await call('primary', `/applications/${APP_ID}/submit`, { confirmations: [] })
      expect(got.status).toBe(200)
      expect(got.body).toMatchObject({ summary: 'current_account submitted.' })
      expect(writesOf(actions)).toEqual([
        {
          name: 'submitApplication',
          args: {
            caseId: CASE_ID,
            applicationId: APP_ID,
            participantId: `participant-primary-${USER_ID}`,
            confirmations: [],
            fromState: 'ready',
            toState: 'submitted',
            events: [
              {
                type: 'application_submitted',
                actor: 'customer',
                payload: { applicationName: 'current_account' },
              },
            ],
          },
        },
      ])
    })

    it('refuses what is not ready, with the state machine’s answer, and writes nothing', async () => {
      const { call, actions } = world()
      const got = await call('primary', `/applications/${APP_ID}/submit`, {})
      expect(got.status).toBe(409)
      expect(got.body).toMatchObject({
        error: { code: 'illegal_transition', message: 'That is not ready to submit yet.' },
      })
      expect(actions.calls).toEqual([])
    })

    it('refuses a tick for something the journey does not ask', async () => {
      const { call, actions } = world()
      const got = await call('primary', `/applications/${APP_ID}/submit`, {
        confirmations: ['nonsense'],
      })
      expect(got.status).toBe(400)
      expect(actions.calls).toEqual([])
    })

    it('is a conflict when somebody else got there first', async () => {
      const { call, actions } = world()
      actions.loaded = loadedCase(CASE_ID, {
        applications: [application('current_account', 'ready')],
      })
      actions.submitSucceeds = false
      const got = await call('primary', `/applications/${APP_ID}/submit`, {})
      expect(got.status).toBe(409)
      expect(got.body).toMatchObject({ error: { code: 'conflict' } })
    })
  })

  describe('pause and resume', () => {
    it('pauses through the state machine and remembers where to resume', async () => {
      const { call, actions } = world()
      const got = await call('primary', `/applications/${APP_ID}/pause`)
      expect(got.body).toMatchObject({ summary: 'current_account paused.' })
      expect(writesOf(actions)).toMatchObject([
        {
          name: 'changeApplicationState',
          args: {
            applicationId: APP_ID,
            state: 'paused',
            resumeTo: 'waiting_customer',
            deferLoanNeed: false,
            event: { type: 'application_paused' },
          },
        },
      ])
    })

    it('parks the loan’s need when a personal loan is paused', async () => {
      const { call, actions } = world()
      actions.loaded = loadedCase(CASE_ID, {
        applications: [application('personal_loan', 'waiting_customer', LOAN_APP_ID)],
      })
      await call('primary', `/applications/${LOAN_APP_ID}/pause`)
      expect(writesOf(actions)).toMatchObject([
        { name: 'changeApplicationState', args: { deferLoanNeed: true } },
      ])
    })

    it('resumes a paused application and refuses to resume one that is not paused', async () => {
      const { call, actions } = world()
      expect((await call('primary', `/applications/${APP_ID}/resume`)).status).toBe(409)
      expect(actions.calls).toEqual([])

      actions.loaded = loadedCase(CASE_ID, {
        applications: [application('current_account', 'paused')],
      })
      const got = await call('primary', `/applications/${APP_ID}/resume`)
      expect(got.body).toMatchObject({ summary: 'current_account resumed.' })
      expect(writesOf(actions)).toMatchObject([
        { name: 'changeApplicationState', args: { state: 'in_progress', resumeTo: null } },
      ])
    })
  })
})
