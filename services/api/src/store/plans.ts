import { z } from 'zod'
import { MARKET_ARRANGEMENT_KINDS } from '@shared/contracts/cards.ts'
import type { Database, Json } from '@shared/db/database.types.ts'
import type { ShowProductsRequest } from '@shared/domain/market/products-card.ts'
import { mustWrite, recordFacts, saveMessage, writeEvent } from '@shared/db/case-repository.ts'
import {
  arrivalMessage,
  type ClaimedPlan,
  factsFromEdit,
  factsFromPlan,
  loadClaimedPlans,
} from '@shared/db/saved-plans.ts'
import { seedHoldingsFromPlan } from '@shared/db/holdings.ts'
import { DATA_NOTICE_EVENT } from '@shared/llm/data-notice.ts'
import { PLAN_EDITED_EVENT } from '@shared/domain/narration.ts'
import type { MarketPlan, PlanEdit } from '@shared/contracts/market-plan.ts'
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
  /** When the app first previewed it; null until then. */
  readonly openedAt: string | null
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
  /**
   * The first preview of the plan's link (2026-11-14, AI usage): `saved_plans.opened_at`, and
   * `link_opened_at` on the MCP call that held it, each only when not yet set.
   */
  markOpened(planId: string): Promise<void>
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
  /**
   * An edit in the app (2026-11-12, "6. The saving months"): the rebuilt plan replaces the
   * claimed plan's document (the previous one travels in the event, not a new table), and
   * `plan_edited` is written with `event`, which the next return turn narrates. The case's
   * facts for the edited figures follow the rebuilt plan (`factsFromEdit`, 2026-11-13), so a
   * price changed in the profile is the price the conversation holds.
   */
  saveEdit(input: {
    planId: string
    caseId: string
    plan: MarketPlan
    event: Record<string, unknown>
    /** The figures edited; their facts are recorded from the rebuilt plan. */
    fields?: readonly PlanEdit['field'][]
    /** The editing participant, for a fact about a person (none of the edited ones is). */
    participantId?: string | null
  }): Promise<void>
  /**
   * A choice made or taken off on a card (2026-11-13): the plan with its choices replaces the
   * claimed plan's document, and the event (`product_chosen` or `product_choice_removed`) is
   * written, which the next return turn narrates.
   */
  saveChoices(input: {
    planId: string
    caseId: string
    plan: MarketPlan
    event: { type: string; payload: Record<string, unknown> }
  }): Promise<void>
  /**
   * What a chosen row is rebuilt on besides the plan and the holdings: the case's current facts
   * (newest value per key) and the products cards it was shown (`products_shown`, newest first),
   * so a row is found on the card the customer chose it from.
   */
  choiceInputs(caseId: string): Promise<ChoiceInputs>
}

export type ChoiceInputs = {
  readonly facts: Readonly<Record<string, unknown>>
  readonly shown: readonly ShowProductsRequest[]
}

/** The products cards shown on a case, as their requests, newest first. */
export function shownRequests(payloads: readonly unknown[]): ShowProductsRequest[] {
  return payloads.flatMap((payload): ShowProductsRequest[] => {
    const parsed = shownPayload.safeParse(payload)
    if (!parsed.success) return []
    const { arrangement, category, sortBy, focus, filters } = parsed.data
    return [
      {
        arrangement,
        ...(category === undefined ? {} : { category }),
        ...(sortBy === undefined ? {} : { sortBy }),
        ...(focus === undefined ? {} : { focus }),
        ...(filters === undefined ? {} : { filters }),
      },
    ]
  })
}

const shownPayload = z.object({
  arrangement: z.enum(MARKET_ARRANGEMENT_KINDS),
  category: z.enum(['savings', 'deposits', 'mortgages']).optional(),
  sortBy: z.enum(['five_year_cost', 'keys_date', 'monthly_repayment']).optional(),
  focus: z.enum(['lump', 'monthly']).optional(),
  filters: z
    .object({
      stayWithBank: z.boolean().optional(),
      rateType: z.enum(['fixed', 'variable', 'either']).optional(),
      green: z.boolean().optional(),
    })
    .optional(),
})

/** How many `products_shown` cards a choice is looked for on, newest first. */
const SHOWN_CARDS = 12

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
  openedAt: row.opened_at,
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

    async markOpened(planId) {
      const at = new Date().toISOString()
      const [plan, call] = await Promise.all([
        db.from('saved_plans').update({ opened_at: at }).eq('id', planId).is('opened_at', null),
        db
          .from('mcp_calls')
          .update({ link_opened_at: at })
          .eq('saved_plan_id', planId)
          .is('link_opened_at', null),
      ])
      if (plan.error) throw new Error(`Could not mark the plan opened: ${plan.error.message}`)
      if (call.error)
        throw new Error(`Could not mark the call's link opened: ${call.error.message}`)
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

    async saveEdit({ planId, caseId, plan, event, fields = [], participantId = null }) {
      const result = await db
        .from('saved_plans')
        .update({ document: plan, title: plan.title })
        .eq('id', planId)
        .eq('case_id', caseId)
        .select('id')
      if (result.error) throw new Error(`Could not save the plan: ${result.error.message}`)
      if ((result.data ?? []).length !== 1) throw new Error('Could not save the plan: no row')
      await writeEvent(db, {
        caseId,
        type: PLAN_EDITED_EVENT,
        actor: 'customer',
        payload: event,
      })
      const edited = factsFromEdit(plan, fields)
      if (edited.length > 0) {
        await recordFacts(db, {
          caseId,
          facts: edited.map((fact) => ({ key: fact.key, value: fact.value })),
          participants: { primary: participantId, partner: null },
          source: 'customer_stated',
        })
      }
    },

    async saveChoices({ planId, caseId, plan, event }) {
      const result = await db
        .from('saved_plans')
        .update({ document: plan, title: plan.title })
        .eq('id', planId)
        .eq('case_id', caseId)
        .select('id')
      if (result.error) throw new Error(`Could not save the plan: ${result.error.message}`)
      if ((result.data ?? []).length !== 1) throw new Error('Could not save the plan: no row')
      await writeEvent(db, { caseId, type: event.type, actor: 'customer', payload: event.payload })
    },

    async choiceInputs(caseId) {
      const [facts, shown] = await Promise.all([
        db
          .from('facts')
          .select('key, value, captured_at')
          .eq('case_id', caseId)
          .is('superseded_by', null)
          .order('captured_at', { ascending: true }),
        db
          .from('events')
          .select('payload')
          .eq('case_id', caseId)
          .eq('type', 'products_shown')
          .order('created_at', { ascending: false })
          .limit(SHOWN_CARDS),
      ])
      if (facts.error) throw new Error(`Could not read the facts: ${facts.error.message}`)
      if (shown.error) throw new Error(`Could not read the cards shown: ${shown.error.message}`)
      // Ascending, so the newest value of a key is the one kept.
      const byKey: Record<string, unknown> = {}
      for (const row of facts.data) byKey[String(row.key)] = row.value
      return { facts: byKey, shown: shownRequests(shown.data.map((row) => row.payload)) }
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
