import { cardSchema, LINKABLE_BANKS, upgradeStoredCard, type Card } from '../contracts/cards.ts'
import type { CaseSnapshot } from '../contracts/case-read.ts'

/**
 * What became of a card, read from the case rather than remembered.
 *
 * A card is persisted as the payload the model asked for, which is what it offered and not
 * what happened next. Reloading a conversation therefore put every decision back on screen as
 * though it were still open: the plan could be kept again, the products chosen again, the
 * sign-in link requested again by somebody already signed in.
 *
 * Invariant 2 is the answer and it already applies everywhere else. State comes from the
 * database, so a card showing a decision renders what the database says about that decision.
 * Tapping the same card twice was always refused by `case-action`; this is about not offering.
 *
 * Pure: the SPA's fallback path and `saoi-api` both feed it rows and get the same answer.
 */

export type Settled = {
  /**
   * What happened, in the customer's terms.
   *
   * This replaces the card rather than captioning it, so it has to stand on its own: the
   * options, the rates and the buttons are no longer on screen to supply the context.
   */
  readonly label: string
  /** One line of detail or reassurance, where there is something worth adding. */
  readonly note?: string
}

export type CaseState = {
  readonly applications: readonly {
    readonly id: string
    readonly product: string
    readonly state: string
    readonly catalogue_id: string | null
  }[]
  readonly interests: readonly { readonly product: string; readonly status: string }[]
  readonly plans: readonly { readonly id: string; readonly status: string }[]
  readonly requests: readonly { readonly id: string; readonly status: string }[]
  readonly formAnswers: readonly { readonly field_id: string; readonly source: string }[]
  readonly signedIn: boolean
  /** Requirements satisfied without asking, per application: the §53 count, from `events`. */
  readonly reusedBy: ReadonlyMap<string, number>
  /**
   * Open banking, simulated. Accounts linked through the consent card, revoked ones included,
   * so a card can say "stopped sharing" rather than reopening the offer; and the transfers
   * initiated from them, so a transfer card knows whether its tap landed.
   */
  readonly linkedAccounts: readonly {
    readonly id: string
    readonly bank: string
    readonly revoked_at: string | null
  }[]
  readonly transfers: readonly {
    readonly to_application_id: string | null
    readonly amount: number
    readonly state: string
  }[]
  /**
   * The plan card as the stored plan reads now, by plan id, for plans changed in the app since
   * they were shown (2026-11-12, "6. The saving months"): a reload shows the rebuilt figures,
   * not the ones it was first shown with (Invariant 2). Absent: cards render as stored.
   */
  readonly savedPlans?: ReadonlyMap<string, Card>
}

/**
 * Whether this card's decision has already been made, and what to say about it.
 *
 * `undefined` means still open. Only cards that commit something are resolved: a comparison or
 * a set of rates is a thing to read, and reading it again is not a problem to solve.
 */
export function settledState(card: Card, state: CaseState): Settled | undefined {
  switch (card.type) {
    case 'sign_in':
      return state.signedIn
        ? {
            label: 'Signed in',
            note: 'This conversation is saved, and it will be here on another device.',
          }
        : undefined

    case 'plan_proposal': {
      const plan = state.plans.find((candidate) => candidate.id === card.planId)
      if (!plan) return undefined
      if (plan.status === 'active') {
        // The plan's own title, exactly as the card says it the moment it is tapped.
        return { label: card.title, note: 'Saved. You can change or stop it any time.' }
      }
      if (plan.status === 'declined' || plan.status === 'abandoned') {
        return { label: 'Left for now', note: card.title }
      }
      return undefined
    }

    case 'product_options': {
      /*
       * Settled once every option has been answered, one way or the other.
       *
       * A card offering three products where one was started and two were not is still a live
       * choice: the customer may well come back for another. It settles when nothing on it is
       * still undecided.
       */
      const answered = card.options.filter((option) => {
        const started = state.applications.some(
          (application) =>
            application.product === option.product &&
            (option.catalogueId === undefined || application.catalogue_id === option.catalogueId),
        )
        const declined = state.interests.some(
          (interest) => interest.product === option.product && interest.status === 'declined',
        )
        return started || declined
      })

      if (answered.length === 0) return undefined

      const started = card.options.filter((option) =>
        state.applications.some((application) => application.product === option.product),
      )

      if (answered.length < card.options.length) return undefined

      if (started.length === 0) {
        return {
          label: 'Not for now',
          note: card.options.map((option) => option.displayName).join(' and '),
        }
      }

      /*
       * The count is the product's whole claim and it used to be dropped here. A settled card
       * that only said what was started had nothing to say about what it saved.
       */
      const carried = state.applications
        .filter((application) => started.some((option) => option.product === application.product))
        .reduce((sum, application) => sum + (state.reusedBy.get(application.id) ?? 0), 0)

      return {
        label: `Started ${started.map((option) => option.displayName).join(' and ')}`,
        note:
          carried > 0
            ? `${String(carried)} ${carried === 1 ? 'thing' : 'things'} carried over from what Saoirse already knew.`
            : started.length === 1
              ? 'It is in your list, and you can pick it up whenever you like.'
              : 'They are all in your list, and you can pick any of them up whenever you like.',
      }
    }

    /*
     * Settled once every account on it has been started. One tap starts all of them, so a
     * partial start means the tap failed partway, and the card should stay open to try again.
     */
    case 'arrangement': {
      const started = card.allocations.filter((allocation) =>
        state.applications.some(
          (application) => application.catalogue_id === allocation.catalogueId,
        ),
      )
      if (started.length < card.allocations.length) return undefined

      return {
        label: `Started ${started.map((allocation) => allocation.name).join(', ')}`,
        note: 'All of them are in your list, each doing its own job.',
      }
    }

    case 'review': {
      const application = state.applications.find(
        (candidate) => candidate.id === card.applicationId,
      )
      const submitted = ['submitted', 'under_review', 'approved', 'declined', 'completed']
      return application && submitted.includes(application.state)
        ? { label: 'Submitted', note: 'Nothing else is needed from you for now.' }
        : undefined
    }

    case 'pause_prompt': {
      const application = state.applications.find(
        (candidate) => candidate.id === card.applicationId,
      )
      if (!application) return undefined
      return application.state === 'paused'
        ? { label: 'On hold', note: 'Nothing happens on it until you say so.' }
        : undefined
    }

    case 'upload_request': {
      const request = state.requests.find((candidate) => candidate.id === card.requestId)
      return request && request.status !== 'open'
        ? { label: 'Sent in', note: 'Received, and it will not be asked for again.' }
        : undefined
    }

    case 'form_declarations': {
      const agreed = card.declarations.filter((declaration) =>
        state.formAnswers.some(
          (answer) => answer.field_id === declaration.fieldId && answer.source === 'consent',
        ),
      )
      return agreed.length === card.declarations.length && agreed.length > 0
        ? { label: 'Confirmed', note: 'Recorded in the words the form uses.' }
        : undefined
    }

    case 'form_upload': {
      const attached = state.formAnswers.some(
        (answer) => answer.field_id === card.fieldId && answer.source === 'document',
      )
      return attached ? { label: 'Attached', note: 'Held against this application.' } : undefined
    }

    /*
     * Everything below is something to read rather than something to decide. A comparison, a
     * quote, published rates, a status, the data notice: tapping them starts nothing, so there
     * is nothing to settle. Listed rather than defaulted, because a new card type that does
     * commit something should fail here and be thought about, not silently stay tappable
     * forever.
     */
    /*
     * Settled by the consent existing, or having existed. A revoked consent is not an open
     * offer: the customer stopped sharing on purpose, and the card says so rather than asking
     * again. Declining writes nothing, so a declined card settles on the spot and reopens on
     * reload; that is the one gap, and it is the same one the quote and comparison cards have.
     */
    case 'connect_accounts': {
      if (state.linkedAccounts.length === 0) return undefined
      const live = state.linkedAccounts.find((account) => account.revoked_at === null)
      if (live === undefined) {
        return { label: 'Stopped sharing', note: 'Nothing from your other accounts is held now.' }
      }
      const name =
        card.banks.find((bank) => bank.id === live.bank)?.name ??
        LINKABLE_BANKS.find((bank) => bank.id === live.bank)?.name ??
        live.bank
      return {
        label: `Linked ${name}`,
        note: `Shared through Nexus for ${String(card.consentDays)} days. Stop it any time from the menu.`,
      }
    }

    /*
     * Settled once a transfer for this application and amount exists, in whatever state the
     * receiving side has reported. On its way is on its way: the card never says landed until
     * the console has settled it.
     */
    case 'transfer': {
      const transfer = state.transfers.find(
        (candidate) =>
          candidate.to_application_id === card.toApplicationId &&
          Math.abs(candidate.amount - card.amount) < 0.005,
      )
      if (transfer === undefined) return undefined
      if (transfer.state === 'settled') {
        return {
          label: `${euro(card.amount)} landed in ${card.toLabel}`,
          note:
            card.cadence === 'monthly'
              ? 'The first of them. The rest follow each month.'
              : 'Settled.',
        }
      }
      if (transfer.state === 'failed') {
        return {
          label: `${euro(card.amount)} did not reach ${card.toLabel}`,
          note: 'Nothing left your account. Say the word to try again.',
        }
      }
      return settledTransfer(card)
    }

    case 'accounts_overview':
    case 'account_opened':
    case 'saved_plan':
    case 'market_products':
    case 'comparison':
    case 'reuse':
    case 'consent':
    case 'data_notice':
    case 'health_form':
    case 'mortgage_rates':
    case 'partner_invite':
    case 'quote':
    case 'status':
      return undefined
  }
}

/**
 * What a transfer settles to the moment it is sent.
 *
 * Shared with the card itself, so the tap and the reload say the same thing: the card and the
 * record of it must not disagree about whether the money has arrived. It has not, until the
 * console says so.
 */
export function settledTransfer(transfer: {
  readonly amount: number
  readonly cadence: 'once' | 'monthly'
  readonly toLabel: string
}): Settled {
  return transfer.cadence === 'monthly'
    ? {
        label: `${euro(transfer.amount)} a month to ${transfer.toLabel}`,
        note: 'Set up through Nexus under PSD2. The first one is on its way; Saoirse will say when it lands.',
      }
    : {
        label: `${euro(transfer.amount)} on its way to ${transfer.toLabel}`,
        note: 'Instructed through Nexus under PSD2. Saoirse will say when it lands.',
      }
}

const euro = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`

/**
 * Only the newest status card is current. The others say so.
 *
 * A status card renders the payload it was streamed with, which is the application state at
 * that moment. Left alone, two of them from different turns sit in one transcript disagreeing
 * about where things stand, with nothing to say which is right. The newest is the case as it
 * is; the rest settle into a line that says they were how it was.
 */
function supersedeOlderStatus(entries: readonly HistoryEntry[]): readonly HistoryEntry[] {
  const statuses = entries.flatMap((entry, index) =>
    entry.kind === 'card' && entry.card.type === 'status' ? [index] : [],
  )
  const newest = statuses[statuses.length - 1]

  return entries.map((entry, index) =>
    statuses.includes(index) && index !== newest
      ? {
          ...entry,
          settled: {
            label: 'Where things stood at the time',
            note: 'Things have moved since. The current status is further down.',
          },
        }
      : entry,
  )
}

export type HistoryEntry =
  | {
      readonly kind: 'message'
      readonly id: string
      readonly author: 'assistant' | 'customer'
      readonly text: string
      /** The row's own id, which is what feedback on a reply is kept against (§44). */
      readonly messageId?: string
    }
  | {
      readonly kind: 'card'
      readonly id: string
      readonly card: Card
      /** What became of it, where that is a thing the case knows. */
      readonly settled?: Settled
    }

/** A stored message as read from the table. `cards` are unparsed. */
export type MessageRow = {
  readonly id: string
  readonly role: 'customer' | 'assistant' | 'system'
  readonly content: string
  readonly cards: readonly unknown[]
}

/**
 * Cards that go on screen before Saoirse's words in the turn that shows them (`turn/turn.ts`
 * yields them first): the plan brought from their AI, the account-opened welcome and the reuse
 * card. A reload puts them in the same place, above the message's text, so the transcript reads
 * as it did live: the arrival is [card, question], not [question, card].
 */
export const LEAD_CARDS: ReadonlySet<Card['type']> = new Set<Card['type']>([
  'saved_plan',
  'account_opened',
  'reuse',
])

/**
 * The transcript as the screen renders it: messages and their cards in order, each card
 * resolved against the case (Invariant 2 applied to history). A message's lead cards
 * (`LEAD_CARDS`) come before its text, the rest after it.
 */
export function buildHistory(
  messages: readonly MessageRow[],
  state: CaseState,
): readonly HistoryEntry[] {
  const entries = messages
    // System messages are internal: they belong in the event log, not the conversation.
    .filter((message) => message.role !== 'system')
    .flatMap((message): HistoryEntry[] => {
      const cards = message.cards.flatMap(
        (raw, index): Extract<HistoryEntry, { kind: 'card' }>[] => {
          // A card that no longer parses is dropped rather than breaking the whole transcript.
          const parsed = cardSchema.safeParse(upgradeStoredCard(raw))
          if (!parsed.success) return []
          const card =
            parsed.data.type === 'saved_plan'
              ? (state.savedPlans?.get(parsed.data.planId) ?? parsed.data)
              : parsed.data

          const settled = settledState(card, state)
          return [
            {
              kind: 'card',
              id: `${message.id}-card-${String(index)}`,
              card,
              ...(settled === undefined ? {} : { settled }),
            },
          ]
        },
      )
      return [
        ...cards.filter((entry) => LEAD_CARDS.has(entry.card.type)),
        {
          kind: 'message',
          id: message.id,
          author: message.role === 'customer' ? ('customer' as const) : ('assistant' as const),
          text: message.content,
          messageId: message.id,
        },
        ...cards.filter((entry) => !LEAD_CARDS.has(entry.card.type)),
      ]
    })

  return supersedeOlderStatus(entries)
}

/** The snapshot as `settledState` reads it: ids to counts become a map, linked rows their columns. */
export function caseStateFromSnapshot(snapshot: CaseSnapshot): CaseState {
  return {
    applications: snapshot.applications,
    interests: snapshot.interests,
    plans: snapshot.plans,
    requests: snapshot.requests,
    formAnswers: snapshot.formAnswers,
    signedIn: snapshot.signedIn,
    reusedBy: new Map(Object.entries(snapshot.reusedBy)),
    linkedAccounts: snapshot.linkedAccounts.map((account) => ({
      id: account.id,
      bank: account.bank,
      revoked_at: account.revokedAt,
    })),
    transfers: snapshot.transfers,
  }
}
