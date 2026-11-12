import { z } from 'zod'
import { CASE_KINDS } from '../domain/case.ts'
import { FACT_SOURCES, isFactKey } from '../domain/facts.ts'
import { PRODUCTS } from '../domain/journey.ts'
import { APPLICATION_STATES } from '../domain/state-machine.ts'
import { NEED_PRIORITIES } from '../domain/needs/types.ts'
import type { CatalogueOverride } from '../domain/catalogue/overlay.ts'
import type { TurnUsage } from '../domain/cost.ts'

/**
 * Row schemas.
 *
 * The database is a boundary, so rows are parsed rather than trusted. This is what catches a
 * migration that has drifted from the domain — at the point of reading, with a clear error,
 * instead of somewhere deep in the requirement engine.
 */

export const caseRow = z.object({
  id: z.uuid(),
  kind: z.enum(CASE_KINDS),
  auth_level: z.enum(['anonymous', 'authenticated']),
  last_seen_at: z.string().nullable(),
  customer_id: z.uuid().nullable(),
})

export const participantRow = z.object({
  id: z.uuid(),
  role: z.enum(['primary', 'partner']),
  display_name: z.string().nullable(),
})

export const factRow = z.object({
  id: z.uuid(),
  key: z.string().refine(isFactKey, 'not a catalogue fact key'),
  participant_id: z.uuid().nullable(),
  subject_kind: z.enum(['participant', 'household']),
  value: z.unknown(),
  source: z.enum(FACT_SOURCES),
  verified: z.boolean(),
  captured_for: z.uuid().nullable(),
  superseded_by: z.uuid().nullable(),
  captured_at: z.string(),
})

export const applicationRow = z.object({
  id: z.uuid(),
  product: z.enum(PRODUCTS),
  state: z.enum(APPLICATION_STATES),
  resume_to: z.enum(APPLICATION_STATES).nullable(),
  catalogue_id: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
})

export const confirmationRow = z.object({
  application_id: z.uuid(),
  requirement_id: z.string(),
})

export const documentRow = z.object({
  application_id: z.uuid().nullable(),
  requirement_id: z.string().nullable(),
  verified: z.boolean(),
})

export const requestRow = z.object({
  id: z.uuid(),
  application_id: z.uuid(),
  requirement_id: z.string(),
  status: z.enum(['open', 'fulfilled', 'cancelled']),
  detail: z.string().nullable(),
})

export const productInterestRow = z.object({
  product: z.enum(PRODUCTS),
  status: z.enum(['offered', 'accepted', 'declined', 'deferred']),
  reason: z.string().nullable(),
})

export const messageRow = z
  .object({
    role: z.enum(['customer', 'assistant', 'system']),
    content: z.string(),
    created_at: z.string(),
    /** Measured on Saoirse's turns only; absent, null or malformed all mean nobody measured it. */
    usage: z.unknown().optional(),
    /**
     * The cards rendered with this turn. Only their types are needed here — enough to know a
     * card is already on screen without carrying its whole payload through the loader.
     */
    cards: z.array(z.object({ type: z.string() }).loose()).default([]),
  })
  .transform(({ cards, ...message }) => ({
    ...message,
    cards: cards.map((card) => card.type),
    /**
     * The products cards shown with this turn, as their arrangement and title: the digest says a
     * card was shown and how it was arranged, never its rows, so a follow-up ("by access instead")
     * calls the tool again rather than reading figures out of the transcript.
     */
    productsShown: cards.flatMap((card) => {
      const arrangement = card['arrangement']
      if (
        card.type !== 'market_products' ||
        typeof arrangement !== 'object' ||
        arrangement === null
      )
        return []
      const { kind, title } = arrangement as { kind?: unknown; title?: unknown }
      return typeof kind === 'string' && typeof title === 'string' ? [{ kind, title }] : []
    }),
  }))

export const eventRow = z.object({
  type: z.string(),
  created_at: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
})

export const personaRow = z.object({
  preset: z.string(),
  sliders: z.object({
    length: z.number(),
    humour: z.number(),
    sarcasm: z.number(),
    formality: z.number(),
    playfulness: z.number(),
    poetic: z.number(),
  }),
})

export const domainConfigRow = z.object({ kill_switch: z.boolean() })

export const customerRow = z.object({ full_name: z.string() })

/**
 * A catalogue override (plan §3.2).
 *
 * The jsonb columns are parsed rather than cast: they hold presenter-entered prose, and the one
 * thing worse than an unreadable agenda is an agenda that is not an array of strings being
 * handed to the prompt composer.
 */
export const catalogueOverrideRow = z.object({
  kind: z.enum(['goal', 'need']),
  entry_id: z.string(),
  enabled: z.boolean(),
  name: z.string().nullable(),
  summary: z.string().nullable(),
  priority: z.enum(NEED_PRIORITIES).nullable(),
  milestone_labels: z.record(z.string(), z.string()),
  checkin_agendas: z.record(z.string(), z.array(z.string())),
  version: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
})

/** Row to domain. The overlay works in domain terms and knows nothing about column names. */
export function toOverride(row: z.infer<typeof catalogueOverrideRow>): CatalogueOverride {
  return {
    kind: row.kind,
    entryId: row.entry_id,
    enabled: row.enabled,
    name: row.name,
    summary: row.summary,
    priority: row.priority,
    milestoneLabels: row.milestone_labels,
    checkinAgendas: row.checkin_agendas,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Measured token usage on a message row.
 *
 * Nullable: every message written before cost tracking existed has none, and a zero there would
 * read as a turn that cost nothing rather than one nobody measured. Parsed rather than cast
 * because it is jsonb, and a half-written shape would otherwise reach the arithmetic.
 */
const modelUsageRow = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
})

export const timingRow = z.object({
  gateMs: z.number(),
  firstTextMs: z.number().nullable(),
  totalMs: z.number(),
  rounds: z.number().int(),
  coldPrefix: z.boolean(),
})

export const usageRow = z.object({
  model: modelUsageRow,
  gate: modelUsageRow,
  // Tolerant on purpose: a timing that does not parse must not take the cost numbers with it.
  timing: timingRow.optional().catch(undefined),
})

/** Null, absent, or malformed all mean the same thing here: nobody measured this turn. */
export function toUsage(value: unknown): TurnUsage | null {
  const parsed = usageRow.safeParse(value)
  if (!parsed.success) return null
  const { timing, ...usage } = parsed.data
  return timing === undefined ? usage : { ...usage, timing }
}
