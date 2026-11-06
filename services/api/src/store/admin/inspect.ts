import type { AdminCase } from '@shared/contracts/admin.ts'
import { applicationName, evaluateFor } from '@shared/db/applications.ts'
import { describeAdminEvent } from '@shared/db/admin-events.ts'
import { loadCase } from '@shared/db/case-repository.ts'
import { goalContextFor } from '@shared/db/goals.ts'
import { buildHandoffNote, handoffAsText } from '@shared/db/handoff.ts'
import { needContextFor, revivableNeeds } from '@shared/db/needs.ts'
import { loadPlans } from '@shared/db/plans.ts'
import { conversationTiming } from '@shared/domain/conversation-time.ts'
import { factCatalogue, isFactKey } from '@shared/domain/facts.ts'
import { contentionIn, evaluateGoals, matchedClusters } from '@shared/domain/goals/engine.ts'
import { evaluateNeeds } from '@shared/domain/needs/engine.ts'
import { buildPlan } from '@shared/domain/needs/plan.ts'
import { maskIban } from '@shared/domain/open-banking/synthesise.ts'
import { stateLabel, transition } from '@shared/domain/state-machine.ts'
import { ApiError } from '../../errors.ts'
import type { Db } from '../client.ts'
import {
  bankNameOf,
  costOf,
  loadCaseFeedback,
  movesFor,
  notificationCost,
  objectOf,
  statedName,
  underAssessment,
} from './inspect-support.ts'

/** The case inspector (§37): everything the console shows about one conversation. */
export interface AdminInspectStore {
  /** Was `admin` action `inspect_case`. Throws `not_found` when there is no such case. */
  inspectCase(caseId: string): Promise<AdminCase>
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Failed to load ${what}: ${error.message}`)
}

export function supabaseAdminInspectStore(db: Db): AdminInspectStore {
  return {
    async inspectCase(caseId) {
      const loaded = await loadCase(db, caseId, { messages: 'all' })
      if (!loaded) throw new ApiError('not_found', 'No such case.')

      const events = await db
        .from('events')
        .select('type, actor, created_at, payload')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(40)

      // §27: what the customer parked and what would bring it back.
      const parkedRows = await db
        .from('need_decisions')
        .select('need_id, reason, revisit_when, revisit_on')
        .eq('case_id', caseId)
        .eq('state', 'deferred')
        .is('revisited_at', null)

      const ready = new Set((await revivableNeeds(db, caseId, loaded)).map((item) => item.needId))

      const parked = (
        (parkedRows.data ?? []) as {
          need_id: string
          reason: string | null
          revisit_when: string | null
        }[]
      ).map((row) => ({
        needId: row.need_id,
        name: loaded.needs.find((need) => need.id === row.need_id)?.name ?? row.need_id,
        reason: row.reason ?? 'parked',
        revisitWhen: row.revisit_when,
        ready: ready.has(row.need_id),
      }))

      const needContext = needContextFor(loaded, { sensitiveDisclosure: false })
      const candidates = needContext === null ? [] : evaluateNeeds(needContext, loaded.needs)
      const plan = needContext === null ? null : buildPlan(needContext, candidates)

      // Plans are loaded once and shared with the goal engine, so both see the same plans.
      const loadedPlans = await loadPlans(db, caseId, loaded)
      const goalContext = goalContextFor(loaded, loadedPlans, { sensitiveDisclosure: false })
      const goalCandidates = goalContext === null ? [] : evaluateGoals(goalContext, loaded.goals)

      const watchRows = await db
        .from('plan_watches')
        .select('describe, met_at, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })

      // Its own query rather than `loaded.messages`, which is capped at the model's context.
      const turnRows = await db
        .from('messages')
        .select('usage')
        .eq('case_id', caseId)
        .eq('role', 'assistant')
      if (turnRows.error !== null) fail('the turns', turnRows.error)

      // Uploads, which the transcript cannot show.
      const documentRows = await db
        .from('documents')
        .select('document_type, verified, uploaded_at')
        .eq('case_id', caseId)
        .order('uploaded_at', { ascending: true })
      if (documentRows.error !== null) fail('the documents', documentRows.error)

      const feedback = await loadCaseFeedback(db, caseId)

      const spoken = loaded.messages.filter((message) => message.role === 'customer')
      const days = new Set(spoken.map((message) => message.createdAt.slice(0, 10)))

      return {
        caseId,
        customer: {
          // The same source the case list uses: what the customer said, then the linked record.
          name: statedName(loaded.facts) ?? loaded.customerName,
          authLevel: loaded.authLevel,
          firstSeen: loaded.messages[0]?.createdAt ?? null,
          lastSeen: loaded.messages.at(-1)?.createdAt ?? null,
          daysActive: days.size,
          messages: spoken.length,
          timing: conversationTiming(loaded.messages.map((message) => message.createdAt)),
        },
        notifications: notificationCost(events.data ?? []),
        documents: (
          documentRows.data as { document_type: string; verified: boolean; uploaded_at: string }[]
        ).map((row) => ({
          type: row.document_type.replaceAll('_', ' '),
          verified: row.verified,
          uploadedAt: row.uploaded_at,
        })),
        cost: costOf(turnRows.data),
        needs: candidates
          .filter((candidate) => candidate.confidence > 0 || candidate.state !== 'latent')
          .map((candidate) => ({
            id: candidate.need.id,
            name: candidate.need.name,
            state: candidate.state,
            confidence: candidate.confidence,
            evidence: candidate.evidence.map((item) => item.describe),
            reason: candidate.reason,
          })),
        goals: goalCandidates.map((candidate) => ({
          id: candidate.goal.id,
          name: candidate.goal.name,
          category: candidate.goal.category,
          tier: candidate.tier,
          confidence: candidate.confidence,
          evidence: candidate.evidence.map((item) => item.describe),
          clusters: [...candidate.clusters],
          reason: candidate.reason,
          revisitWhen: candidate.revisitWhen,
          missing: candidate.missing.map((key) => factCatalogue[key]?.label ?? key),
        })),
        lifeEvents:
          goalContext === null
            ? []
            : matchedClusters(goalContext).map((cluster) => ({
                id: cluster.id,
                name: cluster.name,
                because:
                  cluster.signals.find((signal) => signal.when(goalContext))?.describe ??
                  'their situation',
                note: cluster.note,
              })),
        contentions:
          goalContext === null
            ? []
            : contentionIn(goalContext).map((contention) => ({
                resource: contention.resource,
                describe: contention.describe,
                needed: contention.needed,
                available: contention.available,
              })),
        handoff: (() => {
          const note = buildHandoffNote({
            loaded,
            goals: goalCandidates,
            goalContext,
            needs: candidates,
            plans: loadedPlans,
          })
          return {
            who: note.who,
            turns: note.turns,
            lastSeen: note.lastSeen,
            sections: note.sections.map((section) => ({
              heading: section.heading,
              lines: [...section.lines],
              caution: section.caution ?? false,
            })),
            text: handoffAsText(note),
          }
        })(),
        demoActions: [
          ...movesFor(
            loaded.applications.map((application) => ({
              id: String(application.id),
              product: application.product,
              state: application.state,
              resume_to: application.resumeTo,
            })),
          ),
        ],
        conversation: loaded.messages.map((message) => ({
          role: message.role,
          timing: message.timing,
          content: message.content,
          cards: [...message.cards],
          at: message.createdAt,
        })),
        planSteps: (plan?.steps ?? []).map((step) => `${step.title} — ${step.because}`),
        // Every figure here is computed by the plan engine, so the console and the customer
        // are looking at the same arithmetic (§40).
        plans: loadedPlans.map(({ plan: p, progress }) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          targetAmount: p.targetAmount,
          currentAmount: progress.current,
          projectedDate: progress.projectedDate,
          monthsRemaining: progress.monthsRemaining,
          onTrack: progress.onTrack,
          milestones: p.milestones.map((milestone) => ({
            id: milestone.id,
            label: milestone.label,
            state: milestone.state,
            achievedAt: milestone.achievedAt,
          })),
          checkins: p.checkins.map((checkin) => ({
            id: checkin.id,
            purpose: checkin.purpose,
            state: checkin.state,
            when:
              checkin.dueAt === null
                ? `when ${checkin.triggerEvent ?? 'something changes'}`
                : checkin.dueAt.slice(0, 10),
            agenda: [...checkin.agenda],
          })),
        })),
        watches: (
          (watchRows.data ?? []) as {
            describe: string
            met_at: string | null
            created_at: string
          }[]
        ).map((row) => ({
          describe: row.describe,
          met: row.met_at !== null,
          createdAt: row.created_at,
        })),
        // The inspector DOES show that sensitive facts exist, flagged: this surface is for
        // the person running the demonstration, not for the model.
        facts: loaded.facts.map((fact) => ({
          key: fact.key,
          label: isFactKey(fact.key) ? factCatalogue[fact.key].label : fact.key,
          value: factCatalogue[fact.key].sensitivity === 'special' ? '(held)' : String(fact.value),
          source: fact.source,
          verified: fact.verified,
          superseded: fact.supersededBy !== null,
          sensitive: factCatalogue[fact.key].sensitivity === 'special',
        })),
        applications: loaded.applications.map((application) => ({
          id: String(application.id),
          product: application.product,
          displayName: applicationName(application),
          state: application.state,
          stateLabel: stateLabel(application.state),
          outstanding: evaluateFor(loaded, application)
            .outstanding.filter((item) => item.blocking)
            .map((item) => item.requirement.label),
          // Only the presenter moves the machine will accept. The document check is the one
          // move it does not own: offered while the application is with the bank and something
          // sent in is still unchecked.
          canSimulate: ((): string[] => {
            const documents = loaded.documents.filter(
              (document) => document.applicationId === application.id,
            )
            return (
              [
                'received_by_bank',
                'information_requested',
                'information_supplied',
                'documents_verified',
                'assessment_approved',
                'assessment_declined',
                'completed',
              ] as const
            ).filter((event) =>
              event === 'documents_verified'
                ? underAssessment(application.state) &&
                  documents.length > 0 &&
                  documents.some((document) => !document.verified)
                : transition(application, { type: event }).ok,
            )
          })(),
        })),
        events: (
          (events.data ?? []) as {
            type: string
            actor: string
            created_at: string
            payload: Record<string, unknown> | null
          }[]
        ).map((row) => ({
          type: row.type,
          actor: row.actor,
          at: row.created_at,
          // What it was about, where the payload says. Most events name the thing they changed.
          object: objectOf(row.payload ?? {}),
          ...describeAdminEvent(row.type, row.payload ?? {}),
        })),
        parked,
        linkedAccounts: loaded.linkedAccounts.map((account) => ({
          bank: bankNameOf(account.bank),
          displayName: account.displayName,
          accountType: account.accountType,
          ibanMasked: maskIban(account.iban),
          balance: account.balance,
          consentExpiresAt: account.consentExpiresAt,
        })),
        transfers: loaded.transfers.map((transfer) => {
          // Revoked accounts are not loaded, so a transfer from one is labelled as such
          // rather than dropped: the money moved whether or not the consent still stands.
          const from = loaded.linkedAccounts.find(
            (account) => account.id === transfer.fromAccountId,
          )
          return {
            id: transfer.id,
            fromLabel:
              from === undefined
                ? 'An account no longer linked'
                : `${bankNameOf(from.bank)} ${from.displayName}`,
            toLabel: transfer.toLabel,
            amount: transfer.amount,
            cadence: transfer.cadence,
            state: transfer.state,
            createdAt: transfer.createdAt,
          }
        }),
        feedback,
      }
    },
  }
}
