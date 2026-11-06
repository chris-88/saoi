import { AWAITING_CARDS } from '../../contracts/cards.ts'
import { isWithBank, type ApplicationState } from '../state-machine.ts'

/**
 * The card still waiting for the customer, read from the transcript and the case.
 *
 * "A card is the question" covers the turn a card is shown on. Nothing covered the turn after
 * it. Saoirse put a joint current account on screen, the customer wrote "Great" instead of tapping
 * it, and Saoirse took the word for the tap: it asked the account's discovery questions, said it
 * had everything it needed for an application that did not exist, and only twelve minutes
 * later, asked how the partner joins, noticed that nothing had been started and showed the
 * card again.
 *
 * So the turn is told, from the case, that a card is waiting. Which card and how far back come
 * from the persisted messages; whether it has been answered comes from what the case now
 * holds, the same way the client decides whether a card keeps its buttons
 * (`src/saoirse/cardState.ts`). Never from the model, which is the thing that got it wrong.
 *
 * Only a card's type is saved with its message, not its payload (`db/rows.ts`), and the case
 * carries no creation times for applications, plans or interests. So the rules here cannot ask
 * "did an application for one of these options appear after this card". What the transcript
 * does carry is every tap that committed something: the app reports a tap to Saoirse as an action
 * turn, and the report is saved as a `system` message. A `system` message after the card is
 * the customer doing something in the app after it went up, and the case corroborates that per
 * type where it can.
 *
 * Where it cannot, the rules err towards settled. A card reported as waiting when it was in
 * fact tapped would have Saoirse pointing at a decision the case already shows made, which is the
 * mirror image of the fault this exists to fix; a card missed is only the old behaviour.
 */

export type AwaitingCardType = (typeof AWAITING_CARDS)[number]

export type AwaitingCard = {
  readonly type: AwaitingCardType
  /**
   * How far back the card is, in Saoirse's own replies: 1 means it is on the last thing Saoirse said,
   * which is the turn the customer is answering now.
   *
   * Counted in replies rather than in customer messages because the case is loaded before the
   * message being answered is saved, so a count of the customer's messages would read zero on
   * exactly the turn this is for.
   */
  readonly turnsAgo: number
}

/** What this reads: the shape of a loaded case, and nothing a test cannot write by hand. */
export type AwaitingContext = {
  readonly authLevel: 'anonymous' | 'authenticated'
  /** Oldest first, as the case loads them. Cards are types, which is all that is saved. */
  readonly messages: readonly {
    readonly role: 'customer' | 'assistant' | 'system'
    readonly cards: readonly string[]
  }[]
  readonly applications: readonly { readonly state: ApplicationState }[]
  readonly productInterests: readonly { readonly status: string }[]
  readonly requests: readonly { readonly status: string }[]
  readonly participants: readonly { readonly role: string }[]
}

const AWAITING: ReadonlySet<string> = new Set(AWAITING_CARDS)

function isAwaiting(type: string): type is AwaitingCardType {
  return AWAITING.has(type)
}

/** What the transcript says happened after the card went up. */
type Since = {
  /** A `system` message: the customer did something in the app. */
  readonly tapped: boolean
  /** A customer message: they said something. */
  readonly replied: boolean
}

/**
 * The newest card that waits for the customer, if what the case holds has not answered it.
 *
 * Only the newest is ever considered. A later waiting card takes the turn from anything older,
 * whatever became of the older one: there is one question on screen at a time, and it is the
 * last one asked.
 */
export function awaitingCard(loaded: AwaitingContext): AwaitingCard | null {
  const { messages } = loaded

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'assistant') continue

    const type = cardAsked(message.cards)
    if (type === null) continue

    const later = messages.slice(index + 1)
    const since: Since = {
      tapped: later.some((entry) => entry.role === 'system'),
      replied: later.some((entry) => entry.role === 'customer'),
    }

    if (settled(type, since, loaded)) return null
    return { type, turnsAgo: later.filter((entry) => entry.role === 'assistant').length + 1 }
  }

  return null
}

/**
 * The card a reply asked with, when it asked with one.
 *
 * The last waiting card the model drew. The sign-in offer is appended by the server after
 * whatever the model showed, so on a turn that drew an options card and then had the offer
 * added, the options card is the question and the offer is an offer. It counts only when it is
 * the only one.
 */
function cardAsked(cards: readonly string[]): AwaitingCardType | null {
  const waiting = cards.filter(isAwaiting)
  const asked = waiting.filter((type) => type !== 'sign_in')
  return asked.at(-1) ?? waiting.at(-1) ?? null
}

/**
 * Whether the case has answered the card, by type.
 *
 * Every card the contract lists is here, so a new one has to be thought about rather than
 * defaulting to waiting forever or to never waiting at all. The comments say what the exact
 * rule would be and what the loaded case can actually check.
 */
function settled(type: AwaitingCardType, since: Since, loaded: AwaitingContext): boolean {
  const { applications } = loaded

  switch (type) {
    /*
     * The client settles this once every option is started or declined. Both are taps, and
     * both leave the case holding something it did not before, which is as close as the type
     * alone gets to "an application for one of these options, created after this card". An
     * application that was already there is not evidence: the mortgage is under way when the
     * joint account is offered.
     */
    case 'product_options':
      return (
        since.tapped &&
        (applications.length > 0 ||
          loaded.productInterests.some((interest) => interest.status === 'declined'))
      )

    /* One tap starts every account on it. */
    case 'arrangement':
      return since.tapped && applications.length > 0

    /*
     * Keeping and leaving are both taps, and the plans are not loaded with the case, so the
     * tap is the whole of the evidence.
     */
    case 'plan_proposal':
      return since.tapped

    /* Submitting is the tap, and afterwards the application is with the bank. */
    case 'review':
      return since.tapped && applications.some((application) => isWithBank(application.state))

    /*
     * Pausing is a tap. Continuing is not: the app commits nothing for it, so nothing is
     * saved. Somebody who carries on talking has continued, which is the only reading that
     * does not have Saoirse pointing at a choice they have already made.
     */
    case 'pause_prompt':
      return since.tapped || since.replied

    /* Inviting creates the partner participant. */
    case 'partner_invite':
      return (
        since.tapped && loaded.participants.some((participant) => participant.role === 'partner')
      )

    /* The upload fulfils the request, then reports itself to Saoirse as an action. */
    case 'upload_request':
      return since.tapped && loaded.requests.some((request) => request.status === 'fulfilled')

    /*
     * What these record is not loaded with the case, or not in a shape that says which card
     * it answers: consents have their own table, and a form's answers are keyed by field.
     * The tap is what there is.
     */
    case 'consent':
    case 'form_declarations':
    case 'form_upload':
    case 'health_form':
      return since.tapped

    /*
     * An offer rather than a question. The client keeps its buttons until the customer is
     * signed in, but the offer is made once (`saoirse-turn` holds it to once a case), and somebody
     * who has replied without taking it has answered it for now. The card stays on screen for
     * whenever they want it.
     */
    case 'sign_in':
      return loaded.authLevel === 'authenticated' || since.replied

    /*
     * Things to read. Words answer them as readily as a tap does, so there is nothing to wait
     * for, and the client never settles them for the same reason. They still take the turn
     * from anything older, because the walk stops here.
     */
    case 'comparison':
    case 'quote':
      return true

    /*
     * Open banking, simulated. Linking and moving money are both taps the app reports, and
     * neither the linked accounts nor the transfers are in this context, so the tap is the
     * whole of the evidence. Somebody who declines to link says so in words, and words leave
     * the offer standing, which is right: the card still works whenever they want it.
     */
    case 'connect_accounts':
    case 'transfer':
      return since.tapped
  }
}
