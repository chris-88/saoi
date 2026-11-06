import {
  loadCase,
  mustWrite,
  recordFacts,
  writeEvent,
  type Insert,
} from '@shared/db/case-repository.ts'
import {
  createApplications,
  evaluateFor,
  recomputeApplications,
  recordReuse,
  type NameFor,
  type ProductChoice,
} from '@shared/db/applications.ts'
import { loadProductCatalogue } from '@shared/db/catalogue.ts'
import { deferNeed } from '@shared/db/needs.ts'
import { syncFormApplications } from '@shared/db/form-applications.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'
import type { Json } from '@shared/db/database.types.ts'
import type { ApplicationSummary } from '@shared/contracts/case-action.ts'
import type { SynthesisedAccounts } from '@shared/domain/open-banking/synthesise.ts'
import { countReusedFacts } from '@shared/domain/reuse.ts'
import type { PlanStatus } from '@shared/domain/plans/types.ts'
import type { Product } from '@shared/domain/journey.ts'
import type { Application } from '@shared/domain/state-machine.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import { knowledgeProduct } from '@shared/tenants/demo/kb-prompt.ts'
import { must, type Db } from './client.ts'

/**
 * Everything the case action routes need from the database, as one seam.
 *
 * The rules (who may, what the state machine allows, what the journey asks) live in the routes
 * and are tested there with this mocked. Each method here is one write the Edge Function made,
 * or one group that must stand or fall together; none decides anything.
 *
 * Transactions: supabase-js cannot hold one across calls, so the two groups that need it
 * (`submitApplication`, `invitePartner`) are Postgres functions called with `rpc`
 * (migration `20261104153000_case_action_transactions.sql`). Everything else keeps the Edge
 * Function's sequence of checked writes (`mustWrite`).
 */

export type PlanRow = {
  readonly id: string
  readonly status: PlanStatus
  readonly title: string
  readonly targetAmount: number | null
}

export type EventSpec = {
  readonly type: string
  readonly applicationId?: string
  readonly payload: Record<string, unknown>
}

export type FormApplicationRow = { readonly id: string; readonly answers: Record<string, unknown> }

export type PreparedAccounts = SynthesisedAccounts

export type CaseActionStore = {
  /** The whole case as the domain code reads it. Null if it is gone. */
  loadForAction(caseId: string): Promise<LoadedCase | null>
  /** The catalogue names applications (§51): the console's rows, or the published file. */
  applicationNamer(): Promise<NameFor>

  /**
   * Creates the applications and records what each new one never had to ask for (§53).
   * Returns the choices actually started and the number of facts carried over.
   */
  startApplications(
    loaded: LoadedCase,
    choices: readonly ProductChoice[],
    nameFor: NameFor,
  ): Promise<{ created: readonly ProductChoice[]; reused: number }>
  /** Idempotent per product. */
  declineProduct(caseId: string, product: Product): Promise<void>

  confirmRequirement(input: {
    applicationId: string
    requirementId: string
    participantId: string
    kind: 'confirmation' | 'consent'
  }): Promise<void>
  /**
   * Submission, atomically: the ticked confirmations, the state change and its events, or
   * nothing. False when the application is no longer in `fromState` (someone else got there).
   */
  submitApplication(input: {
    caseId: string
    applicationId: string
    participantId: string
    confirmations: readonly string[]
    fromState: string
    toState: string
    events: readonly (EventSpec & { actor: 'customer' | 'system' })[]
  }): Promise<boolean>
  /** Pause or resume. A paused loan also parks the need it served (§27). */
  changeApplicationState(input: {
    caseId: string
    applicationId: string
    state: Application['state']
    resumeTo: Application['resumeTo']
    event: EventSpec
    deferLoanNeed: boolean
  }): Promise<void>

  findPlan(caseId: string, planId: string): Promise<PlanRow | null>
  savePlanDecision(input: {
    caseId: string
    plan: PlanRow
    status: PlanStatus
    keep: boolean
    /** Set when keeping a plan whose target becomes a fact (`goals.savingsTarget`). */
    goalTarget: number | null
    primaryId: string | null
    partnerId: string | null
    eventType: string
  }): Promise<void>

  /** Participant, voided old links, new link and event, in one transaction. */
  invitePartner(input: { caseId: string; name: string; tokenHash: string }): Promise<void>
  /** The link the customer passes on. Nothing is sent. */
  inviteLink(token: string): string

  subscribePush(input: {
    caseId: string
    participantId: string
    endpoint: string
    p256dh: string
    auth: string
  }): Promise<void>

  /** A consent confirmation, the consent itself (§9), and the event. */
  grantConsent(input: {
    caseId: string
    applicationId: string
    requirementId: string
    participantId: string
  }): Promise<void>
  formApplication(caseId: string, formId: string): Promise<FormApplicationRow | null>
  saveDeclarations(input: {
    caseId: string
    applicationId: string
    formId: string
    writes: readonly {
      form_application_id: string
      field_id: string
      value: string
      wording: string
      participant_id: string
    }[]
  }): Promise<void>
  saveHealthFacts(input: {
    caseId: string
    applicationId: string
    rows: readonly Insert<'facts'>[]
  }): Promise<void>

  saveLinkedAccounts(input: {
    caseId: string
    bank: string
    bankName: string
    prepared: PreparedAccounts
    scope: readonly string[]
    consentExpiresAt: string
  }): Promise<void>
  revokeLinkedAccounts(input: {
    caseId: string
    accounts: number
    banks: readonly string[]
  }): Promise<void>
  /** Returns the transfer id. A one-off also takes `newBalance` off the linked account. */
  saveTransfer(input: {
    caseId: string
    fromAccountId: string
    toApplicationId: string | null
    toLabel: string
    amount: number
    cadence: 'once' | 'monthly'
    newBalance: number | null
    event: Record<string, unknown>
  }): Promise<string>

  /** Whether the message is one of Saoirse's replies on this case. */
  saoirseMessageOnCase(caseId: string, messageId: string): Promise<boolean>
  saveFeedback(input: {
    caseId: string
    participantId: string
    messageId: string | null
    kind: 'turn' | 'session'
    rating: number
    comment: string | null
    replyTo: string | null
  }): Promise<void>

  /**
   * After every action: what is outstanding is derived, never remembered. Recomputes the
   * applications, syncs the form applications (a failure there is logged as an event, not
   * thrown: the action itself succeeded) and returns the summaries the screen redraws from.
   */
  settle(caseId: string, nameFor: NameFor): Promise<readonly ApplicationSummary[]>
}

export function supabaseActionStore(
  db: Db,
  options: { appBaseUrl?: string } = {},
): CaseActionStore {
  const base = options.appBaseUrl ?? ''

  return {
    loadForAction: (caseId) => loadCase(db, caseId),

    async applicationNamer() {
      const kb = await loadProductCatalogue(db)
      return (product, catalogueId) =>
        (catalogueId === null ? undefined : knowledgeProduct(catalogueId, kb.products)?.name) ??
        journeyFor(product).displayName
    },

    async startApplications(loaded, choices, nameFor) {
      const created = await createApplications(db, loaded, choices, nameFor)
      const reloaded = (await loadCase(db, loaded.caseId)) ?? loaded

      const startedNow = new Set(
        created.map((choice) => `${choice.product}:${choice.catalogueId ?? ''}`),
      )
      const carried = []
      for (const application of reloaded.applications) {
        if (!startedNow.has(`${application.product}:${application.catalogueId ?? ''}`)) continue
        carried.push(
          ...(await recordReuse(db, reloaded, application, evaluateFor(reloaded, application))),
        )
      }
      // One fact is one thing, however many applications it went into.
      return { created, reused: countReusedFacts(carried) }
    },

    async declineProduct(caseId, product) {
      mustWrite(
        await db
          .from('product_interests')
          .upsert(
            { case_id: caseId, product, status: 'declined' },
            { onConflict: 'case_id,product' },
          ),
        'the product interest',
      )
      await writeEvent(db, {
        caseId,
        type: 'product_declined',
        actor: 'customer',
        payload: { product },
      })
    },

    async confirmRequirement({ applicationId, requirementId, participantId, kind }) {
      mustWrite(
        await db.from('application_confirmations').upsert(
          {
            application_id: applicationId,
            requirement_id: requirementId,
            participant_id: participantId,
            kind,
          },
          { onConflict: 'application_id,requirement_id' },
        ),
        'the confirmation',
      )
    },

    async submitApplication(input) {
      const result = await db.rpc('submit_application_tx', {
        p_case_id: input.caseId,
        p_application_id: input.applicationId,
        p_participant_id: input.participantId,
        p_confirmations: [...input.confirmations],
        p_from_state: input.fromState,
        p_to_state: input.toState,
        p_events: input.events.map((event) => ({
          type: event.type,
          actor: event.actor,
          payload: event.payload,
        })) as Json,
      })
      return must(result, 'the submission') === true
    },

    async changeApplicationState({ caseId, applicationId, state, resumeTo, event, deferLoanNeed }) {
      mustWrite(
        await db
          .from('applications')
          .update({ state, resume_to: resumeTo })
          .eq('id', applicationId),
        'the application',
      )
      if (deferLoanNeed) {
        await deferNeed(db, caseId, {
          needId: 'home_improvement_borrowing',
          revisitWhen: 'mortgage_completed',
          reason: 'you asked me to leave it until the mortgage was sorted',
        })
      }
      await writeEvent(db, {
        caseId,
        type: event.type,
        actor: 'customer',
        applicationId,
        payload: event.payload,
      })
    },

    async findPlan(caseId, planId) {
      const row = await db
        .from('plans')
        .select('id, status, title, target_amount')
        .eq('id', planId)
        .eq('case_id', caseId)
        .maybeSingle()
      const data = must(row, 'the plan') as {
        id: string
        status: PlanStatus
        title: string
        target_amount: number | string | null
      } | null
      if (data === null) return null
      return {
        id: data.id,
        status: data.status,
        title: data.title,
        targetAmount: data.target_amount === null ? null : Number(data.target_amount),
      }
    },

    async savePlanDecision({
      caseId,
      plan,
      status,
      keep,
      goalTarget,
      primaryId,
      partnerId,
      eventType,
    }) {
      const now = new Date().toISOString()
      mustWrite(
        await db
          .from('plans')
          .update({
            status,
            ...(keep ? { confirmed_at: now, last_confirmed_at: now } : {}),
            ...(status === 'paused' ? { paused_at: now } : {}),
          })
          .eq('id', plan.id),
        'the plan',
      )

      // Keeping a plan is agreeing its target, so the target becomes a fact about them. Through
      // the one fact writer, because `goals.savingsTarget` is a household key and the catalogue
      // decides its subject.
      if (goalTarget !== null) {
        await recordFacts(db, {
          caseId,
          facts: [{ key: 'goals.savingsTarget', value: goalTarget }],
          participants: { primary: primaryId, partner: partnerId },
          source: 'customer_stated',
        })
      }

      await writeEvent(db, {
        caseId,
        type: eventType,
        actor: 'customer',
        payload: { planId: plan.id, title: plan.title },
      })
    },

    async invitePartner({ caseId, name, tokenHash }) {
      const result = await db.rpc('invite_partner_tx', {
        p_case_id: caseId,
        p_name: name,
        p_token_hash: tokenHash,
      })
      must(result, 'the invitation')
    },

    inviteLink: (token) => `${base}/#/join/${token}`,

    async subscribePush({ caseId, participantId, endpoint, p256dh, auth }) {
      // Keyed on the endpoint, which the push service makes unique per browser: a phone that
      // re-subscribes must not collect rows that each deliver another copy.
      mustWrite(
        await db.from('push_subscriptions').upsert(
          {
            case_id: caseId,
            participant_id: participantId,
            endpoint,
            p256dh,
            auth,
            expired_at: null,
          },
          { onConflict: 'endpoint' },
        ),
        'the subscription',
      )
      await writeEvent(db, { caseId, type: 'push_subscribed', actor: 'customer', payload: {} })
    },

    async grantConsent({ caseId, applicationId, requirementId, participantId }) {
      mustWrite(
        await db.from('application_confirmations').upsert(
          {
            application_id: applicationId,
            requirement_id: requirementId,
            participant_id: participantId,
            kind: 'consent',
          },
          { onConflict: 'application_id,requirement_id' },
        ),
        'the confirmation',
      )
      // Recorded as a consent in its own right, not only as a satisfied requirement (§9).
      mustWrite(
        await db.from('consents').upsert(
          {
            case_id: caseId,
            participant_id: participantId,
            kind: 'health_questions',
            granted: true,
          },
          { onConflict: 'participant_id,kind' },
        ),
        'the consent',
      )
      await writeEvent(db, {
        caseId,
        type: 'consent_granted',
        actor: 'customer',
        applicationId,
        payload: { requirementId, kind: 'health_questions' },
      })
    },

    async formApplication(caseId, formId) {
      const row = await db
        .from('form_applications')
        .select('id, answers')
        .eq('case_id', caseId)
        .eq('form_id', formId)
        .maybeSingle()
      const data = must(row, 'the form')
      return data === null
        ? null
        : { id: data.id, answers: (data.answers ?? {}) as Record<string, unknown> }
    },

    async saveDeclarations({ caseId, applicationId, formId, writes }) {
      mustWrite(
        await db.from('form_answers').upsert(
          writes.map((write) => ({
            ...write,
            value: write.value,
            source: 'consent' as const,
          })),
          { onConflict: 'form_application_id,field_id' },
        ),
        'the declarations',
      )
      await writeEvent(db, {
        caseId,
        type: 'consent_granted',
        actor: 'customer',
        applicationId,
        payload: { form: formId, declarations: writes.length },
      })
    },

    async saveHealthFacts({ caseId, applicationId, rows }) {
      mustWrite(await db.from('facts').insert([...rows]), 'the facts')
      await writeEvent(db, {
        caseId,
        type: 'health_form_completed',
        actor: 'customer',
        applicationId,
        // The keys answered, never the values: nothing sensitive goes in an event payload.
        payload: { answered: rows.length },
      })
    },

    async saveLinkedAccounts({ caseId, bank, bankName, prepared, scope, consentExpiresAt }) {
      const written = mustWrite(
        await db
          .from('linked_accounts')
          .insert(
            prepared.accounts.map((account) => ({
              case_id: caseId,
              bank: account.bank,
              display_name: account.displayName,
              account_type: account.accountType,
              iban: account.iban,
              balance: account.balance,
              consent_scope: [...scope],
              consent_expires_at: consentExpiresAt,
            })),
          )
          .select('id, account_type'),
        'the linked accounts',
      )

      const idByType = new Map((written.data ?? []).map((row) => [row.account_type, row.id]))
      const transactions = prepared.transactions.flatMap((transaction) => {
        const accountId = idByType.get(transaction.account)
        return accountId === undefined
          ? []
          : [
              {
                account_id: accountId,
                booked_on: transaction.bookedOn,
                amount: transaction.amount,
                description: transaction.description,
                category: transaction.category,
              },
            ]
      })
      if (transactions.length > 0) {
        mustWrite(await db.from('linked_transactions').insert(transactions), 'the transactions')
      }

      await writeEvent(db, {
        caseId,
        type: 'accounts_linked',
        actor: 'customer',
        payload: {
          bank,
          bankName,
          accounts: prepared.accounts.length,
          scope: [...scope],
          consentExpiresAt,
        },
      })
    },

    async revokeLinkedAccounts({ caseId, accounts, banks }) {
      mustWrite(
        await db
          .from('linked_accounts')
          .update({ revoked_at: new Date().toISOString() })
          .eq('case_id', caseId)
          .is('revoked_at', null),
        'the revocation',
      )
      await writeEvent(db, {
        caseId,
        type: 'accounts_revoked',
        actor: 'customer',
        payload: { accounts, banks: [...banks] },
      })
    },

    async saveTransfer({
      caseId,
      fromAccountId,
      toApplicationId,
      toLabel,
      amount,
      cadence,
      newBalance,
      event,
    }) {
      const inserted = mustWrite(
        await db
          .from('transfers')
          .insert({
            case_id: caseId,
            from_account_id: fromAccountId,
            to_application_id: toApplicationId,
            to_label: toLabel,
            amount,
            cadence,
          })
          .select('id')
          .single(),
        'the transfer',
      )
      const transferId = (inserted.data as { id: string }).id

      if (newBalance !== null) {
        mustWrite(
          await db.from('linked_accounts').update({ balance: newBalance }).eq('id', fromAccountId),
          'the balance',
        )
      }

      await writeEvent(db, {
        caseId,
        type: 'transfer_initiated',
        actor: 'customer',
        ...(toApplicationId === null ? {} : { applicationId: toApplicationId }),
        payload: { transferId, ...event },
      })
      return transferId
    },

    async saoirseMessageOnCase(caseId, messageId) {
      const message = await db
        .from('messages')
        .select('id')
        .eq('id', messageId)
        .eq('case_id', caseId)
        .eq('role', 'assistant')
        .maybeSingle()
      return must(message, 'the message') !== null
    },

    async saveFeedback({ caseId, participantId, messageId, kind, rating, comment, replyTo }) {
      mustWrite(
        await db.from('feedback').insert({
          case_id: caseId,
          participant_id: participantId,
          message_id: messageId,
          kind,
          rating,
          comment,
          reply_to: replyTo,
        }),
        'the feedback',
      )
      await writeEvent(db, {
        caseId,
        type: 'feedback_given',
        actor: 'customer',
        payload: { kind, rating, ...(messageId === null ? {} : { messageId }) },
      })
    },

    async settle(caseId, nameFor) {
      const loaded = await loadCase(db, caseId)
      if (!loaded) return []
      const applications = await recomputeApplications(db, loaded, { nameFor })

      // So selecting a product puts its form in the console now, not on the next thing said.
      // Caught: the action succeeded, and failing now would roll back nothing but the reply.
      try {
        await syncFormApplications(db, caseId)
      } catch (error) {
        await writeEvent(db, {
          caseId,
          type: 'form_sync_failed',
          actor: 'system',
          payload: { error: (error instanceof Error ? error.message : 'unknown').slice(0, 300) },
        })
      }
      return [...applications]
    },
  }
}
