import type { Database, Json } from '@shared/db/database.types.ts'
import { mustWrite, saveMessage, writeEvent } from '@shared/db/case-repository.ts'
import {
  arrivalMessage,
  type ClaimedPlan,
  factsFromPlan,
  loadClaimedPlans,
} from '@shared/db/saved-plans.ts'
import { seedHoldingsFromPlan } from '@shared/db/holdings.ts'
import { DATA_NOTICE_EVENT } from '@shared/llm/data-notice.ts'
import type { MarketPlan } from '@shared/contracts/market-plan.ts'
import type { Db } from './client.ts'

/**
 * Plans saved from the customer's own AI (`saved_plans`), and what claiming one writes.
 *
 * Who may claim and which conversation it lands in is the route's business; this is data
 * access plus the one write that matters for a race, `markClaimed`, which is a single
 * conditional update so two browsers opening the same link cannot both win.
 */

export type StoredPlan = {
  readonly id: string
  readonly title: string
  /** As stored; the route parses it. */
  readonly document: unknown
  readonly client: string | null
  readonly createdAt: string
  readonly expiresAt: string
  readonly claimedAt: string | null
  readonly claimedBy: string | null
  readonly caseId: string | null
}

export type PlanStore = {
  save(input: {
    plan: MarketPlan
    client: string | null
    tokenHash: string
    expiresAt: string
  }): Promise<{ id: string }>
  /** Deletes every unclaimed plan past its expiry or older than 24 hours. How many went. */
  sweep(): Promise<number>
  /** Plans saved since then, for the daily ceiling on a public route. */
  savedSince(sinceIso: string): Promise<number>
  findByTokenHash(tokenHash: string): Promise<StoredPlan | null>
  /** Whether any plan has been claimed into this case. */
  caseHasPlan(caseId: string): Promise<boolean>
  /** The plan most recently claimed into this case, parsed; null when there is none. */
  claimedPlan(caseId: string): Promise<ClaimedPlan | null>
  /**
   * Claims the plan for this user and case, only if nobody has and it has not expired. True
   * when this call won.
   */
  markClaimed(input: { planId: string; userId: string; caseId: string }): Promise<boolean>
  /**
   * Everything the claim records on the case: the situation's facts that map cleanly
   * (`customer_stated`, keys the case does not already hold), the first holdings from the
   * situation's savings and debts (once per case), `plan_saved` and `plan_claimed`, and
   * Saoirse's first message: the plan card with the opening line (`arrivalMessage`). Then
   * `last_seen_at` moves past every event, so the claim is not news for a return turn: the
   * customer has seen the card and the question, and their answer is an ordinary turn.
   */
  recordClaim(input: {
    planId: string
    caseId: string
    participantId: string
    plan: MarketPlan
    client: string | null
    savedAt: string
  }): Promise<{ facts: readonly string[] }>
}

type Row = Database['public']['Tables']['saved_plans']['Row']

const toStored = (row: Row): StoredPlan => ({
  id: row.id,
  title: row.title,
  document: row.document,
  client: row.client,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  claimedAt: row.claimed_at,
  claimedBy: row.claimed_by,
  caseId: row.case_id,
})

export function supabasePlanStore(db: Db): PlanStore {
  return {
    async save({ plan, client, tokenHash, expiresAt }) {
      const result = await db
        .from('saved_plans')
        .insert({
          version: plan.version,
          document: plan as unknown as Json,
          title: plan.title,
          client,
          token_hash: tokenHash,
          expires_at: expiresAt,
        })
        .select('id')
        .single()
      if (result.error || !result.data) {
        throw new Error(`Could not save the plan: ${result.error?.message ?? 'no row'}`)
      }
      return { id: result.data.id }
    },

    async sweep() {
      const result = await db.rpc('sweep_saved_plans')
      if (result.error) throw new Error(`Could not sweep plans: ${result.error.message}`)
      return result.data
    },

    async savedSince(sinceIso) {
      const result = await db
        .from('saved_plans')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso)
      if (result.error) throw new Error(`Could not count plans: ${result.error.message}`)
      return result.count ?? 0
    },

    async findByTokenHash(tokenHash) {
      const result = await db
        .from('saved_plans')
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (result.error) throw new Error(`Could not read the plan: ${result.error.message}`)
      return result.data === null ? null : toStored(result.data)
    },

    async caseHasPlan(caseId) {
      const result = await db
        .from('saved_plans')
        .select('id', { count: 'exact', head: true })
        .eq('case_id', caseId)
      if (result.error) throw new Error(`Could not read plans: ${result.error.message}`)
      return (result.count ?? 0) > 0
    },

    async claimedPlan(caseId) {
      return (await loadClaimedPlans(db, caseId)).at(-1) ?? null
    },

    async markClaimed({ planId, userId, caseId }) {
      const now = new Date().toISOString()
      const result = await db
        .from('saved_plans')
        .update({ claimed_at: now, claimed_by: userId, case_id: caseId })
        .eq('id', planId)
        .is('claimed_at', null)
        .gt('expires_at', now)
        .select('id')
      if (result.error) throw new Error(`Could not claim the plan: ${result.error.message}`)
      return (result.data ?? []).length === 1
    },

    async recordClaim({ planId, caseId, participantId, plan, client, savedAt }) {
      // What the case already holds wins: the plan is a snapshot from somewhere else.
      const held = await db
        .from('facts')
        .select('key')
        .eq('case_id', caseId)
        .is('superseded_by', null)
      const heldKeys = new Set((held.data ?? []).map((row) => String(row.key)))
      const fresh = factsFromPlan(plan).filter((fact) => !heldKeys.has(fact.key))

      if (fresh.length > 0) {
        mustWrite(
          await db.from('facts').insert(
            fresh.map((fact) => ({
              case_id: caseId,
              key: fact.key,
              participant_id: fact.subject === 'household' ? null : participantId,
              subject_kind:
                fact.subject === 'household' ? ('household' as const) : ('participant' as const),
              value: fact.value as Json,
              source: 'customer_stated' as const,
              verified: false,
            })),
          ),
          'the plan’s facts',
        )
        for (const fact of fresh) {
          await writeEvent(db, {
            caseId,
            type: 'context_captured',
            actor: 'customer',
            payload: { key: fact.key, from: 'saved_plan' },
          })
        }
      }

      // The plan's savings and debts become the case's first holdings, noted on the plan's
      // date, so the customer edits rather than starts again. Once per case; a failure is
      // logged and never undoes the claim.
      try {
        await seedHoldingsFromPlan(db, {
          caseId,
          planId,
          plan,
          notedOn: new Date(plan.createdAt).toLocaleDateString('en-CA', {
            timeZone: 'Europe/Dublin',
          }),
        })
      } catch (error) {
        console.error(
          `holdings not seeded from plan ${planId}: ${error instanceof Error ? error.message : 'unknown'}`,
        )
      }

      await writeEvent(db, {
        caseId,
        type: 'plan_saved',
        actor: 'customer',
        payload: { planId, client, savedAt },
      })
      await writeEvent(db, {
        caseId,
        type: 'plan_claimed',
        actor: 'customer',
        payload: {
          planId,
          title: plan.title,
          products: plan.combination.products.length,
          facts: fresh.length,
          opening: arrivalMessage({ id: planId, plan }).content,
        },
      })
      // The app showed the data notice in the chat and the customer accepted it before the
      // claim (2026-11-10), so the first turn does not show the notes card a second time.
      await writeEvent(db, {
        caseId,
        type: DATA_NOTICE_EVENT,
        actor: 'customer',
        payload: { accepted: 'saved_comparison' },
      })

      /*
       * Saoirse's first message (2026-11-12, "3. Arrival"): the card the customer saw in their
       * AI, then the one question, as one row. The app shows it at once; nothing waits on a turn.
       */
      const first = arrivalMessage({ id: planId, plan })
      await saveMessage(db, {
        caseId,
        participantId: null,
        role: 'assistant',
        content: first.content,
        cards: first.cards,
      })

      /*
       * Seen up to now, so `POST /api/sessions` does not report `hasUpdates` and the app does not
       * run a return turn that would greet them over the question. The latest event's own time,
       * when the database clock is ahead of this one, so no event of the claim falls after it.
       */
      const latest = await db
        .from('events')
        .select('created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const now = new Date().toISOString()
      const eventAt = latest.data?.created_at ?? null
      mustWrite(
        await db
          .from('cases')
          // The event's own string when it is not earlier: Postgres keeps microseconds.
          .update({
            last_seen_at:
              eventAt !== null && Date.parse(eventAt) >= Date.parse(now) ? eventAt : now,
          })
          .eq('id', caseId),
        'the case',
      )

      return { facts: fresh.map((fact) => fact.key) }
    },
  }
}
