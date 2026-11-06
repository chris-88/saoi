import { CONSENT_SCOPE, LINKABLE_BANKS, type Card } from '@shared/contracts/cards.ts'
import type { ToolModule } from './_shared.ts'

/**
 * Open banking, simulated. The consent card waits for a decision the customer may take a few
 * turns to make, so it stays "on screen" about as long as the arrangement; a transfer is
 * acted on or passed over sooner.
 */
const CONNECT_CARD_WINDOW = 6

/** How long the consent runs, as the consent screen states it. */
const CONSENT_DAYS = 90

/*
 * The arrangement, from the engine, with nothing from the model.
 *
 * Every figure is `arrange()`'s arithmetic on the published rates; the model's
 * only part is the sentence it says beside the card. Each allocation carries the
 * journey product and the catalogue id separately, because nine savings accounts
 * share one `savings` journey and one tap has to start the right ones.
 */
/*
 * Open banking, simulated (§6, §53). Three cards: the consent, the overview and
 * the transfer. Nothing is linked and nothing moves until the customer taps, and
 * every figure on every card is read from the linked rows by the server. The
 * model supplies one line of why for the consent and the name of an application
 * for the transfer, and nothing else.
 */
export const showConnectAccountsTool: ToolModule<'show_connect_accounts'> = {
  name: 'show_connect_accounts',
  run(input, ctx) {
    const { loaded } = ctx

    const { why } = input

    if (loaded.linkedAccounts.length > 0) {
      return {
        result: 'Their accounts are already linked; use show_accounts to show them.',
        refused: true,
      }
    }

    // One consent card, not one per turn. The one on screen still works, and the
    // digest says when something has been linked from it.
    const onScreen = loaded.messages
      .slice(-CONNECT_CARD_WINDOW)
      .some((message) => message.cards.includes('connect_accounts'))
    if (onScreen) {
      return {
        result:
          'The link-your-accounts card is already on screen from an earlier turn and ' +
          'still works. Point at it in your own words; do not draw another.',
      }
    }

    const card: Card = {
      type: 'connect_accounts',
      why,
      banks: LINKABLE_BANKS.map((bank) => ({ id: bank.id, name: bank.name })),
      scope: [...CONSENT_SCOPE],
      consentDays: CONSENT_DAYS,
    }

    return {
      result:
        'Link card shown. Nothing is linked until they pick a bank and consent. Say ' +
        'one line about why, and stop: nothing about what the accounts hold, because ' +
        'nothing can be seen yet.',
      card,
    }
  },
}
