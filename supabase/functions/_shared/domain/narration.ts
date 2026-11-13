/**
 * What happened, in words (§36).
 *
 * The events worth telling a customer about, and one sentence for each. Pure and dependency-
 * free on purpose: the server's digest uses it to brief the model on what changed since they
 * were last here, and the customer's screen uses the very same sentence for the pill that
 * says the bank has moved. One phrasing, so the pill and what Saoirse then says cannot disagree.
 */

export const NARRATABLE_EVENTS = [
  'application_received',
  'information_requested',
  'document_received',
  'documents_verified',
  'application_approved',
  'application_declined',
  'application_completed',
  'partner_completed',
  'savings_target_reached',
  'plan_milestone_reached',
  'checkin_due',
  'accounts_linked',
  'transfer_settled',
  'plan_claimed',
  'plan_edited',
  'product_chosen',
  'product_choice_removed',
] as const

/** A claimed plan changed in the app's profile and rebuilt (`PATCH /api/cases/{id}/plan`). */
export const PLAN_EDITED_EVENT = 'plan_edited' as const

/** A product chosen on a card for a part of the plan (`POST /api/cases/{id}/plan/choices`). */
export const PRODUCT_CHOSEN_EVENT = 'product_chosen' as const

/** A choice taken off the plan (`DELETE /api/cases/{id}/plan/choices/{slot}`). */
export const PRODUCT_CHOICE_REMOVED_EVENT = 'product_choice_removed' as const

/** How each part of the plan reads in a sentence (`PLAN_CHOICE_SLOTS`). */
const SLOT_PHRASES: Readonly<Record<string, string>> = {
  lump_sum: 'the lump sum',
  monthly_saving: 'the monthly saving',
  mortgage: 'the mortgage',
}

export type NarratableEvent = (typeof NARRATABLE_EVENTS)[number]

export function isNarratable(type: string): type is NarratableEvent {
  return (NARRATABLE_EVENTS as readonly string[]).includes(type)
}

/**
 * One sentence for an event, or null for a type nobody wrote copy for.
 *
 * Unknown types are omitted rather than guessed at, so the model never narrates something
 * nobody wrote, and the pill never shows a raw event name.
 */
export function describeEvent(event: {
  readonly type: string
  readonly payload: Record<string, unknown>
}): string | null {
  const name =
    typeof event.payload['applicationName'] === 'string'
      ? event.payload['applicationName']
      : 'An application'

  switch (event.type) {
    case 'application_submitted':
      return `${name} was submitted.`
    case 'application_received':
      return `${name} was received and is being assessed.`
    case 'information_requested':
      return typeof event.payload['detail'] === 'string'
        ? `${name}: the team asked for ${event.payload['detail']}.`
        : `${name}: the team asked for more information.`
    case 'application_approved':
      return `${name} was approved.`
    case 'application_declined':
      return `${name} was not approved.`
    case 'application_completed':
      // An account opens; a loan, a card or a policy completes. The product on the event tells
      // them apart, and an event written before it was carried keeps the wording it always had.
      return event.payload['product'] === 'current_account' ||
        event.payload['product'] === 'joint_account'
        ? `${name} is open.`
        : `${name} is complete.`
    case 'plan_milestone_reached':
      return typeof event.payload['label'] === 'string'
        ? `You reached a step on your plan: ${event.payload['label']}.`
        : 'You reached a step on your plan.'
    case 'checkin_due':
      return typeof event.payload['purpose'] === 'string'
        ? `It is time for the ${event.payload['purpose'].toLowerCase()} you asked me to come back for.`
        : 'It is time for the review you asked me to come back for.'
    case 'savings_target_reached':
      return typeof event.payload['target'] === 'number'
        ? `Your savings reached €${event.payload['target'].toLocaleString('en-IE')}, the amount you were building towards.`
        : 'Your savings reached the amount you were building towards.'
    case 'partner_completed':
      return typeof event.payload['partnerName'] === 'string'
        ? `${event.payload['partnerName']} completed their part.`
        : 'Your partner completed their part.'
    case 'document_received':
      return `${name}: a document was received.`
    case 'documents_verified':
      // The case-wide check names no application, so it is not prefixed with "An application".
      return typeof event.payload['applicationName'] === 'string'
        ? `${name}: your documents were checked and accepted.`
        : 'Your documents were checked and accepted.'
    /*
     * Open banking, simulated. Linking is narrated so a customer who consented on one
     * device and came back on another is told it took; settlement is the one thing that
     * happens to a transfer after the tap, and it happens while they are away.
     */
    case 'accounts_linked':
      return typeof event.payload['bankName'] === 'string'
        ? `Your ${event.payload['bankName']} accounts were linked.`
        : 'Your accounts at the other bank were linked.'
    case 'transfer_settled': {
      const amount =
        typeof event.payload['amount'] === 'number'
          ? `€${event.payload['amount'].toLocaleString('en-IE')}`
          : 'The transfer'
      const from = typeof event.payload['from'] === 'string' ? ` from ${event.payload['from']}` : ''
      const to = typeof event.payload['to'] === 'string' ? event.payload['to'] : name
      return `${amount}${from} arrived in your ${to}.`
    }
    /*
     * A plan made in the customer's own AI, opened in the app. Since 2026-11-12 the claim
     * writes Saoirse's first message itself (the card and the question, `opening` in the
     * payload) and is not news for a return turn; the sentence says both are already on screen,
     * for the pill and for any digest that still meets it, without quoting the question, which
     * the digest's plan lines name. Claims from before then carry no
     * `opening`, and keep the sentence they had.
     */
    case 'plan_claimed': {
      const here =
        typeof event.payload['title'] === 'string'
          ? `The plan you made with your AI assistant is here: ${event.payload['title']}.`
          : 'The plan you made with your AI assistant is here.'
      return typeof event.payload['opening'] === 'string'
        ? `${here} Its card and my first question are already on screen.`
        : here
    }
    /*
     * A change made to the plan in the app's profile (2026-11-12, "6. The saving months"). The
     * edit wrote `reading`, what changed and which options now fit as facts in their figures;
     * it is the sentence, so the pill and Saoirse's opening say the same. Where the reading
     * shortened a list ("and 2 more"), every name follows.
     */
    case 'plan_edited': {
      const reading = typeof event.payload['reading'] === 'string' ? event.payload['reading'] : null
      const effects = event.payload['effects']
      const names = (key: string): string[] => {
        if (typeof effects !== 'object' || effects === null) return []
        const list = (effects as Record<string, unknown>)[key]
        return Array.isArray(list)
          ? list.filter((item): item is string => typeof item === 'string')
          : []
      }
      const nowFit = names('nowFit')
      const noLongerFit = names('noLongerFit')
      const full =
        nowFit.length > 3 || noLongerFit.length > 3
          ? [
              ...(nowFit.length === 0 ? [] : [`Now fit: ${nowFit.join(', ')}.`]),
              ...(noLongerFit.length === 0 ? [] : [`No longer fit: ${noLongerFit.join(', ')}.`]),
            ]
          : []
      return [
        'You changed the plan in the app.',
        ...(reading === null ? [] : [reading]),
        ...full,
      ].join(' ')
    }
    /*
     * A product the customer chose on a card for a part of their plan (2026-11-13), or took off
     * it. A fact of what they did, in their name; it never says the choice is a good one.
     */
    case 'product_chosen': {
      const lead = typeof event.payload['lead'] === 'string' ? event.payload['lead'] : null
      const slot = SLOT_PHRASES[String(event.payload['slot'])] ?? 'a part of the plan'
      const replaced =
        typeof event.payload['replacedLead'] === 'string' ? event.payload['replacedLead'] : null
      if (lead === null) return `You chose a product for ${slot}.`
      return replaced === null
        ? `You chose ${lead} for ${slot}.`
        : `You chose ${lead} for ${slot}, in place of ${replaced}.`
    }
    case 'product_choice_removed': {
      const lead = typeof event.payload['lead'] === 'string' ? event.payload['lead'] : null
      const slot = SLOT_PHRASES[String(event.payload['slot'])] ?? 'a part of the plan'
      return lead === null
        ? `You took the choice for ${slot} off the plan; it is open again.`
        : `You took ${lead} off the plan as the choice for ${slot}; it is open again.`
    }
    default:
      return null
  }
}
