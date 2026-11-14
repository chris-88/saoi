import { knowledgeProductSchema, mortgageRateSchema } from './catalogue.ts'
import { z } from 'zod'
import { CASE_KINDS, CASE_OUTCOMES, CASE_STATUSES } from '../domain/case.ts'
import { MCP_CALL_KINDS, MCP_CALL_OUTCOMES, MCP_HOSTS, mcpAskedSchema } from './telemetry.ts'

/** Milliseconds from the request arriving: the gate, the first words, the whole turn. */
export const turnTimingSchema = z.object({
  gateMs: z.number(),
  firstTextMs: z.number().nullable(),
  totalMs: z.number(),
  rounds: z.number().int(),
  coldPrefix: z.boolean(),
})
export type TurnTimingDto = z.infer<typeof turnTimingSchema>

/** The windows the console can look at. */
export const PERIODS = ['7d', '30d', '90d', 'all'] as const
export type Period = (typeof PERIODS)[number]

/** How many days each window covers. `all` has no start, so it has nothing to compare against. */
export const PERIOD_DAYS: Readonly<Record<Period, number | null>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
}
import { PRESET_NAMES, SLIDER_NAMES } from '../llm/persona.ts'
import { NEED_PRIORITIES } from '../domain/needs/types.ts'

/**
 * `admin` — the presenter console (§37 to §44).
 *
 * Every action here can break a live demonstration, and the site is on a public URL, so the
 * server checks the caller is a known admin on every single call. Client-side routing is a
 * convenience, never the control.
 */

const sliders = z.object(
  Object.fromEntries(SLIDER_NAMES.map((name) => [name, z.number().min(0).max(1)])) as Record<
    (typeof SLIDER_NAMES)[number],
    z.ZodNumber
  >,
)

export const adminRequestSchema = z.discriminatedUnion('action', [
  /**
   * `caseId` is the conversation the presenter is driving. Omitted, the console focuses the
   * most recently active one, which is almost always the one on screen.
   */
  /**
   * §5, §9 — the console's headline numbers, over a window.
   *
   * `all` is the default because a prototype with a day of traffic in it should not open on an
   * empty chart. Every window is compared against the one immediately before it, which is what
   * makes a delta mean anything.
   */
  z.object({
    action: z.literal('overview'),
    period: z.enum(PERIODS).default('all'),
    /** Which case the console is pointed at, for the hand-moves and the inspector. */
    caseId: z.uuid().optional(),
  }),
  /** §43 — restores the canonical presenter case. Audience cases are untouched. */
  z.object({ action: z.literal('reset_case'), caseId: z.uuid().optional() }),
  /** §43 — the gate returns "demo paused" to everything. */
  z.object({ action: z.literal('set_kill_switch'), enabled: z.boolean() }),
  /** §38, §56 — style changes apply to the very next turn. */
  z.object({
    action: z.literal('set_persona'),
    preset: z.enum(PRESET_NAMES).optional(),
    sliders: sliders.optional(),
  }),
  /** §40 — the structured context behind the conversation. */
  z.object({ action: z.literal('inspect_case'), caseId: z.uuid() }),

  /**
   * §41 — the downstream events the bank would raise. Each one is a state-machine transition,
   * never a random timer, so an illegal move is refused rather than faked. The one exception is
   * `documents_verified`: the bank checks what was sent in and the application stays where it
   * is, so it is legal whenever the application is with the bank rather than when the machine
   * says so.
   */
  z.object({
    action: z.literal('simulate_event'),
    applicationId: z.uuid(),
    event: z.enum([
      'received_by_bank',
      'information_requested',
      'information_supplied',
      'documents_verified',
      'assessment_approved',
      'assessment_declined',
      'completed',
    ]),
    /**
     * What the team is asking for, in the words the customer will read. Only
     * `information_requested` uses it; the handler supplies "one more payslip" when it is left
     * out, so the console's one-click button keeps working.
     */
    detail: z.string().trim().min(1).max(120).optional(),
  }),

  /**
   * §35, §42 — a separate, deliberate action. Carries nothing about the application, and the
   * link requires signing in before anything is shown.
   */
  z.object({
    action: z.literal('send_notification'),
    caseId: z.uuid(),
    /**
     * The presenter's own words, where the fixed copy is not the point being made.
     *
     * Capped at a length a lock screen will actually show — iOS truncates somewhere around
     * 150 characters with the screen locked, and a notification whose point is in the part
     * that got cut is worse than a short one.
     */
    title: z.string().trim().min(1).max(40).optional(),
    body: z.string().trim().min(1).max(150).optional(),
  }),

  /** §44 — clears the room's conversations. Never touches the presenter case. */
  /** §47 — delete every conversation. No exceptions; the sample customer is one click to rebuild. */
  z.object({ action: z.literal('purge_cases') }),
  /**
   * One case, by id.
   *
   * Separate from `purge_cases` because the reasons are different. A purge clears the decks
   * between run-throughs; this removes a single conversation, which is what you need when
   * somebody has typed a real name and date of birth into a prototype.
   */
  z.object({ action: z.literal('delete_case'), caseId: z.uuid() }),

  /**
   * Mark a case as created by an automated probe.
   *
   * The capacity cap counts customer cases from the last 24 hours. Diagnosing one bug took
   * about twenty-five live replays, each its own anonymous session, and they used the day's
   * allowance up — real visitors met "the demonstration is at capacity" because of test runs.
   *
   * Admin-only, and deliberately not something a client can ask for when its session starts: a
   * kind that exempts a case from the rate limit is the last thing a rate limit should let
   * anyone choose for themselves.
   */
  z.object({ action: z.literal('tag_test_case'), caseId: z.uuid() }),
  /** Open banking, simulated: the receiving bank settles an initiated transfer. */
  z.object({ action: z.literal('settle_transfer'), transferId: z.uuid() }),
  /** §44 — what people said, and who asked to work on this. */
  z.object({ action: z.literal('list_feedback'), period: z.enum(PERIODS).default('30d') }),
  z.object({ action: z.literal('list_collaborators') }),

  /**
   * Everything about one form application, side by side.
   *
   * The definition that was collected, the answers that have been given, and the exact packet
   * those answers produce. Works on an unfinished application on purpose: the mapping is far
   * more convincing watched filling up than presented complete.
   */
  z.object({ action: z.literal('inspect_form_application'), formApplicationId: z.uuid() }),

  /** Every form application on the system, for the console's list. */
  z.object({ action: z.literal('list_form_applications') }),

  /**
   * Rebuild every case's form applications from the facts it holds.
   *
   * Two jobs. A case that was in conversation before the mapping existed has answers in
   * `facts` and no form row, and a change to the mapping table should be visible without
   * waiting for each customer to say something else. Idempotent, so it is safe to press.
   */
  z.object({ action: z.literal('rebuild_form_applications') }),

  /**
   * §39 — put a request through the gate and report what happened to it.
   *
   * The same classifier and the same deterministic checks a customer's message meets, with no
   * case attached and nothing recorded. The point of the screen is that enforcement is a thing
   * you can watch work, not a paragraph claiming it does.
   */
  z.object({ action: z.literal('test_guardrail'), message: z.string().min(1).max(2000) }),

  /**
   * §56 — hear a persona before committing to it.
   *
   * Runs against the sliders on screen rather than the saved ones, so the preview is of the
   * change being considered. Nothing is saved and no case is touched.
   */
  z.object({
    action: z.literal('preview_persona'),
    sliders: sliders,
    message: z.string().min(1).max(500),
  }),

  /**
   * Plan §3.2 — reword a catalogue entry, or switch it off.
   *
   * Prose only. The conditions that raise a goal are predicates over facts and are not in this
   * schema at any depth, which is the guarantee: a malformed edit can make Saoirse read badly and
   * cannot make it behave wrongly. `enabled` is the single exception and it is a boolean.
   *
   * Every prose field is nullable, and null means "use the compiled wording" rather than "blank".
   */
  z.object({
    action: z.literal('set_catalogue_override'),
    kind: z.enum(['goal', 'need']),
    entryId: z.string().min(1).max(120),
    enabled: z.boolean(),
    name: z.string().trim().min(1).max(120).nullable(),
    summary: z.string().trim().min(1).max(400).nullable(),
    priority: z.enum(NEED_PRIORITIES).nullable(),
    milestoneLabels: z.record(z.string(), z.string().trim().min(1).max(120)),
    checkinAgendas: z.record(z.string(), z.array(z.string().trim().min(1).max(200)).max(8)),
  }),

  /**
   * §9 — everything the analytics screen draws, in one round trip.
   *
   * One action rather than seven, because every panel is a view of the same window and seven
   * requests would let the funnel and the series disagree about which days they covered.
   */
  z.object({
    action: z.literal('analytics'),
    period: z.enum(PERIODS).default('30d'),
  }),

  /** Plan §3.2 — what is currently overridden. */
  z.object({ action: z.literal('catalogue_overrides') }),

  /**
   * §51 — the product catalogue and the mortgage rate table, as rows.
   *
   * Each payload is validated against the compiled file's own shape before it is written, so
   * what Saoirse speaks from cannot be malformed, only different. An id that is not in the
   * published set is a product or rate the presenter added; "restore" on one of those deletes
   * it, because there is nothing to restore it to.
   */
  z.object({ action: z.literal('list_products') }),
  z.object({
    action: z.literal('set_product'),
    id: z.string().trim().min(3).max(80),
    product: knowledgeProductSchema,
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal('delete_product'), id: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('load_published_products') }),
  z.object({
    action: z.literal('restore_published_product'),
    id: z.string().trim().min(1).max(80),
  }),

  z.object({ action: z.literal('list_rates') }),
  z.object({
    action: z.literal('set_rate'),
    id: z.string().trim().min(1).max(80),
    rate: mortgageRateSchema,
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal('delete_rate'), id: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('load_published_rates') }),
  z.object({ action: z.literal('restore_published_rate'), id: z.string().trim().min(1).max(80) }),

  /** Plan §3.2 — drop the row and go back to what is compiled in. */
  z.object({
    action: z.literal('clear_catalogue_override'),
    kind: z.enum(['goal', 'need']),
    entryId: z.string().min(1).max(120),
  }),

  /** §41 — the bank checks what was sent in, so a document needing verification can pass. */
  z.object({ action: z.literal('verify_documents'), caseId: z.uuid() }),

  /** §41 — time passes and the customer reaches what they were saving for. */
  z.object({ action: z.literal('reach_savings_target'), caseId: z.uuid() }),

  /**
   * §38 — the single most useful lever in the console: move the balance and watch the plan
   * react. Milestones, progress, projections and any waiting check-in all recompute from it,
   * so one number demonstrates the whole machine.
   */
  z.object({
    action: z.literal('set_savings_balance'),
    caseId: z.uuid(),
    amount: z.number().int().nonnegative().max(10_000_000),
  }),

  /** §38 — drive a plan directly: pause it, pick it up, finish it, or bring a check-in due. */
  z.object({
    action: z.literal('plan_move'),
    caseId: z.uuid(),
    planId: z.uuid(),
    move: z.enum(['pause', 'resume', 'complete', 'abandon', 'trigger_checkin']),
  }),

  /**
   * One-click demo moves (§41).
   *
   * Named for what the presenter wants to happen — "credit card approved" — rather than for
   * the transition underneath. The server finds the right application and applies the right
   * sequence, so nobody is hunting through a list mid-presentation.
   */
  z.object({
    action: z.literal('demo_action'),
    caseId: z.uuid(),
    move: z.enum([
      'credit_card_approved',
      'joint_account_approved',
      'mortgage_to_assessment',
      'mortgage_requests_document',
      'protection_approved',
    ]),
  }),
])

export const demoActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** False when the state machine would refuse it right now, with the reason. */
  available: z.boolean(),
  note: z.string(),
})

/**
 * One catalogue override as the console reads it.
 *
 * Carries the lifecycle metadata the spec asks for — version, created, updated — which a
 * constant in a TypeScript file cannot have and a row can.
 */
export const catalogueOverrideSchema = z.object({
  kind: z.enum(['goal', 'need']),
  entryId: z.string(),
  enabled: z.boolean(),
  name: z.string().nullable(),
  summary: z.string().nullable(),
  priority: z.enum(NEED_PRIORITIES).nullable(),
  milestoneLabels: z.record(z.string(), z.string()),
  checkinAgendas: z.record(z.string(), z.array(z.string())),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type CatalogueOverrideDto = z.infer<typeof catalogueOverrideSchema>

/** Every override there is. Small enough to send whole; there are at most 35 possible rows. */
export const catalogueOverridesSchema = z.object({
  overrides: z.array(catalogueOverrideSchema),
})

export type CatalogueOverrides = z.infer<typeof catalogueOverridesSchema>

/** One day, one event type, one count. Gaps are filled with zero by `metrics_by_day`. */
export const dailyCountSchema = z.object({
  day: z.string(),
  type: z.string(),
  count: z.number().int(),
})

/**
 * §9 — the analytics screen, as data.
 *
 * Every field here is counted from events or application states. Nothing is modelled, estimated
 * or filled in: the spec is explicit that a dashboard should not be populated with numbers that
 * have nothing behind them, which is also why channel mix and new-versus-returning are absent
 * (decision 3) — there is no channel field and no identity across sessions.
 */
export const analyticsSchema = z.object({
  period: z.enum(PERIODS),
  /** Inclusive start, exclusive end, so a caller can say exactly what was counted. */
  from: z.string(),
  to: z.string(),

  /** The headline numbers, each with the same window immediately before it for comparison. */
  totals: z.object({
    conversations: z.number().int(),
    applications: z.number().int(),
    goals: z.number().int(),
    blocked: z.number().int(),
  }),
  /** Null when the period is `all`: there is no earlier window to compare against. */
  previous: z
    .object({
      conversations: z.number().int(),
      applications: z.number().int(),
      goals: z.number().int(),
      blocked: z.number().int(),
    })
    .nullable(),

  /** A row per day per type, for the sparklines and the volume chart. */
  series: z.array(dailyCountSchema),

  /** Where applications got to. Each stage counts applications that reached it or passed it. */
  funnel: z.array(z.object({ stage: z.string(), label: z.string(), count: z.number().int() })),
  /**
   * The journey after a show and tell: how far arrivals got, step by step, with the drop
   * between steps implied by the counts. Each step is a count of cases in the period.
   */
  journey: z
    .array(z.object({ step: z.string(), label: z.string(), count: z.number().int() }))
    .default([]),
  /** Where arrivals came from, from `cases.source`; `unknown` for the rest. */
  sources: z.array(z.object({ source: z.string(), count: z.number().int() })).default([]),
  /** Where conversations stalled: the detector events, counted. */
  stalls: z
    .array(z.object({ type: z.string(), label: z.string(), count: z.number().int() }))
    .default([]),
  feedback: z
    .object({
      thumbsUp: z.number().int(),
      thumbsDown: z.number().int(),
      ratings: z.number().int(),
      averageRating: z.number().nullable(),
    })
    .default({ thumbsUp: 0, thumbsDown: 0, ratings: 0, averageRating: null }),

  /** What was discovered, most often first. Needs the `goal_identified` event. */
  topGoals: z.array(z.object({ goal: z.string(), name: z.string(), count: z.number().int() })),

  /** Which rule turned something away, and how often. */
  guardrails: z.array(z.object({ category: z.string(), count: z.number().int() })),

  /** How far conversations got. Cases nobody spoke in are excluded, not counted as browsing. */
  outcomes: z.array(
    z.object({
      outcome: z.enum(CASE_OUTCOMES),
      label: z.string(),
      note: z.string(),
      count: z.number().int(),
    }),
  ),
})

export type Analytics = z.infer<typeof analyticsSchema>

/**
 * The AI usage screen (design `2026-11-14-saoi-ai-usage-analytics-design`): calls to the Saoi MCP
 * server by assistant, and the link funnel from a call to a product chosen in the app. Counted
 * from `mcp_calls`, the saved plans their results carried and the events on the cases those
 * plans opened into; probe cases (kind `test`) are left out.
 */
export const AI_USAGE_STEPS = [
  { step: 'calls', label: 'Calls' },
  { step: 'cardsShown', label: 'Cards shown' },
  { step: 'plansSaved', label: 'Plans saved' },
  { step: 'linksOpened', label: 'Links opened' },
  { step: 'claimed', label: 'Claimed' },
  { step: 'signedIn', label: 'Signed in' },
  { step: 'chosen', label: 'Product chosen' },
] as const
export type AiUsageStep = (typeof AI_USAGE_STEPS)[number]['step']
const AI_USAGE_STEP_IDS = AI_USAGE_STEPS.map((entry) => entry.step) as [
  AiUsageStep,
  ...AiUsageStep[],
]

/** The recent-calls feed is paged this many at a time. */
export const AI_USAGE_PAGE = 50

const aiUsageCountsSchema = z.object({
  calls: z.number().int(),
  /** Distinct `session_key`s: a conversation, loosely (address, user agent and day). */
  sessions: z.number().int(),
  cardsShown: z.number().int(),
  plansSaved: z.number().int(),
  linksOpened: z.number().int(),
  claimed: z.number().int(),
  signedIn: z.number().int(),
  chosen: z.number().int(),
})
export type AiUsageCounts = z.infer<typeof aiUsageCountsSchema>

export const aiUsageCallSchema = z.object({
  id: z.string(),
  calledAt: z.string(),
  host: z.enum(MCP_HOSTS),
  name: z.string(),
  kind: z.enum(MCP_CALL_KINDS),
  outcome: z.enum(MCP_CALL_OUTCOMES),
  ms: z.number().int(),
  card: z.boolean(),
  asked: mcpAskedSchema,
  gateMissing: z.array(z.string()),
})
export type AiUsageCall = z.infer<typeof aiUsageCallSchema>

export const aiUsageSchema = z.object({
  period: z.enum(PERIODS),
  /** Inclusive start, exclusive end. */
  from: z.string(),
  to: z.string(),
  totals: aiUsageCountsSchema,
  /** The same window immediately before. Null when the period is `all`. */
  previous: aiUsageCountsSchema.nullable(),
  /** Per assistant, the steps in order: each counts calls in the window that got that far. */
  funnel: z.array(
    z.object({
      host: z.enum(MCP_HOSTS),
      steps: z.array(
        z.object({ step: z.enum(AI_USAGE_STEP_IDS), label: z.string(), count: z.number().int() }),
      ),
    }),
  ),
  /** Calls a day (UTC) per assistant, every day of the window for each assistant that called. */
  series: z.array(z.object({ day: z.string(), host: z.enum(MCP_HOSTS), calls: z.number().int() })),
  /** Per tool, prompt or resource, most called first. */
  tools: z.array(
    z.object({
      name: z.string(),
      calls: z.number().int(),
      errors: z.number().int(),
      gated: z.number().int(),
      medianMs: z.number().nullable(),
    }),
  ),
  /** The figures the home calculator's gate was waiting for when it held the card back. */
  gateMissing: z.array(z.object({ figure: z.string(), count: z.number().int() })),
  /** Raw user agents behind `other`, so the host map can be extended. */
  userAgents: z.array(z.object({ userAgent: z.string(), count: z.number().int() })),
  /** Newest first, a page at a time; `nextCursor` asks for the page after it. */
  recent: z.array(aiUsageCallSchema),
  nextCursor: z.string().nullable(),
})
export type AiUsage = z.infer<typeof aiUsageSchema>

/**
 * What a conversation cost to run (console §4).
 *
 * `tokens` is measured — every Anthropic response reports exactly what it consumed. `euro` is
 * that multiplied by the prices in `domain/cost.ts`, which are the only estimated part.
 * `measuredTurns` against `turns` says how much of it was counted rather than averaged.
 */
export const costSchema = z.object({
  tokens: z.number().int().nonnegative(),
  euro: z.number().nonnegative(),
  turns: z.number().int().nonnegative(),
  measuredTurns: z.number().int().nonnegative(),
})

export type Cost = z.infer<typeof costSchema>

export const adminOverviewSchema = z.object({
  killSwitch: z.boolean(),
  /** The one-click moves, with whether each is possible from where the case currently is. */
  demoActions: z.array(demoActionSchema).default([]),
  /** The case the controls below act on. */
  focusCaseId: z.uuid().nullable().default(null),
  persona: z.object({ preset: z.string(), sliders: sliders }),
  cases: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(CASE_KINDS),
      /** For display: the customer's name, or "Unnamed · 1a2b3c4d" when there is none. */
      label: z.string().nullable(),
      applications: z.number().int(),
      messages: z.number().int(),
      updatedAt: z.string(),
      /** §5 — what this case needs from whoever is watching. Derived, never stored. */
      status: z.enum(CASE_STATUSES).default('new'),
      /** The last thing said, trimmed to a line, for the list. */
      latest: z.string().default(''),
    }),
  ),
  /**
   * §38 — what has just happened, across every case, in plain words.
   *
   * The console follows a conversation live, so this is where the plan machinery becomes
   * visible as it runs rather than something a presenter has to drill in and infer.
   */
  activity: z
    .array(
      z.object({
        at: z.string(),
        actor: z.string(),
        describe: z.string(),
        signal: z.boolean(),
        caseLabel: z.string(),
      }),
    )
    .default([]),
  metrics: z.object({
    /** §53 — the headline measure. */
    questionsAvoided: z.number().int(),
    factsCaptured: z.number().int(),
    productsOffered: z.number().int(),
    applicationsStarted: z.number().int(),
    requestsBlocked: z.number().int(),
  }),
  /** Across every conversation in the window. */
  cost: costSchema,
  /**
   * The same counts for the window before this one, and the window asked for.
   *
   * Null when the period is `all`: there is no earlier window, and showing a delta of zero would
   * claim nothing changed rather than that nothing was compared.
   */
  period: z.enum(PERIODS).default('all'),
  previous: z
    .object({
      questionsAvoided: z.number().int(),
      factsCaptured: z.number().int(),
      productsOffered: z.number().int(),
      applicationsStarted: z.number().int(),
      requestsBlocked: z.number().int(),
    })
    .nullable()
    .default(null),
  /** §39 — enforcement made observable. */
  blocked: z.array(
    z.object({
      category: z.string(),
      at: z.string(),
      /** What was asked, capped. Empty for anything blocked before this was recorded. */
      request: z.string().default(''),
    }),
  ),
})

export const notificationSchema = z.object({
  /** What was sent. The default says nothing about what changed (§35). */
  message: z.string(),
  url: z.string(),
  /**
   * How many devices this case has registered, and how many the push service took.
   *
   * Reported so the console can say what happened rather than "sent". Nobody subscribed means
   * nothing was delivered, and a presenter should learn that here rather than by watching a
   * phone stay dark.
   */
  subscriptions: z.number().int(),
  delivered: z.number().int(),
})

/** §44 — one piece of feedback, with enough of its context to read it in the console. */
export const feedbackItemSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  kind: z.enum(['turn', 'session']),
  rating: z.number().int(),
  comment: z.string().nullable(),
  replyTo: z.string().nullable(),
  /** The reply the thumbs was on, trimmed, when it was a turn. */
  about: z.string().nullable(),
  createdAt: z.string(),
})
export const feedbackListSchema = z.object({ items: z.array(feedbackItemSchema) })
export type FeedbackItem = z.infer<typeof feedbackItemSchema>

export const adminCaseSchema = z.object({
  caseId: z.uuid(),
  /**
   * §5 — the identity panel: who this is and how long they have been here.
   *
   * There is no channel field because there is one surface, and no account because there is no
   * sign-in. `daysActive` is how "returning" is answered honestly without an identity to track.
   */
  customer: z.object({
    name: z.string().nullable(),
    authLevel: z.enum(['anonymous', 'authenticated']),
    firstSeen: z.string().nullable(),
    lastSeen: z.string().nullable(),
    daysActive: z.number().int(),
    messages: z.number().int(),
    /**
     * Time in the conversation, with time the customer was away taken out.
     *
     * The figure that sits beside the application count: four products in one sitting is only
     * a claim until there is a number on how long the sitting was.
     */
    timing: z.object({
      activeMinutes: z.number().int(),
      elapsedMinutes: z.number().int(),
      sittings: z.number().int(),
    }),
  }),
  /**
   * What the customer actually sent in.
   *
   * An upload is not a message, so it left no trace in the transcript — and a conversation
   * where somebody photographed three payslips reads as a quiet one if you only count what was
   * typed.
   */
  /**
   * What reaching this customer has cost, as against what it is costing to talk to them.
   *
   * Zero, and that is the number worth showing: these are Web Push, sent from an Edge Function
   * to the browser's own push service, so there is no per-message charge and nothing to
   * register. An SMS would be billed each time.
   */
  notifications: z.object({
    sent: z.number().int(),
    delivered: z.number().int(),
    euro: z.number(),
  }),
  documents: z.array(
    z.object({
      type: z.string(),
      verified: z.boolean(),
      uploadedAt: z.string(),
    }),
  ),
  cost: costSchema,
  facts: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
      source: z.string(),
      verified: z.boolean(),
      superseded: z.boolean(),
      sensitive: z.boolean(),
    }),
  ),
  applications: z.array(
    z.object({
      id: z.uuid(),
      product: z.string(),
      displayName: z.string(),
      state: z.string(),
      stateLabel: z.string(),
      outstanding: z.array(z.string()),
      /**
       * Which §41 moves the console may offer now: the events the state machine will accept,
       * plus the document check while something sent in is still unchecked.
       */
      canSimulate: z.array(z.string()),
    }),
  ),
  events: z.array(
    z.object({
      type: z.string(),
      actor: z.string(),
      at: z.string(),
      /** Plain words for the presenter. Built server-side so one describer serves everyone. */
      describe: z.string(),
      /** True for the things worth watching happen: plans, milestones, check-ins, notices. */
      signal: z.boolean(),
      /** What it was about — an application, a plan, a product. Empty when it was the case. */
      object: z.string().default(''),
    }),
  ),
  /** §27 — needs the customer parked, and what would bring each one back. */
  parked: z.array(
    z.object({
      needId: z.string(),
      name: z.string(),
      reason: z.string(),
      revisitWhen: z.string().nullable(),
      ready: z.boolean(),
    }),
  ),
  /**
   * Open banking, simulated: what Nexus is sharing under a consent that stands, and the
   * transfers out of it. The IBAN is masked here as it is everywhere a screen shows one.
   */
  linkedAccounts: z.array(
    z.object({
      bank: z.string(),
      displayName: z.string(),
      accountType: z.enum(['current', 'savings']),
      ibanMasked: z.string(),
      balance: z.number(),
      consentExpiresAt: z.string(),
    }),
  ),
  transfers: z.array(
    z.object({
      id: z.uuid(),
      fromLabel: z.string(),
      toLabel: z.string(),
      amount: z.number(),
      cadence: z.enum(['once', 'monthly']),
      state: z.enum(['initiated', 'settled', 'failed']),
      createdAt: z.string(),
    }),
  ),
  /** §44: what this customer said about it, newest first. */
  feedback: z.array(feedbackItemSchema),
  /**
   * What the needs engine makes of this case, and what the bank has committed to watching
   * for. The presenter can answer "why did Saoirse offer that" without reading the prompt.
   */
  needs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      state: z.string(),
      confidence: z.number(),
      evidence: z.array(z.string()),
      reason: z.string().nullable(),
    }),
  ),
  /**
   * What the Goal Engine makes of this case: every goal in the catalogue, where it stands, and
   * the evidence behind it.
   *
   * All of them, including the ones nothing points at. "Why was this never mentioned to me" is
   * as fair a question as "why was this suggested", and a console that can only answer the
   * second is a console that cannot show the engine is making decisions rather than guesses.
   */
  goals: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      tier: z.string(),
      confidence: z.number(),
      evidence: z.array(z.string()),
      /** Life events that contributed, so "because you mentioned a baby" is answerable. */
      clusters: z.array(z.string()),
      reason: z.string().nullable(),
      revisitWhen: z.string().nullable(),
      /** Fact labels the goal still needs before it could be planned properly. */
      missing: z.array(z.string()),
    }),
  ),
  /** §11 — the life events the case evidences, with the caution each one carries. */
  lifeEvents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      because: z.string(),
      note: z.string().nullable(),
    }),
  ),
  /** §10 — two goals laying claim to the same money. Raised, never resolved. */
  contentions: z.array(
    z.object({
      resource: z.string(),
      describe: z.string(),
      needed: z.number(),
      available: z.number(),
    }),
  ),
  /**
   * The note a person reads before picking up the phone.
   *
   * Composed on the server from the case, never written by the model: a brief somebody is about
   * to act on is the last place to put invented prose.
   */
  handoff: z.object({
    who: z.string(),
    turns: z.number().int(),
    lastSeen: z.string().nullable(),
    sections: z.array(
      z.object({
        heading: z.string(),
        lines: z.array(z.string()),
        caution: z.boolean().default(false),
      }),
    ),
    /** The same note as plain text, for pasting wherever the adviser actually works. */
    text: z.string(),
  }),
  /** §41 — the hand-moves available on this case, checked against the state machine. */
  demoActions: z.array(demoActionSchema).default([]),
  /** The conversation, oldest first, so a person can read what was actually said. */
  conversation: z.array(
    z.object({
      role: z.enum(['customer', 'assistant', 'system']),
      content: z.string(),
      cards: z.array(z.string()),
      at: z.string(),
      /** Where the turn's time went, on Saoirse's turns that were measured. */
      timing: turnTimingSchema.nullable(),
    }),
  ),
  planSteps: z.array(z.string()),
  /** §38 — every plan on the case, as the engine currently computes it. */
  plans: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      status: z.string(),
      targetAmount: z.number().nullable(),
      currentAmount: z.number().nullable(),
      projectedDate: z.string().nullable(),
      monthsRemaining: z.number().int().nullable(),
      onTrack: z.boolean().nullable(),
      milestones: z.array(
        z.object({
          id: z.uuid(),
          label: z.string(),
          state: z.string(),
          achievedAt: z.string().nullable(),
        }),
      ),
      checkins: z.array(
        z.object({
          id: z.uuid(),
          purpose: z.string(),
          state: z.string(),
          when: z.string(),
          agenda: z.array(z.string()),
        }),
      ),
    }),
  ),
  watches: z.array(z.object({ describe: z.string(), met: z.boolean(), createdAt: z.string() })),
})

/** What the gate did with a test request. */
export const guardrailTestSchema = z.object({
  category: z.string(),
  reachesModel: z.boolean(),
  /** The exact words a customer would get back. Null when the request is allowed through. */
  response: z.string().nullable(),
  /** Why it was turned away, where the reason is more specific than the category. */
  reason: z.string().nullable(),
  injectionFlagged: z.boolean(),
  profanity: z.boolean(),
  sensitive: z.boolean(),
})

export type GuardrailTest = z.infer<typeof guardrailTestSchema>

export const personaPreviewSchema = z.object({ reply: z.string() })
export type PersonaPreview = z.infer<typeof personaPreviewSchema>

/**
 * What a purge took. Both numbers are reported back because the console button claims to clear
 * sign-ins as well as conversations, and a presenter resetting between run-throughs needs to
 * see that the second half happened: the symptom of it not happening is a returning browser
 * being recognised, which looks like success until somebody tries to sign up again.
 */
export const purgeResultSchema = z.object({
  purged: z.number().int().nonnegative(),
  usersRemoved: z.number().int().nonnegative(),
})
export type PurgeResult = z.infer<typeof purgeResultSchema>

export type AdminRequest = z.infer<typeof adminRequestSchema>
export type AdminOverview = z.infer<typeof adminOverviewSchema>
export type AdminCase = z.infer<typeof adminCaseSchema>

/** What a catalogue write comes back with: the row's new version, or how many rows were loaded. */
export const catalogueWriteSchema = z.object({ version: z.number().int().nonnegative() })
export const catalogueLoadSchema = z.object({ inserted: z.number().int().nonnegative() })
export type CatalogueWrite = z.infer<typeof catalogueWriteSchema>
export type CatalogueLoad = z.infer<typeof catalogueLoadSchema>

export const collaboratorSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['collaborate', 'question']),
  name: z.string(),
  email: z.string(),
  organisation: z.string().nullable(),
  role: z.string().nullable(),
  interest: z.string(),
  source: z.string().nullable(),
  createdAt: z.string(),
})
export const collaboratorListSchema = z.object({ items: z.array(collaboratorSchema) })
export type Collaborator = z.infer<typeof collaboratorSchema>
