import { z } from 'zod'

/**
 * The AI usage record (design `2026-11-14-saoi-ai-usage-analytics-design`): one `mcp_calls` row
 * per call an AI makes to the Saoi MCP server, posted by saoi-mcp to `POST /api/telemetry/mcp`
 * with the internal key after it has answered.
 *
 * What was asked is free text verbatim (the product search words, a product id, an about topic)
 * and figures only as bands. No name, no address, no account: `sessionKey` is a salted hash
 * saoi-mcp makes of address, user agent and UTC day.
 *
 * Self-contained: it imports nothing but zod, so saoi-mcp and the console can copy it alone.
 */

export const MCP_CALL_KINDS = ['tool', 'prompt', 'resource'] as const
/** Which assistant called. The map from user agent and clientInfo lives in saoi-mcp and grows. */
export const MCP_HOSTS = ['claude', 'chatgpt', 'gemini', 'cursor', 'other'] as const
/** `gated`: the home calculator's gate held the card back for missing figures. */
export const MCP_CALL_OUTCOMES = ['ok', 'error', 'gated'] as const

export type McpCallKind = (typeof MCP_CALL_KINDS)[number]
export type McpHost = (typeof MCP_HOSTS)[number]
export type McpCallOutcome = (typeof MCP_CALL_OUTCOMES)[number]

/** The raw user agent is kept for the hosts the map does not know yet, cut to this length. */
export const USER_AGENT_MAX = 200
const MAX_ASKED_KEYS = 30

const cut = (max: number) =>
  z
    .string()
    .transform((value) => value.slice(0, max))
    .nullable()
    .default(null)

/** One value of `asked`: a band, a word, a choice, or a short list of them. */
const askedValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(100)).max(20),
])

export const mcpAskedSchema = z
  .record(z.string().min(1).max(60), askedValueSchema)
  .refine((asked) => Object.keys(asked).length <= MAX_ASKED_KEYS, {
    message: `asked holds at most ${String(MAX_ASKED_KEYS)} keys`,
  })
export type McpAsked = z.infer<typeof mcpAskedSchema>

export const mcpCallBodySchema = z.object({
  kind: z.enum(MCP_CALL_KINDS),
  /** The tool, prompt or resource (a resource by its URI). */
  name: z.string().min(1).max(200),
  host: z.enum(MCP_HOSTS),
  userAgent: cut(USER_AGENT_MAX),
  clientName: cut(100),
  clientVersion: cut(50),
  sessionKey: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'expected a sha256 hex digest')
    .nullable()
    .default(null),
  outcome: z.enum(MCP_CALL_OUTCOMES),
  ms: z
    .number()
    .int()
    .nonnegative()
    .transform((ms) => Math.min(ms, 600_000)),
  /** A UI card went back with the result (and the gate did not hold it). */
  card: z.boolean().default(false),
  /** The core figures the home calculator's gate is waiting for, when it held the card back. */
  gateMissing: z.array(z.string().min(1).max(60)).max(10).default([]),
  asked: mcpAskedSchema.default({}),
  /** The saved plan behind the result's save link, so the funnel joins to the claim. */
  savedPlanId: z.uuid().nullable().default(null),
})
export type McpCallBody = z.input<typeof mcpCallBodySchema>
export type McpCall = z.output<typeof mcpCallBodySchema>
