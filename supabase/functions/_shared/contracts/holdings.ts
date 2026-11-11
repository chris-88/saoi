import { z } from 'zod'

/**
 * Holdings: accounts and debts the customer enters by hand (design
 * `2026-11-11-saoi-holdings-design`), seeded from a claimed plan, so the plan moves. Progress
 * against the plan is a fact with its figures, never praise or a nudge.
 *
 * Self-contained: it imports nothing but zod, so the apps can copy it alone.
 */

export const HOLDING_ASSET_KINDS = ['current', 'savings', 'deposit'] as const
export const HOLDING_DEBT_KINDS = [
  'credit_card',
  'personal_loan',
  'car_finance',
  'overdraft',
  'mortgage',
  'other_debt',
] as const
export const HOLDING_KINDS = [...HOLDING_ASSET_KINDS, ...HOLDING_DEBT_KINDS] as const
export const HOLDING_SOURCES = ['plan', 'customer', 'saoirse'] as const

export type HoldingKind = (typeof HOLDING_KINDS)[number]

/** An account (money held) rather than a debt (money owed). */
export const isAssetKind = (kind: HoldingKind): boolean =>
  (HOLDING_ASSET_KINDS as readonly string[]).includes(kind)

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const month = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM')
const isoDateTime = z.iso.datetime({ offset: true })
const eur = z.number().min(0).max(9_999_999_999.99)
const signedEur = z.number().min(-9_999_999_999.99).max(9_999_999_999.99)
const pct = z.number().min(0).max(100)

const kindField = z
  .enum(HOLDING_KINDS)
  .describe(
    'What it is. Accounts: `current`, `savings`, `deposit` (a fixed-term deposit). Debts: `credit_card`, `personal_loan`, `car_finance`, `overdraft`, `mortgage`, `other_debt`.',
  )
const labelField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe('In the customer’s words, up to 80 characters: "BoI savings", "AIB mortgage".')
const balanceField = eur.describe(
  'What is held in an account, or what is owed on a debt, in euro: always a positive amount.',
)
const rateField = pct.describe('AER for an account; APR, or the mortgage rate, for a debt.')
const monthlyField = eur.describe(
  'Each month: what goes in, for an account; the repayment, for a debt. In euro.',
)
const fixedUntilField = day.describe(
  'When a fixed rate ends or a deposit matures, YYYY-MM-DD. A reminder is kept for it.',
)
const providerField = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .describe('Who it is with: "Bank of Ireland", "AIB".')
const productIdField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe('A market product id (`savings.supersaver`), when it is a product Saoi lists.')
const notedOnField = day.describe('The day the balance was true, YYYY-MM-DD.')

export const holdingSchema = z
  .object({
    id: z.uuid().describe('The holding.'),
    kind: kindField,
    label: z.string().describe('In the customer’s words.'),
    provider: z.string().nullable().describe('Who it is with, when given.'),
    productId: z.string().nullable().describe('A market product id, when it is one Saoi lists.'),
    balance: balanceField,
    ratePct: pct.nullable().describe('AER for an account; APR or the mortgage rate for a debt.'),
    monthlyAmountEur: eur
      .nullable()
      .describe('Each month: saved in, for an account; the repayment, for a debt.'),
    fixedUntil: day
      .nullable()
      .describe('When a fixed rate ends or a deposit matures, YYYY-MM-DD; null when none.'),
    notedOn: notedOnField,
    source: z
      .enum(HOLDING_SOURCES)
      .describe(
        'Where it came from: `plan` (seeded from the claimed plan), `customer` (entered in the app), `saoirse` (said in the conversation).',
      ),
    reminderId: z
      .uuid()
      .nullable()
      .describe('The reminder kept for `fixedUntil`, when there is one.'),
    createdAt: isoDateTime.describe('When it was added.'),
    updatedAt: isoDateTime.describe('When it was last changed.'),
  })
  .describe('One account or debt the customer holds, as they entered it.')
export type Holding = z.infer<typeof holdingSchema>

export const createHoldingBodySchema = z
  .object({
    kind: kindField,
    label: labelField,
    balance: balanceField,
    ratePct: rateField.optional(),
    monthlyAmountEur: monthlyField.optional(),
    fixedUntil: fixedUntilField.optional(),
    provider: providerField.optional(),
    productId: productIdField.optional(),
    notedOn: notedOnField
      .optional()
      .describe('The day the balance was true, YYYY-MM-DD. Default: today (Europe/Dublin).'),
  })
  .describe('An account or a debt to add.')
export type CreateHoldingBody = z.infer<typeof createHoldingBodySchema>

export const updateHoldingBodySchema = z
  .object({
    kind: kindField.optional(),
    label: labelField.optional(),
    balance: balanceField.optional(),
    ratePct: rateField.nullable().optional().describe('The rate; null clears it.'),
    monthlyAmountEur: monthlyField
      .nullable()
      .optional()
      .describe('The monthly amount; null clears it.'),
    fixedUntil: fixedUntilField
      .nullable()
      .optional()
      .describe('The fixed-until date; null clears it and deletes its reminder.'),
    provider: providerField.nullable().optional().describe('Who it is with; null clears it.'),
    productId: productIdField.nullable().optional().describe('The product id; null clears it.'),
    notedOn: notedOnField
      .optional()
      .describe(
        'The day the balance was true. Default when the balance changes: today (Europe/Dublin).',
      ),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to change' })
  .describe('What changed on a holding; fields left out stay as they are.')
export type UpdateHoldingBody = z.infer<typeof updateHoldingBodySchema>

export const depositProgressSchema = z
  .object({
    goal: z.literal('house_deposit').describe('A house-deposit goal.'),
    goalLabel: z.string().describe('The goal, in the plan’s words.'),
    savedNowEur: eur.describe(
      'Held now: the sum of `current`, `savings` and `deposit` holdings, or the plan’s own savings when there are none.',
    ),
    savedFrom: z
      .enum(['holdings', 'plan'])
      .describe('Whether `savedNowEur` is from the holdings or, with none, from the plan.'),
    neededEur: eur
      .nullable()
      .describe(
        'The cash the plan needs at the keys (deposit, stamp duty and fees), else the goal’s target; null when the plan has neither.',
      ),
    monthlyEur: eur
      .nullable()
      .describe(
        'Saved each month: the sum of the accounts’ monthly amounts, else the plan’s monthly saving; null when neither is known.',
      ),
    monthAtThisPace: month
      .nullable()
      .describe(
        'YYYY-MM the needed amount is held at this pace, before interest (the plan’s own arithmetic); null when it is not reached or nothing is needed.',
      ),
    planExpectedNowEur: eur.describe(
      'What the plan’s own path had by this month: its savings plus its monthly saving for each month since it was made, before interest.',
    ),
    differenceEur: signedEur
      .nullable()
      .describe(
        'Held now less the plan’s path: positive is ahead, negative behind. Null when no account is held as a holding.',
      ),
    line: z
      .string()
      .describe(
        'The progress in one sentence, a fact: "€33,000 of €47,000 saved; at €1,000 a month that is February 2028, €2,000 ahead of the plan’s path."',
      ),
  })
  .describe('Progress on a house deposit.')

export const debtProgressSchema = z
  .object({
    goal: z.literal('pay_off_debt').describe('A goal to pay off debt.'),
    goalLabel: z.string().describe('The goal, in the plan’s words.'),
    owedNowEur: eur.describe(
      'Owed now: the sum of the debt holdings, or the plan’s own debts when there are none.',
    ),
    owedFrom: z
      .enum(['holdings', 'plan'])
      .describe('Whether `owedNowEur` is from the holdings or, with none, from the plan.'),
    planOwedEur: eur.describe('What the plan said was owed when it was made.'),
    changeEur: signedEur.describe(
      'Owed now less what the plan said: negative is less owed, positive more.',
    ),
    monthlyEur: eur
      .nullable()
      .describe(
        'Repaid each month: the sum of the debts’ repayments, else the plan’s; null when none is known.',
      ),
    monthsLeft: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe(
        'Months to clear what is owed at that repayment, before interest; null without one.',
      ),
    clearedIn: month
      .nullable()
      .describe('YYYY-MM it is cleared at that repayment, before interest; null without one.'),
    line: z
      .string()
      .describe(
        'The progress in one sentence, a fact: "€6,500 owed, €9,000 when the plan was made; at €400 a month that is 17 months, to April 2028, before interest."',
      ),
  })
  .describe('Progress on paying off debt.')

export const planProgressSchema = z
  .discriminatedUnion('goal', [depositProgressSchema, debtProgressSchema])
  .describe(
    'Where things stand against the claimed plan’s leading house-deposit or debt goal: figures and one factual line, never praise or advice.',
  )
export type PlanProgress = z.infer<typeof planProgressSchema>

export const caseHoldingsResponseSchema = z
  .object({
    holdings: z
      .array(holdingSchema)
      .describe('The holdings on the case that are not deleted, oldest first.'),
    progress: planProgressSchema
      .nullable()
      .describe(
        'Progress against the claimed plan; null when no plan is claimed or it has no house-deposit or debt goal.',
      ),
  })
  .describe('What the customer holds and where that leaves the plan.')
export type CaseHoldingsResponse = z.infer<typeof caseHoldingsResponseSchema>
