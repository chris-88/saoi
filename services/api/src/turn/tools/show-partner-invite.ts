import type { Card } from '@shared/contracts/cards.ts'
import { applicationName, evaluateFor, findApplication } from '@shared/db/applications.ts'
import type { ToolModule } from './_shared.ts'

/** How far back a card still counts as "on screen" rather than scrolled into history. */
const INVITE_CARD_WINDOW = 8

export const showPartnerInviteTool: ToolModule<'show_partner_invite'> = {
  name: 'show_partner_invite',
  run(input, ctx) {
    const { loaded, nameFor } = ctx

    const { applicationIds } = input
    const applications = applicationIds
      .map((id) => findApplication(loaded, id))
      .filter((application) => application !== undefined)

    if (applications.length === 0) {
      return { result: 'There is no such application.', refused: true }
    }

    const partner = loaded.participants.find((p) => p.role === 'partner')
    if (partner) {
      return {
        result: `${partner.displayName ?? 'The second applicant'} has already joined. There is nothing left to invite.`,
        refused: true,
      }
    }

    /*
     * Somebody to invite, and something to invite them to. Three savings accounts
     * got an invite card because the model was asked for one, and the second
     * applicant joined to an empty task list: a savings journey asks a partner for
     * nothing. Whether any of these applications has a second applicant's share is
     * the requirement engine's to say, not the model's.
     */
    const needsPartner = applications.some((application) =>
      evaluateFor(loaded, application).outstanding.some(
        (item) => item.requirement.subject === 'partner',
      ),
    )
    if (!needsPartner) {
      return {
        result:
          'None of these applications needs anything from a second applicant, so ' +
          'there is nobody to invite for them. Do not offer an invite; if the ' +
          'customer wants a joint product, that is a product choice.',
        refused: true,
      }
    }

    /**
     * One invite card, not one per turn. Asked nicely, the model re-offered it on
     * almost every turn — four stacked in one transcript — and the customer kept
     * tapping each new one, so the same invite was created three times. The card
     * persists in the transcript, so the one already there is still live.
     */
    const alreadyOnScreen = loaded.messages
      .slice(-INVITE_CARD_WINDOW)
      .some((message) => message.cards.includes('partner_invite'))

    if (alreadyOnScreen) {
      return {
        result:
          'The invite card is already on screen from an earlier turn and still works. Point at it in your own words; do not make another.',
      }
    }

    const card: Card = {
      type: 'partner_invite',
      applicationIds: applications.map((application) => String(application.id)),
      applicationNames: applications.map((application) => applicationName(application, nameFor)),
      // Always null by this point: a joined partner returned above, and a
      // participant row does not exist before they join.
      partnerName: null,
    }

    return {
      result:
        'Invite offered. Nothing is sent until the customer taps and shares it. Say ' +
        'in a line who it is for and why they are needed.',
      card,
    }
  },
}
