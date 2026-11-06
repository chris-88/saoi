import { lastTransferOffered } from '../lookups.ts'
import { EXISTING_ACCOUNT_HERE } from '@shared/llm/tools.ts'
import type { Card } from '@shared/contracts/cards.ts'
import { applicationName, findApplication } from '@shared/db/applications.ts'
import {
  APPLICATION_STATES,
  stateLabel,
  type ApplicationState,
} from '@shared/domain/state-machine.ts'
import { caseFactReader } from '@shared/db/fact-reader.ts'
import type { Product } from '@shared/domain/journey.ts'
import type { ToolModule } from './_shared.ts'
import { money } from './_shared.ts'

const TRANSFER_CARD_WINDOW = 4

/** The applications money can be moved into: an account, not a loan or a policy. */
const TRANSFER_PRODUCTS: ReadonlySet<Product> = new Set<Product>([
  'savings',
  'current_account',
  'joint_account',
])

/**
 * From `waiting_customer` on, an application is real enough to be the destination of a
 * transfer the customer initiates; `declined` is the one later state with nothing to pay into.
 */
function transferable(state: ApplicationState): boolean {
  return (
    APPLICATION_STATES.indexOf(state) >= APPLICATION_STATES.indexOf('waiting_customer') &&
    state !== 'declined'
  )
}

export const showTransferTool: ToolModule<'show_transfer'> = {
  name: 'show_transfer',
  async run(input, ctx) {
    const { admin, turn, loaded, nameFor } = ctx

    const { applicationId, amount, cadence = 'once' } = input
    const banksHere = caseFactReader(loaded)?.boolean('banking.existingCustomer', 'primary') ?? null
    const application =
      applicationId === EXISTING_ACCOUNT_HERE ? undefined : findApplication(loaded, applicationId)
    if (!application) {
      /*
       * Nowhere for the money to land. Somebody new to the bank has no account here
       * until one is started on this case, and the honest answer is to say so and
       * offer the account, not to pretend a transfer can be made into thin air.
       */
      if (applicationId !== EXISTING_ACCOUNT_HERE || banksHere !== true) {
        const started = loaded.applications.some(
          (candidate) => TRANSFER_PRODUCTS.has(candidate.product) && transferable(candidate.state),
        )
        return {
          result: started
            ? 'There is no such application. Name one of the savings or current account applications on the case.'
            : banksHere === true
              ? 'Pass `existing_account_here` to move money into the current account they already hold, or start an account on the case.'
              : 'They hold no account here to receive it, and none is started on this case. Say so plainly, offer the savings or current account with show_product_options, and offer the transfer once it is started.',
          refused: true,
        }
      }
    }

    const toLabel =
      application === undefined
        ? 'your Demo Bank current account'
        : applicationName(application, nameFor)
    if (application !== undefined && !TRANSFER_PRODUCTS.has(application.product)) {
      return {
        result:
          `Money can only be moved into an account. ${toLabel} is not one; ` +
          'do not offer a transfer for it.',
        refused: true,
      }
    }
    if (application !== undefined && !transferable(application.state)) {
      return {
        result:
          `${toLabel} is ${stateLabel(application.state).toLowerCase()}; there is ` +
          'nothing to move money into yet. Collect what it needs first.',
        refused: true,
      }
    }

    // The money comes from savings where they hold any, else from the current
    // account, and only ever from an account with something in it.
    const from = [...loaded.linkedAccounts]
      .filter((account) => account.balance > 0)
      .sort((a, b) =>
        a.accountType === b.accountType
          ? b.balance - a.balance
          : a.accountType === 'savings'
            ? -1
            : 1,
      )[0]
    if (from === undefined) {
      return {
        result:
          loaded.linkedAccounts.length === 0
            ? 'Nothing is linked, so there is nothing to move from; offer show_connect_accounts first.'
            : 'None of the linked accounts holds anything to move.',
        refused: true,
      }
    }

    const savingsHeld = loaded.linkedAccounts
      .filter((account) => account.accountType === 'savings')
      .reduce((sum, account) => sum + account.balance, 0)

    let figure: number
    if (cadence === 'once') {
      figure = Math.min(amount ?? (savingsHeld > 0 ? savingsHeld : from.balance), from.balance)
    } else {
      const monthly = amount ?? caseFactReader(loaded)?.number('goals.monthlySaving') ?? null
      if (monthly === null) {
        return {
          result:
            'How much they can put away each month is not known. Ask it, record ' +
            '`goals.monthlySaving`, and offer the transfer next turn.',
          refused: true,
        }
      }
      figure = monthly
    }
    if (figure <= 0) {
      return { result: 'There is no amount to move.', refused: true }
    }

    /*
     * One transfer card per application, not one per turn. The one on screen still
     * works until a transfer is made from it, which the case shows.
     */
    const recent = loaded.messages
      .slice(-TRANSFER_CARD_WINDOW)
      .some((message) => message.cards.includes('transfer'))
    const last = recent ? await lastTransferOffered(admin, turn.caseId) : null
    const movedSince =
      last !== null && loaded.transfers.some((transfer) => transfer.createdAt > last.createdAt)
    const toId = application === undefined ? null : String(application.id)
    if (last !== null && last.toApplicationId === toId && !movedSince) {
      return {
        result:
          'The transfer card is already on screen from an earlier turn and still ' +
          'works. Point at it in your own words; do not draw another.',
      }
    }

    // Written here, from the figures, so the line on the card is the server's.
    const destination =
      application === undefined
        ? 'the current account you already hold with us'
        : application.state === 'completed'
          ? 'the account you have just opened'
          : `the ${toLabel} you are opening`
    const why =
      cadence === 'once'
        ? `Your ${from.accountType === 'savings' ? 'savings' : 'money'} sitting in ${from.bank}, moved to ${destination}`
        : `${money(figure)} a month from your ${from.bank} account into ${destination}, as a standing order`

    const card: Card = {
      type: 'transfer',
      fromAccountId: from.id,
      fromLabel: `${from.bank} ${from.displayName}`,
      toApplicationId: toId,
      toLabel,
      amount: figure,
      cadence,
      why,
    }

    return {
      result:
        'Transfer card shown, the amount read from the linked account. Nothing moves ' +
        'until they tap. Say one line about why, quote no figure, and ask nothing.',
      card,
    }
  },
}
