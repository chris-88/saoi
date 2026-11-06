import { describe, expect, it } from 'vitest'
import { asParticipantId } from '@shared/domain/facts.ts'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showPartnerInviteTool } from './show-partner-invite.ts'

describe('show_partner_invite', () => {
  it('offers the invite when an application is waiting on a second applicant', async () => {
    const loaded = loadedCase(CASE, { applications: [application('joint_account', 'in_progress')] })

    const outcome = await showPartnerInviteTool.run(
      { applicationIds: [APP_ID] },
      toolContext({ loaded }),
    )

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({ type: 'partner_invite', applicationIds: [APP_ID] })
  })

  it('refuses when the partner has already joined', async () => {
    const loaded = loadedCase(CASE, {
      applications: [application('joint_account', 'in_progress')],
      participants: [
        { id: asParticipantId('participant-primary'), role: 'primary', displayName: null },
        { id: asParticipantId('participant-partner'), role: 'partner', displayName: 'Emma' },
      ],
    })

    const outcome = await showPartnerInviteTool.run(
      { applicationIds: [APP_ID] },
      toolContext({ loaded }),
    )

    expect(outcome.refused).toBe(true)
    expect(outcome.result).toMatch(/^Emma has already joined/)
  })
})
