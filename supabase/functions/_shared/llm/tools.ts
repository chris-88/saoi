import { z } from 'zod'
import { GOAL_IDS } from '../domain/goals/types.ts'
import { FACT_KEYS, type FactKey } from '../domain/facts.ts'
import { PRODUCTS } from '../domain/journey.ts'
import { REMINDER_KINDS } from '../contracts/alerts.ts'
import { HOLDING_KINDS } from '../contracts/holdings.ts'
import { MARKET_ARRANGEMENT_KINDS } from '../contracts/cards.ts'
import { HOME_SORTS } from '../contracts/market-tools.ts'

/**
 * The tools Saoirse may call.
 *
 * Invariant 1 — the model proposes, the UI commits. Read the list and note what is absent:
 * there is no tool that creates, submits, pauses or resumes an application, grants consent,
 * invites a partner, or makes a declaration. Every one of those is a `case-action` call made
 * by the customer's own tap. The model can only record what it was told, and ask for a card
 * to be rendered.
 *
 * Every input is validated here before any effect. Invalid input returns a tool error to the
 * model and is never thrown to the user.
 */

const factKeyEnum = z.enum(FACT_KEYS as unknown as [FactKey, ...FactKey[]])
const productEnum = z.enum(PRODUCTS)
const applicationId = z.uuid()

/**
 * An answer to one of the bank form's own questions.
 *
 * Separate from `record_facts` because the two are different kinds of thing. A fact is about a
 * person and is worth carrying between products for years; "do you use online banking?" belongs to
 * one lending application and nowhere else. Mixing them would mean inventing a fact key for
 * every question on every form the bank publishes.
 *
 * The server checks the field exists, is live on this customer's branch, is actually a
 * question, and that a choice answer is one the form offers. A declaration or an upload cannot
 * be set here at all, whatever the model sends: those need a tap and a file.
 */
export const recordFormAnswersInput = z.object({
  applicationId: z.uuid(),
  answers: z
    .array(
      z.object({
        /**
         * The definition's own field id, in brackets on every line of the digest.
         *
         * Wide enough to hold a label as well, deliberately. A model that sends the question's
         * wording instead of its id is resolved on the server where exactly one live question
         * carries it, and otherwise refused with the ids that would have worked. A length
         * error here would say none of that.
         */
        fieldId: z.string().min(1).max(200),
        value: z.union([z.string().max(200), z.number(), z.boolean()]),
      }),
    )
    .min(1)
    .max(12),
})

export const showFormDeclarationsInput = z.object({ applicationId: z.uuid() })

/** Which application; the server decides which document the form is waiting for. */
export const showFormUploadInput = z.object({ applicationId: z.uuid() })

export const recordFactsInput = z.object({
  facts: z
    .array(
      z.object({
        key: factKeyEnum,
        /**
         * Only needed when the fact belongs to the second applicant. The catalogue already
         * knows whether a key is household-level or personal, so the model is not asked to
         * decide — it got that wrong often enough to lose facts.
         */
        subject: z.enum(['primary', 'partner']).optional(),
        value: z.unknown(),
      }),
    )
    .min(1)
    /*
     * Was 12, which an opening message can exceed without trying.
     *
     * "I want a mortgage, I'm renting at 3,500, I've two kids, I save 2,500 a month, I'm
     * employed by Revenue, I've no debt" carries fifteen facts, and the refusal cost a whole
     * extra model round — every round re-reads the 28,000-token cached prefix, so the bound
     * meant to keep one call small was buying a second call instead. The bound is still here
     * because a tool input has to be finite; it is no longer tighter than the conversation.
     *
     * Nothing is admitted by raising it. Each fact is still checked against the catalogue one
     * at a time, and anything marked `extractable: false` is still refused (Invariant 6).
     */
    .max(24),
})

export const showProductOptionsInput = z.object({
  products: z
    .array(
      z.object({
        /**
         * Which catalogue product this is, when the kind alone is not enough.
         *
         * Nine savings products share one `savings` journey. Without this, SuperSaver and the
         * 31-Day Notice Account are the same row offered twice and the same application
         * started once.
         */
        catalogueId: z.string().min(1).max(80).optional(),
        product: productEnum,
        /** Must tie back to something the customer actually said (§49). */
        reason: z.string().min(10).max(200),
      }),
    )
    .min(1)
    .max(5),
})

export const showReviewInput = z.object({ applicationId })
export const showPausePromptInput = z.object({ applicationId })
/**
 * Nothing. The server works the arrangement out from the facts it holds and the catalogue it
 * reads; there is no number the model could pass that would not be a number the model made up.
 */
export const showArrangementInput = z.object({})

/**
 * Open banking, simulated. Connecting takes one line of why; the banks, the scope and the
 * consent period are the server's. The overview takes nothing: it is read off the linked
 * rows. A transfer names the application the money is for and, optionally, how much and how
 * often; the server reads the balance, caps the amount at it, and the customer's tap moves it.
 */
export const showConnectAccountsInput = z.object({
  why: z.string().min(1).max(300),
})
export const showAccountsInput = z.object({})
export const EXISTING_ACCOUNT_HERE = 'existing_account_here'
export const showTransferInput = z.object({
  /** An application on the case, or `existing_account_here` for an account they already hold. */
  applicationId: z.string().min(1),
  amount: z.number().positive().optional(),
  cadence: z.enum(['once', 'monthly']).optional(),
})

export const showStatusInput = z.object({
  /** Omit for every application on the case. */
  applicationId: applicationId.optional(),
})

export const requestUploadInput = z.object({
  applicationId,
  /**
   * Which kind of document, when the customer has named one. Leave it out and the server picks
   * the next one the application is waiting for.
   *
   * A closed set rather than a requirement id: ids live in the journey files and never reach
   * the model, so asking for one left it guessing and then explaining to the customer that it
   * could not.
   */
  documentType: z
    .enum(['payslip', 'bank_statement', 'photo_id', 'proof_of_address', 'salary_certificate'])
    .optional(),
})

/**
 * §10 — Saoirse proposes, the customer accepts. The plan is written as a draft and only becomes
 * theirs when they tap, which is the same rule every other commitment follows (Invariant 1).
 */
export const proposePlanInput = z.object({
  /** A goal-catalogue blueprint id, which decides the plan's milestones and check-ins. */
  goal: z.enum(GOAL_IDS),
  /** In the customer's words: "Buy our first home", not "First-Time Buyer Journey". */
  title: z.string().min(4).max(80),
  /** What they are aiming at. The server checks it against what the case can support. */
  targetAmount: z.number().int().positive().optional(),
  /** YYYY-MM or YYYY-MM-DD, when they named one. */
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/)
    .optional(),
})

/**
 * §51 — answering a question about money with figures rather than prose.
 *
 * The model passes only what the customer actually said. Every rate, repayment and total is
 * computed by the server from the catalogue, so there is no number here for the model to get
 * wrong. Any two of the three is enough; the engine works out the third.
 */
/**
 * Several named products from the catalogue, side by side.
 *
 * Only ids: everything shown beside each one is read from the knowledge base by the server, so
 * the model chooses what to compare and why, and cannot describe a product into existence.
 */
/**
 * The four answers a published mortgage rate depends on.
 *
 * Not a request for rates — a request to price these criteria. The server owns which rows they
 * entitle somebody to, including refusing to price a BER the table does not cover.
 */
export const showMortgageRatesInput = z.object({
  customerType: z.enum([
    'first_time_buyer',
    'mover',
    'switcher',
    'existing_demo_mortgage',
    'buy_to_let_new',
  ]),
  ber: z.enum(['A0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'BER Exempt']),
  /** What they intend to borrow. Decides High Value eligibility and every monthly figure. */
  amountEur: z.number().int().positive().max(5_000_000).optional(),
  /** The mortgage term, not the fixed period. */
  termYears: z.number().int().min(5).max(35).optional(),
  /**
   * A rate the customer already has, or has been offered to stay, to set each published rate
   * against. Needs the amount and the term too, since the comparison is in euro.
   */
  compareWith: z
    .object({
      /** In the customer's terms: "AIB, 4% fixed for 2 years". */
      label: z.string().min(2).max(80),
      ratePct: z.number().min(0).max(20),
      cashbackEur: z.number().int().nonnegative().optional(),
      fixedYears: z.number().int().min(1).max(30).optional(),
    })
    .optional(),
})

export const showComparisonInput = z.object({
  /** What is being compared, in the customer's terms. */
  title: z.string().min(1).max(60),
  options: z
    .array(
      z.object({
        /** A catalogue id, exactly as it appears in the product list. */
        id: z.string().min(1).max(80),
        /** Why this one, tied to something they actually said. */
        reason: z.string().min(1).max(200),
      }),
    )
    .min(2)
    .max(4),
})

export const showQuoteInput = z.object({
  product: z.enum(PRODUCTS),
  /** Borrowed, owed, or saved towards. */
  amount: z.number().positive().optional(),
  /** The term, in months. 30 years is 360. */
  months: z.number().int().positive().max(600).optional(),
  /** What they can pay, or put away, each month. */
  monthly: z.number().positive().optional(),
})

export const showPartnerInviteInput = z.object({
  applicationIds: z.array(applicationId).min(1).max(5),
})

/**
 * Surfaces whatever structured form that application needs next — a consent, or the health
 * questions once consent is given.
 *
 * The model names only the application. The server decides which form is due, so the model
 * cannot invent a form, reorder them, or reach the health questions before consent (§7.5,
 * Invariant 6).
 */
export const showFormInput = z.object({ applicationId })

/**
 * A date the customer gave: their fixed rate ends, a deposit matures. Recorded as they said it,
 * like a fact; the alerts that follow (90, 60, 30 and 7 days before, and the day) state the date
 * and today's market beside it, and pick nothing.
 */
export const setReminderInput = z.object({
  kind: z.enum(REMINDER_KINDS),
  /** YYYY-MM-DD, today or later. Ask for the day when they gave only a month. */
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  /** In their words: "AIB fixed rate". */
  label: z.string().trim().min(1).max(120),
})

/**
 * An account or a debt the customer stated: "€12,000 in a BoI savings account at 2%", "the
 * mortgage is €240,000 fixed until March 2027". Recorded as they said it, like a fact; a
 * fixed-until date keeps a reminder. `holdingId` (from the digest) updates one already held.
 */
export const recordHoldingInput = z.object({
  /** Set to change a holding the digest lists; left out, a new one is added. */
  holdingId: z.uuid().optional(),
  kind: z.enum(HOLDING_KINDS),
  /** In their words: "BoI savings", "AIB mortgage". */
  label: z.string().trim().min(1).max(80),
  /** What is held, or what is owed, in euro: always positive. */
  balance: z.number().min(0).max(9_999_999_999.99),
  /** AER for an account; APR or the mortgage rate for a debt. */
  ratePct: z.number().min(0).max(100).optional(),
  /** Each month: saved in, for an account; the repayment, for a debt. */
  monthlyAmountEur: z.number().min(0).max(9_999_999_999.99).optional(),
  /** YYYY-MM-DD the fixed rate ends or the deposit matures. Ask for the day if only a month. */
  fixedUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
  provider: z.string().trim().min(1).max(60).optional(),
  /** A market product id, only when the digest or a result named one. */
  productId: z.string().trim().min(1).max(80).optional(),
})

/**
 * The product card that follows the question asked: the model names the arrangement the
 * question implies (and, for a mortgage, the sort and the customer's own filters); the server
 * reads their figures from the case, runs the engine over the whole market and builds every row.
 */
export const showProductsInput = z.object({
  arrangement: z.enum(MARKET_ARRANGEMENT_KINDS),
  /** Narrows a savings card to monthly saving accounts or lump-sum deposits. */
  category: z.enum(['savings', 'deposits', 'mortgages']).optional(),
  /** Mortgages: the order the customer asked for. Default: the order their plan uses. */
  sortBy: z.enum(HOME_SORTS).optional(),
  /** Mortgages: only filters the customer asked for. */
  filters: z
    .object({
      stayWithBank: z.boolean().optional(),
      rateType: z.enum(['fixed', 'variable', 'either']).optional(),
      green: z.boolean().optional(),
    })
    .optional(),
})

export const TOOL_INPUTS = {
  record_facts: recordFactsInput,
  set_reminder: setReminderInput,
  record_holding: recordHoldingInput,
  record_form_answers: recordFormAnswersInput,
  show_form_declarations: showFormDeclarationsInput,
  show_form_upload: showFormUploadInput,
  show_product_options: showProductOptionsInput,
  show_review: showReviewInput,
  show_pause_prompt: showPausePromptInput,
  propose_plan: proposePlanInput,
  show_quote: showQuoteInput,
  show_comparison: showComparisonInput,
  show_mortgage_rates: showMortgageRatesInput,
  request_upload: requestUploadInput,
  show_partner_invite: showPartnerInviteInput,
  show_status: showStatusInput,
  show_arrangement: showArrangementInput,
  show_form: showFormInput,
  show_connect_accounts: showConnectAccountsInput,
  show_accounts: showAccountsInput,
  show_transfer: showTransferInput,
  show_products: showProductsInput,
} as const

export type ToolName = keyof typeof TOOL_INPUTS
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as readonly ToolName[]

export type ToolDefinition = {
  readonly name: ToolName
  readonly description: string
  readonly schema: z.ZodType
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'show_products',
    description:
      'Show the products the customer asked to see, from the whole Irish market and their own ' +
      'figures, arranged by what the question implies. Pick the arrangement from the question: ' +
      '"what does my savings account earn against the market", "is my rate any good", "what ' +
      'could my money earn elsewhere" is held_vs_market; "how soon can I get at the money", ' +
      '"instant access or fixed", "what does locking it away get me" is by_access; "where can ' +
      'the deposit sit until the keys", "what fits my date", "accounts for the next two years" ' +
      'is fits_date; "what would the mortgage cost", "show me the mortgages", "which lenders", ' +
      '"lowest monthly" is mortgage_by_sort (pass sortBy when they name an order: ' +
      'five_year_cost, keys_date or monthly_repayment; filters only when they asked for one: ' +
      'stay with their bank, fixed or variable, green). A follow-up such as "by access instead" ' +
      'calls it again with that arrangement. The server reads their figures from the case and ' +
      'builds every row; you pass no figures and name no product. Say one line about the card ' +
      'and ask nothing else; do not read the rows out, and never call one the pick for them. If ' +
      'it returns questions instead of a card, ask the first one.',
    schema: showProductsInput,
  },
  {
    name: 'record_holding',
    description:
      'Record an account or a debt the customer states with a balance: savings or a current ' +
      'account ("€12,000 in a BoI savings account at 2%"), a fixed-term deposit, a credit card, ' +
      'a loan, car finance, an overdraft or a mortgage ("the mortgage is €240,000 fixed until ' +
      'March 2027"). Only figures they actually gave; never estimate one. To change one the ' +
      'digest lists under "What they hold", pass its holdingId with its kind, label and the new ' +
      'balance. fixedUntil is YYYY-MM-DD (ask for the day if they gave only a month); Saoi then ' +
      'keeps a reminder for it. Afterwards say what was recorded and the progress line, as ' +
      'facts: no praise, no encouragement, no suggestion of what to do next.',
    schema: recordHoldingInput,
  },
  {
    name: 'set_reminder',
    description:
      'Record a date the customer told you about money: when their fixed mortgage rate ends ' +
      '(fixed_rate_ends), when a fixed-term deposit matures (deposit_matures), or another ' +
      'money date (other). Only a date they actually gave. If they gave only a month or a ' +
      'season ("next March"), ask which day first, then call this with YYYY-MM-DD. The label is ' +
      'in their words ("AIB fixed rate"). Saoi then sends them the date and the market beside ' +
      'it 90, 60, 30 and 7 days before and on the day; say that in one line, as a fact. Never ' +
      'suggest what to do when the date comes.',
    schema: setReminderInput,
  },
  {
    name: 'record_facts',
    description:
      'Record something the customer just told you, so it is never asked for again. Only for ' +
      'what they actually said — never a guess, an inference, or anything about health. What ' +
      'they say their partner earns is income.partnerAnnualStated until the partner has joined ' +
      'and given their own figure.',
    schema: recordFactsInput,
  },
  {
    name: 'record_form_answers',
    description:
      "Record an answer to one of the bank form's own questions, listed under THE BANK FORM " +
      'BEHIND THIS APPLICATION. The fieldId is the id in brackets on that list, copied ' +
      'exactly. Only what the customer actually said, and for a question with a fixed set of ' +
      'answers, only one of those answers. Declarations and documents are not recorded here: ' +
      'they need a tap or a file.',
    schema: recordFormAnswersInput,
  },
  {
    name: 'show_form_declarations',
    description:
      'Show the declarations the bank form requires, in its own words, for the customer to ' +
      'tick. Use this when the only things left are declarations. You cannot record them any ' +
      'other way.',
    schema: showFormDeclarationsInput,
  },
  {
    name: 'show_form_upload',
    description:
      'Ask for a document the bank form requires, so the customer can attach it. The server ' +
      'decides which document is next and what the form accepts.',
    schema: showFormUploadInput,
  },
  {
    name: 'show_product_options',
    description:
      'Offer products for the customer to choose from. Give a one-line reason for each, tied ' +
      'to something they told you. The customer chooses in the card; you do not create ' +
      'anything by calling this. When you mean a particular product from the catalogue, set ' +
      'catalogueId to its id (for example savings.supersaver) — several products share one ' +
      'kind, and without the id two different savings accounts are one row offered twice and ' +
      'one application started. One line of your own before it and nothing after: do not ask ' +
      'the customer anything in the turn you show it, because they cannot answer you and the ' +
      'card at the same time.',
    schema: showProductOptionsInput,
  },
  {
    name: 'show_review',
    description:
      'Show what is about to be submitted for an application, for the customer to confirm. ' +
      'The content is built from the case, not from you. Nothing is submitted until they tap.',
    schema: showReviewInput,
  },
  {
    name: 'show_pause_prompt',
    description:
      'Offer to hold an application. Use after explaining why, for example when a loan would ' +
      'affect a mortgage. The customer decides in the card.',
    schema: showPausePromptInput,
  },
  {
    name: 'request_upload',
    description:
      'Show the card that lets the customer send in a document. The card is how a document ' +
      'actually arrives — describing it or promising a link does nothing. Pass only the ' +
      'application and, if they named one, the kind of document; the server picks whichever ' +
      'is outstanding. One at a time.',
    schema: requestUploadInput,
  },
  {
    name: 'propose_plan',
    description:
      'Offer to keep this as a plan: a goal that outlives any one application, with ' +
      'milestones and a check-in. Use it when what the customer wants takes months rather ' +
      'than one conversation — saving towards something, or a purchase some way off. The ' +
      'card is how they accept; nothing is kept until they tap it. Do not propose a plan for ' +
      'something they can simply do today. One line of your own before it and nothing after: ' +
      'do not ask the customer anything in the turn you show it, because they cannot answer ' +
      'you and the card at the same time.',
    schema: proposePlanInput,
  },
  {
    name: 'show_mortgage_rates',
    description:
      "Show Demo Bank's illustrative mortgage rates for this customer. The bank's own rate " +
      'table is available to you through this tool, so quote from it rather than saying you ' +
      'cannot give a rate. It is indexed by four things and prices each separately, so all ' +
      'four are required before it will return anything: who they are (first-time buyer, ' +
      'mover, switcher, existing Demo Bank mortgage, or buy-to-let), the BER of the ' +
      'property, what they intend to borrow, and over what term. Ask for whichever you are ' +
      'missing — one question at a time — rather than guessing or quoting a range. The server ' +
      'decides which rates they are entitled to see and works out the repayments; you explain ' +
      'what separates them. For a switcher, or anyone with a rate in hand, pass compareWith: ' +
      'the rate they are on or have been offered to stay. The card then shows, for each ' +
      'published rate, the monthly difference, the difference over the fixed period, the ' +
      'cashback, and the net figure before switching costs, with the published costs listed. ' +
      'Never do that arithmetic yourself and never ask the customer to.',
    schema: showMortgageRatesInput,
  },
  {
    name: 'show_comparison',
    description:
      'Put two to four named products from the catalogue side by side, so the customer can see ' +
      'them together and tap one to hear more. Use it when the catalogue holds several things ' +
      'that could do the job — savings accounts, credit cards, loans — and listing them in a ' +
      'sentence would make the customer hold four descriptions in their head. Pass catalogue ' +
      'ids exactly as written, and one line each on why this one is in front of this person. ' +
      'Everything else beside each option is read from the catalogue. Nothing is started by ' +
      'tapping one, so this is not the card that begins an application. One line of your own ' +
      'before it and nothing after: do not ask the customer anything in the turn you show it, ' +
      'because they cannot answer you and the card at the same time.',
    schema: showComparisonInput,
  },
  {
    name: 'show_quote',
    description:
      'Answer a question about what something costs, pays or takes, with options to compare. ' +
      'Use it whenever a customer mentions an amount, a term or a monthly figure for any ' +
      'product — borrowing, saving or a card balance. Pass only what they actually said; any ' +
      'two of amount, months and monthly is enough and the third is worked out. Never do the ' +
      'arithmetic yourself and never restate the figures: they are on the card.',
    schema: showQuoteInput,
  },
  {
    name: 'show_partner_invite',
    description:
      'Offer to invite the second applicant to the applications they are needed for. The ' +
      'invitation is only sent when the customer taps.',
    schema: showPartnerInviteInput,
  },
  {
    name: 'show_form',
    description:
      'Show the next form this application needs — a consent, or health questions once consent ' +
      'is given. You name the application only; which form is due is decided for you. Use this ' +
      'whenever an application needs something you are not allowed to ask for in conversation.',
    schema: showFormInput,
  },
  {
    name: 'show_status',
    description:
      'Show the status card for one application, or for all of them. The card renders from the ' +
      'case, independently of whatever you write alongside it.',
    schema: showStatusInput,
  },
  {
    name: 'show_arrangement',
    description:
      'Show how the money the customer already has and the money they save each month should ' +
      'be split across savings accounts: the lump sum locked away for as long as fits before ' +
      'they need it, exactly the monthly minimum that earns a bonus, the rest where it earns ' +
      'most. The server works all of it out from the facts held and the published rates; you ' +
      'pass nothing and quote none of the figures. One tap starts every account on it. One ' +
      'line of your own before it and nothing after: do not ask the customer anything in the ' +
      'turn you show it.',
    schema: showArrangementInput,
  },
  {
    name: 'show_connect_accounts',
    description:
      'Offer to link the accounts the customer holds at other banks, so Saoirse can see balances ' +
      'and transactions and, with their consent, move money. Use it when they mention savings ' +
      'or salary held elsewhere, when an application would otherwise need statements or ' +
      'payslips, or when they ask to see everything in one place. Pass one line of why, in ' +
      'their terms. The card carries the banks, what is shared and for how long; linking is ' +
      'their tap. Say nothing about the accounts until they are linked.',
    schema: showConnectAccountsInput,
  },
  {
    name: 'show_accounts',
    description:
      "Show the customer's linked accounts in one place: balances, this month's money in and " +
      'out, the salary the server has detected and the largest regular outgoings. Only once ' +
      'accounts are linked; you pass nothing and quote none of the figures, they are on the ' +
      'card. Use it when they ask where they stand or when the figures it holds would answer ' +
      'what you were about to ask.',
    schema: showAccountsInput,
  },
  {
    name: 'show_transfer',
    description:
      'Offer to move money from a linked account into a savings or current account application ' +
      'started here, from the moment it is started (it waits as initiated until the account opens), ' +
      'or, when the case says they already bank here, into the current account they hold: pass ' +
      '`existing_account_here`. Nowhere for it to land means say so and offer the account first: the lump sum into the savings account that was just opened, or a monthly amount ' +
      'as a standing order. Name the application; the server reads the balance and caps the ' +
      'amount. Nothing moves until the customer taps. One line of why, nothing asked in the ' +
      'same turn.',
    schema: showTransferInput,
  },
]

export type ToolValidation =
  | { readonly ok: true; readonly name: ToolName; readonly input: unknown }
  | { readonly ok: false; readonly name: string; readonly error: string }

/**
 * Validates a tool call before anything happens. An unknown name or invalid input becomes a
 * tool error the model can correct, never an exception the customer sees.
 */
export function validateToolCall(name: string, input: unknown): ToolValidation {
  if (!Object.prototype.hasOwnProperty.call(TOOL_INPUTS, name)) {
    return { ok: false, name, error: `Unknown tool "${name}".` }
  }

  const toolName = name as ToolName
  const result = TOOL_INPUTS[toolName].safeParse(input)
  if (!result.success) {
    return {
      ok: false,
      name,
      error: result.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; '),
    }
  }

  return { ok: true, name: toolName, input: result.data }
}
