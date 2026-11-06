import { z } from 'zod'
import type { Card, CardType } from '../contracts/cards.ts'
import { formatIban, SYNTHETIC_BIC, syntheticIban } from '../domain/iban.ts'
import type { Product } from '../domain/journey.ts'
import type { Application } from '../domain/state-machine.ts'
import { applicationName } from './applications.ts'
import { caseFactReader } from './fact-reader.ts'
import type { LoadedCase } from './loaded-case.ts'

/**
 * The moment the account is open (§6 Stage 13, §41).
 *
 * The console marks the application complete, and the customer's next turn, usually the one a
 * push notification brings them back for, opens with this card before the model has said a
 * word: the account's name, its number, where the debit card is going and what to do next.
 * Every word is read from the case. The model is not asked for any of it and has no tool that
 * shows it, because an account number the model wrote would be an account number the model
 * made up (Invariant 2).
 *
 * Owed once to each opened account. Which ones have been welcomed is read from the transcript
 * by application id rather than counted in the loaded messages: those are a window sized for
 * the model, and a welcome counted only there came back every time it scrolled out of them,
 * while a count could not tell two opened accounts apart and would have welcomed the newer one
 * twice and the older never.
 */

export const ACCOUNT_OPENED_CARD = 'account_opened' as const satisfies CardType

const ACCOUNT_PRODUCTS: ReadonlySet<Product> = new Set<Product>([
  'current_account',
  'joint_account',
])

/** The statuses that come with somebody to hand the IBAN to. A contractor's client is not one. */
const EMPLOYED: ReadonlySet<unknown> = new Set([
  'employed_full_time',
  'employed_part_time',
  'self_employed',
])

/** The account applications the bank has finished: the ones a welcome is about. */
export function openedAccounts(loaded: Pick<LoadedCase, 'applications'>): readonly Application[] {
  return loaded.applications.filter(
    (application) => ACCOUNT_PRODUCTS.has(application.product) && application.state === 'completed',
  )
}

/** A persisted welcome, which is the only card payload this file reads back. */
const persistedWelcome = z.object({
  type: z.literal(ACCOUNT_OPENED_CARD),
  applicationId: z.string(),
})

/**
 * The application ids of every welcome these persisted messages carry.
 *
 * Reads the stored card payloads rather than the loaded card types, because the id is the
 * whole question. Anything that is not a welcome with an id is passed over rather than refused:
 * an older payload shape in the transcript is not a reason to welcome somebody twice.
 */
export function welcomedAccounts(
  rows: readonly { readonly cards: unknown }[],
): ReadonlySet<string> {
  const welcomed = new Set<string>()
  for (const row of rows) {
    const cards = z.array(z.unknown()).safeParse(row.cards)
    if (!cards.success) continue
    for (const card of cards.data) {
      const parsed = persistedWelcome.safeParse(card)
      if (parsed.success) welcomed.add(parsed.data.applicationId)
    }
  }
  return welcomed
}

/**
 * The welcome owed, if any: the first opened account not yet welcomed, with everything the card
 * says read from the case. Two accounts opened together are welcomed one per turn.
 */
export function welcomeCardFor(
  loaded: LoadedCase,
  welcomed: ReadonlySet<string>,
): Card | undefined {
  const application = openedAccounts(loaded).find(
    (candidate) => !welcomed.has(String(candidate.id)),
  )
  if (application === undefined) return undefined

  const facts = caseFactReader(loaded)
  const address = facts?.get('identity.address', 'primary')
  const employment = facts?.get('employment.status', 'primary')
  const saving = loaded.applications.some((candidate) => candidate.product === 'savings')

  /*
   * Open banking, simulated: savings sitting in a linked account at another bank are the
   * first thing to do with the new one, ahead of the salary. The line names the figure and
   * the bank so the digest tells the model the same thing, and `show_transfer` follows.
   */
  const held = loaded.linkedAccounts.filter(
    (account) => account.accountType === 'savings' && account.balance > 0,
  )
  const heldElsewhere = held.reduce((sum, account) => sum + account.balance, 0)
  const heldAt = [...new Set(held.map((account) => account.bank))].join(' and ')

  return {
    type: ACCOUNT_OPENED_CARD,
    applicationId: String(application.id),
    displayName: applicationName(application),
    iban: formatIban(syntheticIban(String(application.id))),
    bic: SYNTHETIC_BIC,
    // The address on file is where the debit card is addressed. With none held the card says
    // only that it is on its way.
    cardTo: typeof address === 'string' ? address : null,
    next: [
      ...(heldElsewhere > 0
        ? [`Move your €${Math.round(heldElsewhere).toLocaleString('en-IE')} from ${heldAt} into it`]
        : []),
      EMPLOYED.has(employment)
        ? 'Give your employer this IBAN for your salary'
        : 'Use this IBAN wherever money needs to reach you',
      ...(saving ? ['Set up a standing order into your savings'] : []),
      'Your debit card is on its way, and online banking and the app are ready',
    ],
  }
}
