import type { Cost, FeedbackItem } from '@shared/contracts/admin.ts'
import { LINKABLE_BANKS } from '@shared/contracts/cards.ts'
import type { Db } from '@shared/db/case-repository.ts'
import { toUsage } from '@shared/db/rows.ts'
import { asApplicationId } from '@shared/domain/facts.ts'
import { TYPICAL_TURN, costIn, sumUsage, tokensIn, type TurnUsage } from '@shared/domain/cost.ts'
import type { Product } from '@shared/domain/journey.ts'
import {
  transition,
  type ApplicationState,
  type TransitionEvent,
} from '@shared/domain/state-machine.ts'

/*
 * Helpers `inspect_case` shares with the rest of the console in the Edge Function. Copied here
 * rather than imported from the overview store so the two families stay independent.
 */

/**
 * What a set of turns cost, from what was measured and an average for the rest.
 *
 * Turns recorded before cost tracking existed have no usage, and dropping them would make an
 * old conversation look free. So they are filled with `TYPICAL_TURN` and the result says how
 * many of each there were.
 */
export function costOf(rows: readonly { usage: unknown }[]): Cost {
  const measured = rows.map((row) => toUsage(row.usage)).filter((u): u is TurnUsage => u !== null)
  const unmeasured = rows.length - measured.length
  const total = sumUsage([...measured, ...Array.from({ length: unmeasured }, () => TYPICAL_TURN)])
  return {
    tokens: tokensIn(total),
    euro: costIn(total),
    turns: rows.length,
    measuredTurns: measured.length,
  }
}

/** Whoever the case is about, as they said it. Newest standing `identity.fullName` wins. */
export function statedName(
  facts: readonly { key: string; value: unknown; supersededBy: unknown }[],
): string | null {
  const stated = facts.filter(
    (fact) => fact.key === 'identity.fullName' && fact.supersededBy === null,
  )
  const latest = stated.at(-1)?.value
  return typeof latest === 'string' && latest.trim().length > 0 ? latest : null
}

/** What it has cost to reach this customer, counted from the events. The euro is zero. */
export function notificationCost(events: readonly { type: string; payload: unknown }[]): {
  sent: number
  delivered: number
  euro: number
} {
  const sent = events.filter((event) => event.type === 'notification_sent')
  const delivered = sent.reduce((total, event) => {
    const payload = event.payload
    const count =
      typeof payload === 'object' && payload !== null && 'delivered' in payload
        ? (payload as { delivered?: unknown }).delivered
        : undefined
    return total + (typeof count === 'number' ? count : 0)
  }, 0)
  return { sent: sent.length, delivered, euro: 0 }
}

/** The bank as the customer knows it, or the id when it is not one the card offers. */
export function bankNameOf(bank: string | null): string {
  if (bank === null) return 'a linked account'
  return LINKABLE_BANKS.find((candidate) => candidate.id === bank)?.name ?? bank
}

/** What an event was about, from whatever the payload names. */
export function objectOf(payload: Record<string, unknown>): string {
  for (const key of ['title', 'label', 'product', 'purpose', 'name']) {
    const value = payload[key]
    if (typeof value === 'string' && value.length > 0) return value.replaceAll('_', ' ')
  }
  return ''
}

/** With the bank and not yet decided: the only time anyone there is checking documents. */
export function underAssessment(state: ApplicationState): boolean {
  return state === 'submitted' || state === 'under_review' || state === 'info_required'
}

const DEMO_MOVES: Record<
  string,
  { product: string; label: string; steps: readonly string[]; note: string }
> = {
  credit_card_approved: {
    product: 'credit_card',
    label: 'Credit card approved',
    steps: ['received_by_bank', 'assessment_approved'],
    note: 'Takes the submitted card through assessment to approved.',
  },
  joint_account_approved: {
    product: 'joint_account',
    label: 'Joint account approved',
    steps: ['received_by_bank', 'assessment_approved'],
    note: 'Takes the submitted joint account through to approved.',
  },
  mortgage_to_assessment: {
    product: 'mortgage',
    label: 'Mortgage moved to assessment',
    steps: ['received_by_bank'],
    note: 'Moves the submitted mortgage into assessment.',
  },
  mortgage_requests_document: {
    product: 'mortgage',
    label: 'Mortgage requests a document',
    steps: ['information_requested'],
    note: 'The mortgage team asks for one more payslip.',
  },
  protection_approved: {
    product: 'protection',
    label: 'Protection approved',
    steps: ['received_by_bank', 'assessment_approved'],
    note: 'Takes the submitted protection through to approved.',
  },
}

/**
 * Which hand-moves are possible on a case right now, and why not when they are not. Each is
 * checked against the state machine rather than guessed (§41).
 */
export function movesFor(
  applications: readonly { id: string; product: string; state: string; resume_to: string | null }[],
): readonly { id: string; label: string; available: boolean; note: string }[] {
  return Object.entries(DEMO_MOVES).map(([id, move]) => {
    const application = applications.find((candidate) => candidate.product === move.product)
    if (!application) {
      return {
        id,
        label: move.label,
        available: false,
        note: `No ${move.product.replaceAll('_', ' ')} on the case yet.`,
      }
    }
    const first = move.steps[0]
    const possible = transition(
      {
        id: asApplicationId(application.id),
        product: application.product as Product,
        state: application.state as ApplicationState,
        resumeTo: application.resume_to as ApplicationState | null,
      },
      { type: first } as TransitionEvent,
    ).ok
    return {
      id,
      label: move.label,
      available: possible,
      note: possible ? move.note : `Not possible from "${application.state}".`,
    }
  })
}

/** §44: one case's feedback, newest first, with the reply each thumbs was on. */
export async function loadCaseFeedback(db: Db, caseId: string): Promise<FeedbackItem[]> {
  const result = await db
    .from('feedback')
    .select('id, case_id, kind, rating, comment, reply_to, created_at, messages(content)')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
  if (result.error !== null) throw new Error(`Failed to load feedback: ${result.error.message}`)

  const rows = result.data as unknown as {
    id: string
    case_id: string
    kind: string
    rating: number
    comment: string | null
    reply_to: string | null
    created_at: string
    messages: { content: string } | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    kind: row.kind === 'turn' ? 'turn' : 'session',
    rating: row.rating,
    comment: row.comment,
    replyTo: row.reply_to,
    about: row.kind === 'turn' && row.messages !== null ? row.messages.content.slice(0, 160) : null,
    createdAt: row.created_at,
  }))
}
