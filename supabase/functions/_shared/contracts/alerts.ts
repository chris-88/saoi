import { z } from 'zod'

/**
 * Plan alerts and dated reminders (design `2026-11-11-saoi-plan-alerts-design`): the reason to
 * be in the app after a comparison. Each alert is a fact with its date and its source, never a
 * nudge: no product is picked and nothing tells the customer what to do.
 *
 * Self-contained: it imports nothing but zod, so the apps can copy it alone.
 */

export const ALERT_KINDS = ['rate_change', 'product_withdrawn', 'reminder'] as const
export const REMINDER_KINDS = ['fixed_rate_ends', 'deposit_matures', 'other'] as const
/** Days before the date a reminder is sent at, and the day itself. */
export const REMINDER_STAGES = [90, 60, 30, 7, 0] as const

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const isoDateTime = z.iso.datetime({ offset: true })

export const planAlertSchema = z
  .object({
    id: z.uuid().describe('The alert.'),
    kind: z
      .enum(ALERT_KINDS)
      .describe(
        '`rate_change`: a product in the claimed plan changed rate. `product_withdrawn`: it is no longer listed. `reminder`: a date the customer gave is coming up.',
      ),
    productId: z
      .string()
      .nullable()
      .describe(
        'The market product id the alert is about (`savings.supersaver`). Null for a reminder.',
      ),
    reminderId: z
      .uuid()
      .nullable()
      .describe('The reminder it came from. Null for a product alert.'),
    stage: z
      .number()
      .int()
      .nullable()
      .describe(
        'For a reminder: the stage it was sent at, in days before the date (0 is the day).',
      ),
    title: z.string().describe('One line, a fact: "A rate in your plan changed".'),
    body: z
      .string()
      .describe('The fact with its date and source, and what the plan counted. No advice.'),
    data: z
      .record(z.string(), z.unknown())
      .describe('The figures behind the body (rates, dates, source), for a card to lay out.'),
    createdAt: isoDateTime.describe('When the alert was raised.'),
    sentAt: isoDateTime.nullable().describe('When a push for it was delivered. Null: none was.'),
    seenAt: isoDateTime
      .nullable()
      .describe('When the customer first saw it, in the app or from Saoirse. Null: not yet.'),
  })
  .describe('One alert on a case: a fact about a claimed plan or a date given, never a nudge.')
export type PlanAlert = z.infer<typeof planAlertSchema>

export const reminderSchema = z
  .object({
    id: z.uuid().describe('The reminder.'),
    kind: z
      .enum(REMINDER_KINDS)
      .describe('What the date is: a fixed rate ending, a deposit maturing, or something else.'),
    label: z.string().describe('In the customer’s words: "AIB fixed rate".'),
    dueOn: day.describe('The date, YYYY-MM-DD.'),
    productId: z
      .string()
      .nullable()
      .describe('A market product id the date belongs to, when one was named.'),
    createdAt: isoDateTime.describe('When it was set.'),
  })
  .describe(
    'A date the customer gave. Alerts go out 90, 60, 30 and 7 days before it and on the day.',
  )
export type Reminder = z.infer<typeof reminderSchema>

export const caseAlertsResponseSchema = z
  .object({
    alerts: z
      .array(planAlertSchema)
      .describe('Every alert on the case, newest first. Reading them marks them seen.'),
    reminders: z
      .array(reminderSchema)
      .describe('The open reminders (not deleted), soonest date first.'),
  })
  .describe('What the case is being told about: alerts and the dates behind reminders.')
export type CaseAlertsResponse = z.infer<typeof caseAlertsResponseSchema>

export const createReminderBodySchema = z
  .object({
    kind: z.enum(REMINDER_KINDS).describe('What the date is.'),
    label: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe('In the customer’s words, up to 120 characters.'),
    dueOn: day.describe('The date, YYYY-MM-DD: today or later (Europe/Dublin).'),
    productId: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe('A market product id the date belongs to, when one was named.'),
  })
  .describe('A date to be reminded of.')
export type CreateReminderBody = z.infer<typeof createReminderBodySchema>

/** Why a reminder's date cannot be taken, or null. `today` is YYYY-MM-DD in Europe/Dublin. */
export function dueOnProblem(dueOn: string, today: string): string | null {
  const parsed = new Date(`${dueOn}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueOn) {
    return `${dueOn} is not a date.`
  }
  if (dueOn < today) return `${dueOn} has passed: a reminder needs today or a later date.`
  return null
}

export const alertsRunResponseSchema = z
  .object({
    throughAt: isoDateTime.describe('The run covered market changes up to this moment.'),
    changes: z
      .number()
      .int()
      .nonnegative()
      .describe('Product versions changed or withdrawn since the last run.'),
    plans: z.number().int().nonnegative().describe('Claimed plans checked against them.'),
    rateAlerts: z
      .number()
      .int()
      .nonnegative()
      .describe('New rate-change and withdrawal alerts raised (already raised ones are skipped).'),
    reminderAlerts: z
      .number()
      .int()
      .nonnegative()
      .describe('New reminder alerts raised, one per reminder stage.'),
    pushed: z
      .number()
      .int()
      .nonnegative()
      .describe('Alerts delivered by push to at least one browser.'),
    pushFailed: z
      .number()
      .int()
      .nonnegative()
      .describe('Alerts whose push failed or found no live subscription; kept for the next visit.'),
  })
  .describe('What one alerts run did, as counts.')
export type AlertsRunResponse = z.infer<typeof alertsRunResponseSchema>
