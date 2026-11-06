import { LINKABLE_BANKS } from '@shared/contracts/cards.ts'
import { BANK_REQUEST_PREFIX, bankRequirementId } from '@shared/domain/bank-requests.ts'
import { applicationName } from '@shared/db/applications.ts'
import { loadCase, mustWrite, recordFacts, writeEvent } from '@shared/db/case-repository.ts'
import { loadPlans, planContextFor, reconcilePlans } from '@shared/db/plans.ts'
import { canTransition } from '@shared/domain/plans/engine.ts'
import type { PlanStatus } from '@shared/domain/plans/types.ts'
import { asApplicationId } from '@shared/domain/facts.ts'
import { transition, type TransitionEvent } from '@shared/domain/state-machine.ts'
import type { Product } from '@shared/domain/journey.ts'
import type { ApplicationState } from '@shared/domain/state-machine.ts'
import { ApiError } from '../../errors.ts'
import type { Db } from '../client.ts'
import { DEMO_MOVES, underAssessment } from './demoMoves.ts'

export type SimulatedEvent =
  | 'received_by_bank'
  | 'information_requested'
  | 'information_supplied'
  | 'documents_verified'
  | 'assessment_approved'
  | 'assessment_declined'
  | 'completed'

export type PlanMove = 'pause' | 'resume' | 'complete' | 'abandon' | 'trigger_checkin'

export interface AdminSimulateStore {
  /** §41: a downstream bank event, through the state machine. Returns the resulting state. */
  simulateEvent(input: {
    applicationId: string
    event: SimulatedEvent
    detail?: string | undefined
  }): Promise<{ state: string }>
  reachSavingsTarget(caseId: string): Promise<{ reached: boolean; target: number | null }>
  setSavingsBalance(
    caseId: string,
    amount: number,
  ): Promise<{
    amount: number
    seen: number | null
    plansActive: number
    milestonesConsidered: number
    milestonesReached: number
  }>
  planMove(
    caseId: string,
    planId: string,
    move: PlanMove,
  ): Promise<{ status: string; checkin?: string }>
  verifyDocuments(caseId: string): Promise<{ verified: number }>
  demoAction(caseId: string, move: string): Promise<{ state: string }>
  settleTransfer(
    transferId: string,
  ): Promise<{ transferId: string; state: 'settled'; settledAt: string }>
}

const EVENT_NAMES: Record<SimulatedEvent, string> = {
  received_by_bank: 'application_received',
  information_requested: 'information_requested',
  information_supplied: 'document_received',
  documents_verified: 'documents_verified',
  assessment_approved: 'application_approved',
  assessment_declined: 'application_declined',
  completed: 'application_completed',
}

/** The bank as the customer knows it, or the id when it is not one the card offers. */
function bankNameOf(bank: string | null): string {
  if (bank === null) return 'a linked account'
  return LINKABLE_BANKS.find((candidate) => candidate.id === bank)?.name ?? bank
}

/**
 * §41: a request for information is something the customer can answer. Opens a real
 * `application_requests` row, derived from the wording so asking again reuses the open row.
 */
async function openBankRequest(
  db: Db,
  input: { caseId: string; applicationId: string; detail: string },
): Promise<string> {
  const requirementId = bankRequirementId(input.detail)

  const existing = await db
    .from('application_requests')
    .select('id')
    .eq('application_id', input.applicationId)
    .eq('requirement_id', requirementId)
    .eq('status', 'open')
    .limit(1)
  const open = (existing.data ?? [])[0]
  if (open) return open.id

  // The bank asks the applicant, not the second applicant.
  const primary = await db
    .from('participants')
    .select('id')
    .eq('case_id', input.caseId)
    .eq('role', 'primary')
    .maybeSingle()

  const created = mustWrite(
    await db
      .from('application_requests')
      .insert({
        application_id: input.applicationId,
        requirement_id: requirementId,
        requested_of: primary.data?.id ?? null,
        kind: 'document',
        status: 'open',
        detail: input.detail,
      })
      .select('id')
      .single(),
    'the request',
  )

  return (created.data as { id: string }).id
}

/** What the bank was asking for, once the presenter says it has been supplied. */
async function closeBankRequests(db: Db, applicationId: string): Promise<void> {
  mustWrite(
    await db
      .from('application_requests')
      .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
      .eq('application_id', applicationId)
      .eq('status', 'open')
      .like('requirement_id', `${BANK_REQUEST_PREFIX}%`),
    'the requests',
  )
}

export function supabaseAdminSimulateStore(db: Db): AdminSimulateStore {
  return {
    async simulateEvent({ applicationId, event, detail: askedDetail }) {
      const found = await db
        .from('applications')
        .select('id, case_id, product, state, resume_to, catalogue_id, display_name')
        .eq('id', applicationId)
        .maybeSingle()

      const row = found.data
      if (!row) throw new ApiError('not_found', 'No such application.')

      const nameOf = () =>
        applicationName({
          product: row.product as Product,
          catalogueId: row.catalogue_id,
          displayName: row.display_name,
        })

      /*
       * §41: the bank checks what was sent in. Not a move between states, so it branches
       * before the machine, which has no event for it.
       */
      if (event === 'documents_verified') {
        if (!underAssessment(row.state)) {
          throw new ApiError(
            'bad_request',
            'Documents can be checked once the application is with the bank.',
          )
        }

        const checked = mustWrite(
          await db
            .from('documents')
            .update({ verified: true })
            .eq('application_id', applicationId)
            .select('id'),
          'the documents',
        )
        const count = (checked.data ?? []).length

        // Nothing to check is not a check.
        if (count === 0) {
          throw new ApiError('bad_request', 'Nothing has been sent in for this application yet.')
        }

        await writeEvent(db, {
          caseId: row.case_id,
          type: 'documents_verified',
          actor: 'admin',
          applicationId,
          payload: { applicationName: nameOf(), product: row.product, documents: count },
        })

        return { state: row.state }
      }

      // §41: the state machine decides, so an illegal move is refused rather than faked.
      const result = transition(
        {
          id: asApplicationId(row.id),
          product: row.product as Product,
          state: row.state as ApplicationState,
          resumeTo: row.resume_to as ApplicationState | null,
        },
        { type: event },
      )

      if (!result.ok) throw new ApiError('illegal_transition', result.error.message)

      mustWrite(
        await db
          .from('applications')
          .update({ state: result.application.state, resume_to: result.application.resumeTo })
          .eq('id', applicationId),
        'the application',
      )

      // The ask is a row the customer can answer, not only a line in an event (§41).
      let detail = askedDetail
      let requestId: string | null = null
      if (event === 'information_requested') {
        detail = askedDetail ?? 'one more payslip'
        requestId = await openBankRequest(db, {
          caseId: row.case_id,
          applicationId,
          detail,
        })
      }
      if (event === 'information_supplied') {
        await closeBankRequests(db, applicationId)
      }

      await writeEvent(db, {
        caseId: row.case_id,
        type: EVENT_NAMES[event],
        actor: 'admin',
        applicationId,
        payload: {
          applicationName: nameOf(),
          product: row.product,
          ...(detail === undefined ? {} : { detail }),
          ...(requestId === null ? {} : { requestId }),
        },
      })

      return { state: result.application.state }
    },

    /** §41: months pass and the money is there. */
    async reachSavingsTarget(caseId) {
      const watches = await db
        .from('plan_watches')
        .select('id, kind, target, describe')
        .eq('case_id', caseId)
        .is('met_at', null)
        .eq('kind', 'savings_target')
        .limit(1)

      const watch = (watches.data ?? [])[0]
      if (!watch || watch.target === null) return { reached: false, target: null }

      const written = await recordFacts(db, {
        caseId,
        facts: [{ key: 'assets.savingsBalance', value: watch.target }],
        participants: { primary: null, partner: null },
        source: 'bank_held',
      })

      if (written.accepted.length === 0) {
        throw new ApiError('internal', 'That balance could not be written.', {
          cause: written.rejected,
        })
      }

      mustWrite(
        await db
          .from('plan_watches')
          .update({ met_at: new Date().toISOString() })
          .eq('id', watch.id),
        'the plan watch',
      )

      await writeEvent(db, {
        caseId,
        type: 'savings_target_reached',
        actor: 'system',
        payload: { target: watch.target },
      })

      return { reached: true, target: watch.target }
    },

    /** §38: one number that moves everything. */
    async setSavingsBalance(caseId, amount) {
      const outcome = await recordFacts(db, {
        caseId,
        facts: [{ key: 'assets.savingsBalance', value: amount }],
        participants: { primary: null, partner: null },
        source: 'bank_held',
      })

      if (outcome.accepted.length === 0) {
        const why = outcome.rejected.map((item: { reason: string }) => item.reason).join('; ')
        throw new ApiError('internal', `That balance was not written: ${why || 'unknown'}`)
      }

      const loadedCase = await loadCase(db, caseId, { messages: 'all' })
      const seen = loadedCase === null ? null : planContextFor(loadedCase).savingsBalance
      const reached = loadedCase === null ? [] : await reconcilePlans(db, caseId, loadedCase)

      for (const { milestone } of reached) {
        await writeEvent(db, {
          caseId,
          type: 'plan_milestone_reached',
          actor: 'system',
          payload: { label: milestone.label },
        })
      }

      await writeEvent(db, {
        caseId,
        type: 'savings_balance_set',
        actor: 'admin',
        payload: { amount, milestones: reached.length },
      })

      // Report what was evaluated, not just what changed.
      const after = loadedCase === null ? [] : await loadPlans(db, caseId, loadedCase)
      const active = after.filter((entry) => entry.plan.status === 'active')
      const considered = active.flatMap((entry) => entry.plan.milestones)

      return {
        amount,
        seen,
        plansActive: active.length,
        milestonesConsidered: considered.length,
        milestonesReached: reached.length,
      }
    },

    async planMove(caseId, planId, move) {
      const row = await db
        .from('plans')
        .select('id, status, title')
        .eq('id', planId)
        .eq('case_id', caseId)
        .maybeSingle()

      const plan = row.data as { id: string; status: PlanStatus; title: string } | null
      if (!plan) throw new ApiError('not_found', 'There is no such plan.')

      // Bringing a check-in due is not a status change, so it is handled apart.
      if (move === 'trigger_checkin') {
        const checkins = await db
          .from('plan_checkins')
          .select('id, purpose')
          .eq('plan_id', plan.id)
          .in('state', ['scheduled', 'due'])
          .limit(1)

        const checkin = (checkins.data ?? [])[0]
        if (!checkin) throw new ApiError('conflict', 'Nothing is scheduled on that plan.')

        mustWrite(
          await db.from('plan_checkins').update({ state: 'due' }).eq('id', checkin.id),
          'the check-in',
        )
        await writeEvent(db, {
          caseId,
          type: 'checkin_due',
          actor: 'admin',
          payload: { planId: plan.id, purpose: checkin.purpose },
        })

        return { status: plan.status, checkin: checkin.purpose }
      }

      const target: PlanStatus =
        move === 'pause'
          ? 'paused'
          : move === 'resume'
            ? 'active'
            : move === 'complete'
              ? 'completed'
              : 'abandoned'

      if (!canTransition(plan.status, target)) {
        throw new ApiError('conflict', `That plan cannot move from ${plan.status}.`)
      }

      const now = new Date().toISOString()
      mustWrite(
        await db
          .from('plans')
          .update({
            status: target,
            ...(target === 'paused' ? { paused_at: now } : {}),
            ...(target === 'completed' ? { completed_at: now } : {}),
          })
          .eq('id', plan.id),
        'the plan',
      )

      await writeEvent(db, {
        caseId,
        type: target === 'completed' ? 'plan_completed' : `plan_${target}`,
        actor: 'admin',
        payload: { planId: plan.id, title: plan.title },
      })

      return { status: target }
    },

    async verifyDocuments(caseId) {
      const applications = await db.from('applications').select('id').eq('case_id', caseId)
      const ids = (applications.data ?? []).map((row) => row.id)

      const updated = await db
        .from('documents')
        .update({ verified: true })
        .eq('case_id', caseId)
        .eq('verified', false)
        .select('id')

      const count = (updated.data ?? []).length

      if (count > 0) {
        await writeEvent(db, {
          caseId,
          type: 'documents_verified',
          actor: 'admin',
          payload: { count, applications: ids.length },
        })
      }

      return { verified: count }
    },

    async demoAction(caseId, moveId) {
      const move = DEMO_MOVES[moveId]
      if (!move) throw new ApiError('bad_request', 'Unknown action.')

      const found = await db
        .from('applications')
        .select('id, case_id, product, state, resume_to, catalogue_id, display_name')
        .eq('case_id', caseId)
        .eq('product', move.product)
        .maybeSingle()

      const row = found.data
      if (!row) {
        throw new ApiError(
          'not_found',
          `There is no ${move.product.replaceAll('_', ' ')} on this case yet.`,
        )
      }

      let current = {
        id: row.id,
        product: row.product as Product,
        state: row.state,
        resumeTo: row.resume_to,
      } as Parameters<typeof transition>[0]

      const names: Record<string, string> = {
        received_by_bank: 'application_received',
        information_requested: 'information_requested',
        assessment_approved: 'application_approved',
      }

      for (const step of move.steps) {
        const result = transition(current, { type: step } as TransitionEvent)
        // Stop at the first step the machine refuses rather than forcing it (§14).
        if (!result.ok) break
        current = result.application

        mustWrite(
          await db
            .from('applications')
            .update({ state: current.state, resume_to: current.resumeTo })
            .eq('id', row.id),
          'the application',
        )

        const requestId =
          step === 'information_requested'
            ? await openBankRequest(db, {
                caseId,
                applicationId: row.id,
                detail: 'one more payslip',
              })
            : null

        await writeEvent(db, {
          caseId,
          type: names[step] ?? 'application_state_changed',
          actor: 'admin',
          applicationId: row.id,
          payload: {
            applicationName: applicationName({
              product: row.product as Product,
              catalogueId: row.catalogue_id,
              displayName: row.display_name,
            }),
            product: row.product,
            ...(step === 'information_requested' ? { detail: 'one more payslip' } : {}),
            ...(requestId === null ? {} : { requestId }),
          },
        })
      }

      return { state: current.state }
    },

    /** Open banking, simulated: the receiving side settles. */
    async settleTransfer(transferId) {
      const found = await db
        .from('transfers')
        .select('id, case_id, from_account_id, to_application_id, to_label, amount, cadence, state')
        .eq('id', transferId)
        .maybeSingle()

      if (found.error) throw new Error(`Failed to load the transfer: ${found.error.message}`)
      const transfer = found.data
      if (!transfer) throw new ApiError('not_found', 'No such transfer.')
      if (transfer.state !== 'initiated') {
        throw new ApiError('conflict', `That transfer is already ${transfer.state}.`)
      }

      const account = await db
        .from('linked_accounts')
        .select('bank')
        .eq('id', transfer.from_account_id)
        .maybeSingle()
      const from = bankNameOf(account.data?.bank ?? null)

      const settledAt = new Date().toISOString()
      mustWrite(
        await db
          .from('transfers')
          .update({ state: 'settled', settled_at: settledAt })
          .eq('id', transfer.id),
        'the transfer',
      )

      await writeEvent(db, {
        caseId: transfer.case_id,
        type: 'transfer_settled',
        actor: 'admin',
        applicationId: transfer.to_application_id,
        payload: {
          transferId: transfer.id,
          amount: Number(transfer.amount),
          to: transfer.to_label,
          from,
          cadence: transfer.cadence,
          applicationName: transfer.to_label,
        },
      })

      return { transferId: transfer.id, state: 'settled', settledAt }
    },
  }
}
