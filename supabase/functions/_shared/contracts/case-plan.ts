import { z } from 'zod'
import {
  PLAN_CHOICE_SLOTS,
  PLAN_PROPERTY_KINDS,
  PLAN_ROW_ID_PATTERN,
  planChoiceSchema,
} from './market-plan.ts'

/**
 * The plan in the app's profile (2026-11-12, the first-home experience, "6. The saving months"):
 * `GET /api/cases/{caseId}/plan` reads the newest claimed plan's editable figures and where it
 * stands; `PATCH` changes one or more of them, rebuilds the plan on the new figures and returns
 * `reading`, what changed and which options now fit, which the conversation then opens with.
 * Balances stay on the holdings routes.
 */

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
const amount = z.number().positive().max(100_000_000)

export const planEditableSchema = z
  .object({
    targetDate: month
      .nullable()
      .describe('The month the leading goal is for (the keys, for a home), YYYY-MM. Null: none.'),
    homePrice: z
      .number()
      .nullable()
      .describe(
        'The price the home comparison uses: the one given, else the one it worked out. Held when another figure changes. Null: not a home plan.',
      ),
    monthlySaving: z.number().nullable().describe('What they put aside each month.'),
    propertyKind: z
      .enum(PLAN_PROPERTY_KINDS)
      .nullable()
      .describe('The kind of home, as they said it. Null: not given (second-hand is assumed).'),
    firstTimeBuyer: z
      .boolean()
      .nullable()
      .describe('As they said it. Null: not given (a first-time buyer is assumed).'),
    buyingTogether: z
      .boolean()
      .nullable()
      .describe(
        'Two people buying. Null: not given. Changes no figure; questions are worded for both.',
      ),
  })
  .describe('The figures the profile can change in place.')
export type PlanEditable = z.infer<typeof planEditableSchema>

/**
 * What the customer chose for each part of the plan (2026-11-13), from the cards: the sum held,
 * the monthly saving and the mortgage. Null: open. A choice is the customer's; the model never
 * makes one.
 */
export const casePlanChoicesSchema = z
  .object({
    lump_sum: planChoiceSchema.nullable().describe('The account for the sum held. Null: open.'),
    monthly_saving: planChoiceSchema
      .nullable()
      .describe('The account for the monthly saving. Null: open.'),
    mortgage: planChoiceSchema.nullable().describe('The mortgage option. Null: open.'),
  })
  .describe('The products chosen for each part of the plan.')
export type CasePlanChoices = z.infer<typeof casePlanChoicesSchema>

export const casePlanSchema = z
  .object({
    planId: z.string().describe('The claimed plan.'),
    title: z.string(),
    editable: planEditableSchema,
    summary: z
      .object({
        keysOn: month
          .nullable()
          .describe(
            'The month the card names for the keys, YYYY-MM. Null: not reached, or not a home plan.',
          ),
        neededAtKeysEur: z
          .number()
          .nullable()
          .describe(
            'The cash needed at the keys: deposit, stamp duty, fees, less Help to Buy counted.',
          ),
        savedEur: z
          .number()
          .nullable()
          .describe('Saved now: the holdings’ accounts, else the plan’s own savings.'),
        progressLine: z
          .string()
          .nullable()
          .describe('Where the holdings leave the plan, one factual line (`planProgress`).'),
      })
      .describe('Where the plan stands.'),
    watched: z
      .array(
        z.object({
          rowId: z
            .string()
            .optional()
            .describe(
              'For a mortgage option: its row id, to choose it with `POST …/plan/choices` (slot `mortgage`).',
            ),
          lead: z.string().describe('The lender, or the provider for a savings plan.'),
          kind: z
            .string()
            .describe('"3-year fixed", "variable", or the product’s part in the plan.'),
          value: z.string().describe('The rate: "3.45%".'),
          figure: z
            .string()
            .describe('The figure the options are sorted by ("€1,751/mo"), or the amounts placed.'),
        }),
      )
      .max(3)
      .describe('The plan’s first three options in the customer’s order. Never a pick.'),
    choices: casePlanChoicesSchema,
    updatedAt: z
      .string()
      .describe('When the plan last changed: its last edit or choice, else when it was made.'),
  })
  .describe('The claimed plan, as the profile shows it.')
export type CasePlan = z.infer<typeof casePlanSchema>

export const casePlanEditSchema = z
  .object({
    targetDate: month.optional().describe('YYYY-MM, this month or later.'),
    homePrice: amount.optional(),
    monthlySaving: amount.optional(),
    propertyKind: z.enum(PLAN_PROPERTY_KINDS).optional(),
    firstTimeBuyer: z.boolean().optional(),
    buyingTogether: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Give at least one figure to change.',
  })
  .describe('The figures to change; the rest stay as they are.')
export type CasePlanEdit = z.infer<typeof casePlanEditSchema>

export const casePlanEditedSchema = casePlanSchema
  .extend({
    reading: z
      .string()
      .describe(
        'What changed and which options now fit, in their figures: one or two sentences of fact, never "better" and never a pick. The conversation opens with it.',
      ),
  })
  .describe('The rebuilt plan, and what the change does.')
export type CasePlanEdited = z.infer<typeof casePlanEditedSchema>

export const casePlanChoiceSlotSchema = z
  .enum(PLAN_CHOICE_SLOTS)
  .describe(
    '`lump_sum`: the sum held. `monthly_saving`: the monthly saving. `mortgage`: the mortgage.',
  )

export const casePlanChoiceBodySchema = z
  .object({
    slot: casePlanChoiceSlotSchema,
    rowId: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(PLAN_ROW_ID_PATTERN)
      .describe(
        'The row id the card carried: a products row’s `id` (`bunq:savings.bunq_savings`, a ladder rung’s, `held:<n>`), a comparison column’s `rowId`, or a mortgage option’s `rowId`.',
      ),
  })
  .strict()
  .describe(
    'A product the customer chose on a card for one part of the plan. Only the row id is sent: its figures are rebuilt from the market.',
  )
export type CasePlanChoiceBody = z.infer<typeof casePlanChoiceBodySchema>
