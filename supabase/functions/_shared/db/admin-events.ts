/**
 * Events in words a presenter can read out.
 *
 * The console showed raw types — `plan_milestone_reached`, `checkin_due` — which is fine for
 * debugging and useless for demonstrating. One describer, server-side, so the overview feed
 * and the case inspector cannot drift into saying different things about the same event.
 *
 * Distinct from the customer-facing `describeEvent` in digest.ts, which is written for Saoirse to
 * say to the person it happened to. This is written for the bank watching it happen.
 */

/** The things worth watching happen, as opposed to the bookkeeping around them. */
const SIGNALS = new Set([
  'plan_created',
  'plan_paused',
  'plan_resumed',
  'plan_abandoned',
  'plan_completed',
  'plan_milestone_reached',
  'checkin_due',
  'savings_target_reached',
  'notification_sent',
  'context_reused',
  'goal_identified',
  'product_quoted',
  'card_promised_not_shown',
  'question_while_card_awaits',
  'application_created',
  'application_submitted',
  'partner_joined',
  'partner_completed',
  'request_blocked',
  'tool_rejected',
  'customer_repeated',
  'accounts_linked',
  'accounts_revoked',
  'transfer_initiated',
  'transfer_settled',
  'feedback_given',
])

const text = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const money = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key]
  return typeof value === 'number' ? `€${value.toLocaleString('en-IE')}` : null
}

export function describeAdminEvent(
  type: string,
  payload: Record<string, unknown> = {},
): { describe: string; signal: boolean } {
  const signal = SIGNALS.has(type)

  const describe = ((): string => {
    switch (type) {
      case 'plan_created':
        return `Plan kept: ${text(payload, 'title') ?? 'a goal'}`
      case 'plan_paused':
        return `Plan paused: ${text(payload, 'title') ?? 'a goal'}`
      case 'plan_resumed':
        return `Plan picked back up: ${text(payload, 'title') ?? 'a goal'}`
      case 'plan_abandoned':
        return `Plan dropped: ${text(payload, 'title') ?? 'a goal'}`
      case 'plan_completed':
        return `Plan finished: ${text(payload, 'title') ?? 'a goal'}`
      case 'plan_milestone_reached':
        return `Milestone reached: ${text(payload, 'label') ?? 'a step on the plan'}`
      case 'checkin_due':
        return `Check-in came due: ${text(payload, 'purpose') ?? 'a planned review'}`
      case 'savings_target_reached':
        return `Savings reached ${money(payload, 'target') ?? 'the target'}`
      case 'savings_balance_set':
        return `Balance moved to ${money(payload, 'amount') ?? 'a new figure'}`
      case 'context_reused':
        return 'A question that did not have to be asked'
      case 'goal_identified':
        return `Worked out a goal: ${text(payload, 'goal')?.replaceAll('_', ' ') ?? 'something they are after'}`
      case 'card_promised_not_shown':
        return 'Said there was a card, and there was not'
      case 'question_while_card_awaits': {
        const card = text(payload, 'card')?.replaceAll('_', ' ') ?? 'a'
        return `Asked something new while the ${card} card was still waiting for a tap`
      }
      /*
       * The two that explain a turn that came to nothing.
       *
       * A tool the server refused used to leave no trace at all: the model spent its rounds
       * retrying, the turn ended silent, and the customer got "I lost my thread" with nothing
       * anywhere saying why. Finding that out took replaying one case twenty times.
       */
      case 'tool_rejected':
        return `A tool call was refused: ${text(payload, 'tool') ?? 'a tool'} — ${
          text(payload, 'error') ?? 'no reason given'
        }`
      case 'turn_tools': {
        const called = Array.isArray(payload['called'])
          ? (payload['called'] as unknown[]).filter((n): n is string => typeof n === 'string')
          : []
        const refused = typeof payload['refused'] === 'number' ? payload['refused'] : 0
        return `Saoirse reached for ${called.length > 0 ? called.join(', ') : 'nothing'}${
          refused > 0 ? ` (${String(refused)} refused)` : ''
        }`
      }
      /*
       * The customer saying it again. Twice in one live case the same message came back within
       * a minute of the first because the answer had not landed, and the transcript showed two
       * ordinary turns. The turn itself is unchanged; this is the mark it leaves.
       */
      case 'customer_repeated': {
        const said = text(payload, 'said')
        return said === null
          ? 'Said the same thing again'
          : `Said it again, word for word: "${said}"`
      }
      case 'product_quoted':
        return `Showed figures for ${text(payload, 'product')?.replaceAll('_', ' ') ?? 'a product'}`
      case 'context_captured':
        return `Recorded ${text(payload, 'key') ?? 'something they said'}`
      case 'application_created':
        return `Application started: ${text(payload, 'product') ?? 'a product'}`
      case 'application_submitted':
        return 'Application submitted'
      case 'application_received':
        return 'The bank received an application'
      case 'application_approved':
        return 'An application was approved'
      case 'product_offered':
        return `Offered ${text(payload, 'product') ?? 'a product'}`
      case 'product_swapped':
        return `Swapped ${text(payload, 'from') ?? 'the account offered'} for ${text(payload, 'to') ?? 'the one that suits'}`
      case 'partner_invited':
        return 'Second applicant invited'
      case 'partner_joined':
        return 'Second applicant joined'
      case 'partner_completed':
        return 'Second applicant finished their part'
      case 'document_uploaded':
        return `Document sent in: ${text(payload, 'fileName') ?? 'a file'}`
      case 'documents_verified':
        return 'Documents checked and accepted'
      case 'notification_sent':
        return 'Notification sent'
      case 'customer_authenticated':
        return 'Signed in — bank-held details loaded'
      case 'request_blocked':
        return `Blocked: ${text(payload, 'category') ?? 'out of scope'}`
      case 'case_reset':
        return 'Case reset to the seed'
      case 'handoff_created':
        return 'Handed over to the app'
      // Open banking, simulated: the consent, its withdrawal, and the money moving.
      case 'accounts_linked':
        return `Linked ${
          typeof payload['accounts'] === 'number' ? String(payload['accounts']) : 'their'
        } ${text(payload, 'bankName') ?? 'other-bank'} accounts through Nexus`
      case 'accounts_revoked':
        return 'Withdrew the Nexus consent: linked accounts no longer read'
      case 'transfer_initiated':
        return `Transfer started: ${money(payload, 'amount') ?? 'an amount'}${
          payload['cadence'] === 'monthly' ? ' a month' : ''
        } from ${text(payload, 'from') ?? 'a linked account'} to ${text(payload, 'to') ?? 'an application'}`
      case 'transfer_settled':
        return `Transfer settled: ${money(payload, 'amount') ?? 'an amount'} arrived in ${
          text(payload, 'to') ?? 'the application'
        }`
      // §44: a thumbs on one reply, or a mark out of five for the whole conversation.
      case 'feedback_given': {
        const rating = typeof payload['rating'] === 'number' ? payload['rating'] : null
        if (payload['kind'] === 'turn') {
          return `Gave a thumbs ${rating !== null && rating < 0 ? 'down' : 'up'} on a reply`
        }
        return rating === null
          ? 'Rated the conversation'
          : `Rated the conversation ${String(rating)} of 5`
      }
      default:
        // Readable rather than raw, so a new event type is still legible before anyone
        // writes a sentence for it.
        return type.replaceAll('_', ' ')
    }
  })()

  return { describe, signal }
}
