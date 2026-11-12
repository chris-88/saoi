import { z } from 'zod'
import { DOCUMENT_TYPES, PRODUCTS } from '../domain/journey.ts'
import { APPLICATION_STATES } from '../domain/state-machine.ts'
import { planArrivalViewSchema, planRouteSchema, upgradeStoredArrival } from './market-plan.ts'

/**
 * Cards are what the model asks for and the server renders.
 *
 * Every card's content is built from the database by the server — the model supplies only an
 * identifier and, where it is genuinely the model's job, the wording of a reason. That is what
 * stops a status card from agreeing with model text that is wrong (Invariant 2, §59).
 */

const applicationId = z.uuid()

export const productOptionCardSchema = z.object({
  type: z.literal('product_options'),
  options: z
    .array(
      z.object({
        product: z.enum(PRODUCTS),
        /**
         * Which catalogue product this is, when the kind alone is not enough.
         *
         * Nine savings products share one `savings` journey. Without this, SuperSaver and the
         * 31-Day Notice Account are the same row offered twice and the same application
         * started once.
         */
        catalogueId: z.string().min(1).max(80).optional(),
        displayName: z.string(),
        oneLine: z.string(),
        /** The model's words, tied to what the customer said (§49). */
        reason: z.string(),
        /** Already offered and declined — shown as such rather than offered again. */
        previouslyDeclined: z.boolean(),
      }),
    )
    .min(1),
})

/**
 * Several named products side by side, to pick one to hear more about (§51).
 *
 * Distinct from `product_options`, which offers the handful of things Saoirse can actually start
 * and whose tap begins an application. This offers what the catalogue holds within a family —
 * nine savings accounts, six credit cards — so somebody can see them together and choose what
 * to ask about. Nothing is started by tapping one.
 *
 * Distinct from `quote` too, which compares computed figures for the same product. This
 * compares different products, and every word of it is read from the catalogue rather than
 * written by the model: the model chooses which to show and says why, and the facts beside each
 * one come from the knowledge base (Invariant 2).
 */
export const comparisonCardSchema = z.object({
  type: z.literal('comparison'),
  /** What is being compared, e.g. "Savings accounts". */
  title: z.string(),
  options: z
    .array(
      z.object({
        /** The catalogue id, so the follow-up turn knows exactly which one was picked. */
        id: z.string(),
        name: z.string(),
        /** The job it does, from the catalogue. */
        oneLine: z.string(),
        /** A few features, from the catalogue. Short enough to scan three of these at once. */
        highlights: z.array(z.string()).max(4),
        /**
         * The headline figure, read from the catalogue. Null where the catalogue holds none.
         *
         * For a deposit account this is the whole question. Three savings accounts without
         * their rates look interchangeable when one of them pays a full point more.
         */
        rate: z.string().nullable(),
        /** The catch beside the rate — what it drops to, what the tier is. */
        rateNote: z.string().nullable(),
        /** The model's words: why this one is in front of this customer (§49). */
        reason: z.string(),
        /** Where it ends, when that is not self-serve — advice, underwriting, a credit check. */
        endsIn: z.string().nullable(),
      }),
    )
    .min(2)
    .max(4),
})

/**
 * How the customer's money should be split across several accounts, from the engine (§40).
 *
 * Distinct from `comparison`, which puts accounts side by side for the customer to choose
 * between, and from `product_options`, which offers kinds of thing. This is an arrangement:
 * this much here because it can be locked away, exactly this much there because that is what
 * the bonus costs, the rest where it earns most. Every figure is `arrange()`'s arithmetic on
 * published rates; the model passes nothing and the card reads nothing from it.
 *
 * One tap starts every account on it, through `select_products`, which is why each allocation
 * carries the journey product and the catalogue id separately: nine savings accounts share one
 * `savings` journey.
 */
export const arrangementCardSchema = z.object({
  type: z.literal('arrangement'),
  title: z.string(),
  allocations: z
    .array(
      z.object({
        product: z.enum(PRODUCTS),
        catalogueId: z.string().min(1).max(80),
        name: z.string(),
        amount: z.number().positive(),
        cadence: z.enum(['once', 'monthly']),
        termMonths: z.number().int().positive().nullable(),
        /** The rate as the card says it, e.g. "1.51% AER fixed for 6 months". */
        rate: z.string(),
        /** What this money is doing here, from the engine. */
        job: z.string(),
        watch: z.array(z.string()),
      }),
    )
    .min(2)
    .max(4),
  /** Twelve months of interest across the arrangement, at the rates as published. */
  firstYearInterest: z.number().nonnegative(),
  /** Stated separately from the interest, always: it is conditional. */
  bonus: z
    .object({ amount: z.number().positive(), conditions: z.array(z.string()).min(1) })
    .nullable(),
  notes: z.array(z.string()),
})

/**
 * What the customer was never asked, because the bank already knew (§53).
 *
 * The product's central claim, and until now the one thing it never showed. Starting
 * applications writes a `context_reused` event for every requirement satisfied by a fact that
 * was bank-held or captured earlier; this card is those events, read back from the database
 * with the fact's current value and where it came from. The model writes none of it.
 *
 * Something to read, not something to decide: it is not in `AWAITING_CARDS`, and a question
 * beside it competes with nothing.
 */
export const reuseCardSchema = z.object({
  type: z.literal('reuse'),
  title: z.string(),
  /** The applications that were started, in the order they were started. */
  started: z.array(z.string()).min(1),
  items: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        /** Formatted for a screen, and masked where the value is the kind that should be. */
        value: z.string(),
        /** Where the bank got it: the fact's source, for the pill's tone. */
        source: z.string(),
        /** The same, as the card says it. */
        provenance: z.string(),
        /** Which of the started applications it satisfied something in. */
        usedFor: z.array(z.string()).min(1),
      }),
    )
    .min(1),
})

/**
 * Three or more ways to do the same thing, with the trade-off visible (§51).
 *
 * Every figure is computed by the quote engine from the catalogue, never by the model. The card
 * is a conversation device rather than a product picker: choosing one asks Saoirse to explain it and
 * to keep asking how the customer intends to use and repay it.
 */
export const quoteCardSchema = z.object({
  type: z.literal('quote'),
  product: z.enum(PRODUCTS),
  displayName: z.string(),
  /** What the figures were computed from, so the card states its own assumptions. */
  basis: z.string(),
  options: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        highlight: z.string().nullable(),
        headline: z.object({ label: z.string(), value: z.string() }),
        figures: z.array(z.object({ label: z.string(), value: z.string() })),
        footnote: z.string().nullable(),
      }),
    )
    .min(1),
})

export const statusCardSchema = z.object({
  type: z.literal('status'),
  applications: z.array(
    z.object({
      id: applicationId,
      product: z.enum(PRODUCTS),
      displayName: z.string(),
      state: z.enum(APPLICATION_STATES),
      /** From the state machine, never from model text. */
      stateLabel: z.string(),
      outstandingCount: z.number().int().nonnegative(),
      waitingOn: z.enum(['primary', 'partner']).nullable(),
      /**
       * The journey's requirements in order, each with whether it is met. Built from the
       * requirement engine, so the card can show what is actually left rather than a count.
       */
      steps: z.array(
        z.object({
          label: z.string(),
          done: z.boolean(),
          waitingOnPartner: z.boolean(),
        }),
      ),
    }),
  ),
})

export const reviewCardSchema = z.object({
  type: z.literal('review'),
  applicationId,
  displayName: z.string(),
  /** Built from the case, not written by the model. */
  summary: z.array(z.object({ label: z.string(), value: z.string() })),
  /**
   * What the customer must agree to before this can be submitted: declarations, consents, and
   * values we already hold that they are asked to confirm are still right (§11, §48).
   */
  confirmations: z.array(
    z.object({
      requirementId: z.string(),
      label: z.string(),
      kind: z.enum(['declaration', 'confirmation', 'reuse']),
      /** For a reuse confirmation, the value being offered. */
      knownValue: z.string().nullable(),
    }),
  ),
  /** The tap that calls case-action. Until then nothing is submitted (§48). */
  confirmLabel: z.string(),
})

/**
 * The declarations the bank's own form requires, in the bank's own words.
 *
 * Six of them on the personal loan, covering credit reporting, the accuracy of what has been
 * said, consent to a credit reference check, and contact permission. They are not Saoirse's
 * wording and they are not summarised: the text here is the text in the published definition,
 * because a declaration somebody agreed to in a paraphrase is a declaration nobody agreed to.
 *
 * Shown rather than asked. The model cannot record one of these in conversation, however
 * plainly the customer says yes: `record_form_answers` refuses a checkbox field outright
 * (Invariant 1, §10 of the feature note).
 */
export const formDeclarationsCardSchema = z.object({
  type: z.literal('form_declarations'),
  applicationId,
  /** The bank's name for the form, so the card says what it belongs to. */
  formName: z.string(),
  declarations: z
    .array(
      z.object({
        /** The definition's own field id. */
        fieldId: z.string(),
        /** Exactly as published. Never shortened, never rewritten. */
        wording: z.string(),
      }),
    )
    .min(1),
})

/**
 * A document the bank's own form asks for, with the form's own limits.
 *
 * The accepted types and the size cap are read out of the published control rather than chosen
 * by us: `maxFileSize: 2` and `jpg, png, jpeg, pdf` are what the definition says, and enforcing
 * our own rule instead would mean accepting a file the real journey would reject.
 */
export const formUploadCardSchema = z.object({
  type: z.literal('form_upload'),
  applicationId,
  /** The row the file is attached to, which is also what authorises the upload. */
  formApplicationId: z.uuid(),
  fieldId: z.string(),
  /** The form's own words for the document. */
  label: z.string(),
  formName: z.string(),
  acceptedExtensions: z.array(z.string()),
  maxFileSizeMb: z.number().nullable(),
})

export const pausePromptCardSchema = z.object({
  type: z.literal('pause_prompt'),
  applicationId,
  displayName: z.string(),
  advisoryTitle: z.string(),
  advisoryExplanation: z.string(),
})

export const partnerInviteCardSchema = z.object({
  type: z.literal('partner_invite'),
  applicationIds: z.array(applicationId).min(1),
  applicationNames: z.array(z.string()).min(1),
  partnerName: z.string().nullable(),
})

export const uploadRequestCardSchema = z.object({
  type: z.literal('upload_request'),
  requestId: z.uuid(),
  applicationId,
  /** The journey's own words for this document, never the model's. */
  label: z.string(),
  /** The domain's list, so a type the engine can produce is one the card can carry. */
  documentType: z.enum(DOCUMENT_TYPES),
  /** Which application it is for, so a card in a long transcript still makes sense. */
  applicationName: z.string(),
})

/**
 * §7.5, Invariant 6 — the gate in front of anything sensitive.
 *
 * Health information is never inferred from adjacent financial data and never collected in
 * conversation. The customer is told exactly what will be asked and why, and nothing is asked
 * until they agree.
 */
export const consentCardSchema = z.object({
  type: z.literal('consent'),
  applicationId,
  requirementId: z.string(),
  title: z.string(),
  explanation: z.string(),
  /** Plain descriptions of what the questions cover, before any are asked. */
  covers: z.array(z.string()),
  confirmLabel: z.string(),
})

/**
 * The structured form itself — the ONLY route by which special-category data enters the case.
 * `record_facts` refuses every key here, so the model cannot write one however it is asked.
 */
export const healthFormCardSchema = z.object({
  type: z.literal('health_form'),
  applicationId,
  title: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: z.enum(['boolean', 'number', 'text_list']),
      unit: z.string().nullable(),
    }),
  ),
})

/**
 * §10 — the plan Saoirse is offering to keep, before the customer has agreed to it.
 *
 * Every figure is computed by the plan engine from the case, never by the model: a projected
 * date a customer acts on has to be one the bank can stand over (§40).
 */
export const planProposalCardSchema = z.object({
  type: z.literal('plan_proposal'),
  planId: z.uuid(),
  title: z.string(),
  /** What they are building towards, and where they are now. */
  targetAmount: z.number().nullable(),
  currentAmount: z.number().nullable(),
  projectedDate: z.string().nullable(),
  monthsRemaining: z.number().int().nullable(),
  milestones: z.array(z.object({ label: z.string(), achieved: z.boolean() })),
  checkin: z
    .object({ purpose: z.string(), when: z.string(), agenda: z.array(z.string()) })
    .nullable(),
  confirmLabel: z.string(),
})

/**
 * Published mortgage rates, for a specific customer and property.
 *
 * Every figure on it was selected by `selectRates` from the rate table, including which rows a
 * customer is entitled to see at all — the model supplies the four answers the table is indexed
 * by and nothing else (Invariant 3). `basis` is on the card so the assumptions are visible:
 * a rate is meaningless without the buyer type, the BER and the amount it was priced for.
 */
export const mortgageRatesCardSchema = z.object({
  type: z.literal('mortgage_rates'),
  title: z.string(),
  basis: z.object({
    buyerType: z.string(),
    ber: z.string(),
    amountEur: z.number().nullable(),
    termYears: z.number().nullable(),
  }),
  /** The date the bank's own table claims, not the date it was read. */
  asOf: z.string(),
  options: z
    .array(
      z.object({
        id: z.string(),
        /** "4 years fixed", "Variable". */
        label: z.string(),
        familyLabel: z.string(),
        ratePct: z.number(),
        aprcPct: z.number().nullable(),
        /** 2% of drawdown in euro, where the rate carries cashback and the amount is known. */
        cashbackEur: z.number().nullable(),
        cashbackNote: z.string().nullable(),
        monthlyEur: z.number().nullable(),
        note: z.string().nullable(),
      }),
    )
    .min(1)
    .max(4),
  /**
   * Each rate set against one the customer already has or has been offered, over the period
   * either rate is known for. The server's arithmetic from `compareSwitch`; the costs are the
   * bank's published ones, listed rather than deducted (case eb37e9b5).
   */
  comparison: z
    .object({
      against: z.object({ label: z.string(), ratePct: z.number(), monthlyEur: z.number() }),
      rows: z.array(
        z.object({
          optionId: z.string(),
          monthlyDifferenceEur: z.number(),
          overYears: z.number().int().positive(),
          repaymentDifferenceEur: z.number(),
          cashbackDifferenceEur: z.number(),
          netBeforeCostsEur: z.number(),
        }),
      ),
      costs: z.array(
        z.object({ label: z.string(), amount: z.string(), note: z.string().nullable() }),
      ),
    })
    .optional(),
})

/**
 * What happens to what the customer types, shown the first time Saoirse writes any of it down.
 *
 * A notice, not a consent. The basis for processing here is not the customer agreeing — it is
 * running the service they asked for — so the card informs and does not gate. Blocking the
 * conversation until somebody taps would be asking permission we do not need and have no way
 * to honour a refusal of. Special-category data is the opposite and already has its own gate
 * (§7.5, `consent`).
 *
 * The copy is fixed and built by the server. The model does not write it, cannot summarise it
 * and cannot decide when it appears (Invariant 2).
 */
/**
 * §28 — offered once, when there is something a sign-in would protect.
 *
 * Fixed copy from the server. The model cannot ask for this one.
 */
export const signInCardSchema = z.object({
  type: z.literal('sign_in'),
  title: z.string(),
  points: z.array(z.string()).min(1).max(4),
  reassurance: z.string(),
  whyHref: z.string(),
})

export const dataNoticeCardSchema = z.object({
  type: z.literal('data_notice'),
  title: z.string(),
  points: z.array(z.string()).min(1).max(5),
  /** Where the full notice lives. A hash route, so it opens in the same app. */
  noticeHref: z.string(),
})

/**
 * The account is open (§6 Stage 13, §41).
 *
 * The closing moment of a first account. The console marks the application complete, and the
 * customer's next turn, usually the one a push notification brings them back for, opens with
 * this before the model has said a word: the account's name, its number, where the debit card
 * is going and what to do next. Built by the server from the case; the model has no tool that
 * shows it and writes none of it, because an account number the model wrote would be one it
 * made up (Invariant 2).
 *
 * The number is synthetic and the card says so: a real IBAN shape, check digits that validate,
 * and a bank code no bank holds, so it can never be somebody's account (Invariant 10).
 *
 * Something to read, not something to decide: not in `AWAITING_CARDS`.
 */
export const accountOpenedCardSchema = z.object({
  type: z.literal('account_opened'),
  applicationId,
  displayName: z.string(),
  /** Spaced in fours for reading. Synthetic: see `domain/iban.ts`. */
  iban: z.string(),
  bic: z.string(),
  /** Where the debit card is addressed: the address on file, or null when none is held. */
  cardTo: z.string().nullable(),
  /** What to do with the account now, from the case: short enough to act on, never empty. */
  next: z.array(z.string()).min(1).max(4),
})

/**
 * A plan the customer made in their own AI and brought into the app (`market-plan.ts`).
 *
 * Built by the server from the stored plan, never by the model (Invariant 2), and shown once,
 * before Saoirse speaks, on the first turn after the claim link was opened: the same pattern as
 * the account welcome. Every figure is the plan's own; the card adds no arithmetic. Each
 * product carries where its figures came from and when they were checked, and what the data
 * does not say, because a plan read on a phone a week later is read without the conversation
 * that produced it.
 *
 * Something to read, not something to decide: not in `AWAITING_CARDS`.
 */
export const savedPlanCardSchema = z.object({
  type: z.literal('saved_plan'),
  planId: z.uuid(),
  title: z.string(),
  summary: z.string(),
  goals: z
    .array(
      z.object({
        label: z.string(),
        /** "€30,000 by June 2028", or null when the plan set no target. */
        target: z.string().nullable(),
      }),
    )
    .max(8),
  products: z
    .array(
      z.object({
        name: z.string(),
        providerName: z.string(),
        /** What it is doing in the plan: "Monthly saving", "Lump sum". */
        role: z.string(),
        /** "€500 a month", "€20,000 once", both, or nothing. */
        amounts: z.array(z.string()).max(2),
        /** "3.00% AER", or null. */
        rate: z.string().nullable(),
        /** The projection in one line, or null. */
        projected: z.string().nullable(),
        /** "CCPC, checked 9 Nov 2026" or "Bank of Ireland's site, checked 9 Nov 2026". */
        provenance: z.string(),
        unknowns: z.array(z.string()).max(20),
        checks: z.array(z.string()).max(10),
        url: z.string().nullable(),
      }),
    )
    .max(12),
  /** Payoff order, first first: "Car loan: pay off first. Costs more than savings earn." */
  debts: z.array(z.string()).max(20),
  /** The ranking basis, stated. */
  basis: z.string(),
  assumptions: z.array(z.string()).max(20),
  /** Attribution owed to a source the figures came from, once each. */
  attributions: z.array(z.string()).max(4),
  /**
   * For a home: the comparison they saw in their AI, the first three options in the order they
   * chose, and how many there were. Optional: plans saved before 2026-11-10, and plans with no
   * home goal, have none.
   */
  /** "€25k saved · €800/mo · €90k · €350k": their figures in one line (2026-11-10). */
  figures: z.string().optional(),
  comparison: z
    .object({
      headline: z.string(),
      sortedBy: z.string(),
      sortBy: z.enum(['five_year_cost', 'keys_date', 'monthly_repayment']).optional(),
      filters: z.array(z.string()).max(6),
      total: z.number().int().nonnegative(),
      options: z
        .array(
          z.object({
            lender: z.string(),
            kind: z.string(),
            rate: z.string(),
            monthly: z.string(),
            fiveYear: z.string(),
            keys: z.string().nullable(),
            confirmed: z.boolean(),
            /** The figure the comparison is sorted by, short: "€49,338 / 5 yrs", "€1,362/mo". */
            lead: z.string().optional(),
          }),
        )
        .max(3),
    })
    .optional(),
  /**
   * For a home: every route to a home the comparison carried, in its order (2026-11-10). The app
   * shows three, then "More routes (N)". Empty for other plans and for plans saved before then.
   */
  routes: z.array(planRouteSchema).max(6).default([]),
  /**
   * For a home: the host card's figures (the keys month, what the money at the keys is made of,
   * progress, the three tiles, the assumptions) and the hook question, as the app's arrival shows
   * them (2026-11-12). Optional: other plans, and plans saved before then, have none.
   */
  arrival: planArrivalViewSchema.optional(),
  createdAt: z.string(),
  dataCheckedAt: z.string(),
})

/**
 * How a products card is arranged, from the question the customer asked (the first-home
 * experience, "4. The conversation", 2026-11-12):
 *
 * - `held_vs_market`: their own account on top as the baseline, the market under it, by rate.
 * - `by_access`: instant access beside fixed term, the rate difference stated as the price of
 *   access.
 * - `fits_date`: the accounts that take this saving by the keys month, by the term that fits
 *   (more than six months away: the six-month terms), any bonus counted by the date.
 * - `mortgage_by_sort`: the lender options at their loan-to-value, by the sort they chose.
 */
export const MARKET_ARRANGEMENT_KINDS = [
  'held_vs_market',
  'by_access',
  'fits_date',
  'mortgage_by_sort',
] as const
export type ProductsArrangement = (typeof MARKET_ARRANGEMENT_KINDS)[number]

/** The most rows a products card shows; the rest are counted in `more`. */
export const PRODUCTS_CARD_MAX_ROWS = 8

/**
 * The product card that follows the question asked (`show_products`): the key facts of what the
 * customer asked about, from the whole market and their own figures, arranged by what the
 * question implies rather than a fixed default. Every row and figure is the engine's
 * (`domain/market/products-card.ts`); the model chooses the arrangement and writes nothing on it.
 *
 * Rows name providers and products: the comparison-not-pick line is about ranking and wording,
 * not anonymity. Every card names its arrangement and how to change it (`arrangement.line`) and
 * carries the basis statement (duty of care 2.4): the figures used, the ranking objective, the
 * assumptions, the coverage and the warnings.
 *
 * Something to read, not something to decide: not in `AWAITING_CARDS`.
 */
export const marketProductsCardSchema = z.object({
  type: z.literal('market_products'),
  /** The customer's question as understood, one line. */
  question: z.string(),
  arrangement: z.object({
    kind: z.enum(MARKET_ARRANGEMENT_KINDS),
    /** "Your account against the market", "Mortgage options at 90% loan-to-value". */
    title: z.string(),
    /** Names the arrangement and how to change it. */
    line: z.string(),
  }),
  rows: z
    .array(
      z.object({
        /** The product's id (`<provider>:<productId>`), or `held:<n>` for their own account. */
        id: z.string(),
        /** The provider and product, or "Your <account label>" for a held account. */
        lead: z.string(),
        /** The access or term: "instant access", "6-month fixed", "4-year fixed at 3.20%". */
        kind: z.string(),
        /**
         * The headline: "€1,751/mo", "3.11%"; a savings rate that ends before the date names its
         * end ("3.11% to 1 Jan").
         */
        value: z.string(),
        /** The money in their figures: "€815 by Jul 2028", "€49,338 over 5 years". */
        figure: z.string(),
        /**
         * One flag, or null: "then 1.51%; the money counts both", "rate for new accounts; how
         * long it holds is not stated", "rate from CCPC only; how long it holds is not stated".
         */
        note: z.string().nullable(),
        /** Their own account, the baseline. */
        held: z.boolean(),
        /** False where the rate or an incentive rests on CCPC's figure alone. */
        confirmed: z.boolean(),
      }),
    )
    .max(PRODUCTS_CARD_MAX_ROWS),
  /** Rows not shown; the customer can ask for them. */
  more: z.number().int().nonnegative(),
  /** The basis statement (duty of care 2.4). */
  basis: z.object({
    /** The figures used, listed back. */
    figures: z.array(z.string()),
    /** The objective the order uses, and how to change it. */
    objective: z.string(),
    assumptions: z.array(z.string()),
    /** Which products were searched, the source and the date checked, what is left out. */
    coverage: z.string(),
    /** The warnings that attach to what is shown; the statutory three on a mortgage card. */
    warnings: z.array(z.string()),
  }),
  /** Not regulated, no advice (`market/disclosures.ts`). */
  statement: z.string(),
})
export type MarketProductsCard = z.infer<typeof marketProductsCardSchema>

/**
 * Open banking, simulated (Nexus, a stand-in aggregator). Three cards.
 *
 * `connect_accounts` is the consent: the customer picks the bank and allows exactly the scope
 * listed. `accounts_overview` is something to read, built on the server from the linked rows.
 * `transfer` is a payment the customer initiates with a tap; nothing moves until they do.
 */
export const LINKABLE_BANKS = [
  { id: 'aib', name: 'AIB' },
  { id: 'ptsb', name: 'PTSB' },
  { id: 'revolut', name: 'Revolut' },
  { id: 'n26', name: 'N26' },
  { id: 'an_post', name: 'An Post Money' },
  { id: 'credit_union', name: 'Credit Union' },
] as const
export const LINKABLE_BANK_IDS = LINKABLE_BANKS.map((bank) => bank.id) as [
  (typeof LINKABLE_BANKS)[number]['id'],
  ...(typeof LINKABLE_BANKS)[number]['id'][],
]
export const CONSENT_SCOPE = ['balances', 'transactions', 'payments'] as const

export const connectAccountsCardSchema = z.object({
  type: z.literal('connect_accounts'),
  /** Why Saoirse is asking, tied to what the customer said. One line. */
  why: z.string(),
  banks: z.array(z.object({ id: z.enum(LINKABLE_BANK_IDS), name: z.string() })).min(1),
  scope: z.array(z.enum(CONSENT_SCOPE)).min(1),
  /** Days the consent runs for, as the consent screen states it. */
  consentDays: z.number().int().positive(),
})

export const linkedAccountSchema = z.object({
  id: z.uuid(),
  bank: z.string(),
  displayName: z.string(),
  accountType: z.enum(['current', 'savings']),
  /** Masked for a screen: the last four only. */
  ibanMasked: z.string(),
  balance: z.number(),
})

export const accountsOverviewCardSchema = z.object({
  type: z.literal('accounts_overview'),
  asOf: z.string(),
  accounts: z.array(linkedAccountSchema).min(1),
  /** This calendar month so far, across every linked account. */
  month: z.object({ moneyIn: z.number(), moneyOut: z.number() }),
  /** What arrives as pay, detected from the transactions. Null when nothing regular is seen. */
  salary: z.object({ amount: z.number(), employer: z.string(), lastOn: z.string() }).nullable(),
  /** The largest regular outgoings, detected. */
  regular: z.array(z.object({ label: z.string(), amount: z.number(), cadence: z.string() })).max(5),
  /** What is in savings-type accounts, the figure a transfer is offered against. */
  savingsHeld: z.number(),
})

export const transferCardSchema = z.object({
  type: z.literal('transfer'),
  fromAccountId: z.uuid(),
  fromLabel: z.string(),
  /** Null when the money lands in an account the customer already holds here. */
  toApplicationId: applicationId.nullable(),
  toLabel: z.string(),
  amount: z.number().positive(),
  cadence: z.enum(['once', 'monthly']),
  /** Why this amount, in the customer's terms. One line. */
  why: z.string(),
})

export const cardSchema = z.discriminatedUnion('type', [
  quoteCardSchema,
  planProposalCardSchema,
  consentCardSchema,
  formDeclarationsCardSchema,
  formUploadCardSchema,
  healthFormCardSchema,
  productOptionCardSchema,
  comparisonCardSchema,
  arrangementCardSchema,
  reuseCardSchema,
  statusCardSchema,
  reviewCardSchema,
  pausePromptCardSchema,
  partnerInviteCardSchema,
  uploadRequestCardSchema,
  mortgageRatesCardSchema,
  dataNoticeCardSchema,
  signInCardSchema,
  accountOpenedCardSchema,
  savedPlanCardSchema,
  marketProductsCardSchema,
  connectAccountsCardSchema,
  accountsOverviewCardSchema,
  transferCardSchema,
])

export type Card = z.infer<typeof cardSchema>
export type CardType = Card['type']

export const CARD_TYPES = [
  'quote',
  'comparison',
  'arrangement',
  'reuse',
  'plan_proposal',
  'product_options',
  'status',
  'review',
  'pause_prompt',
  'partner_invite',
  'upload_request',
  'consent',
  'form_declarations',
  'form_upload',
  'health_form',
  'mortgage_rates',
  'data_notice',
  'sign_in',
  'account_opened',
  'saved_plan',
  'market_products',
  'connect_accounts',
  'accounts_overview',
  'transfer',
] as const satisfies readonly CardType[]

/**
 * Cards that are waiting for the customer to do something.
 *
 * A card that asks for a tap is the question of that turn, and a turn is allowed one question.
 * Saoirse was putting a comparison of two savings accounts on screen and, in the same breath,
 * asking what the customer paid in rent and whether they banked jointly — so the reply could
 * answer the text or answer the card, but not both, and whichever they did the other was left
 * hanging. The customer rightly read it as being asked three things at once.
 *
 * Listed rather than derived, and exhaustively, so that a new card type has to be thought
 * about here rather than defaulting into the quiet half. The quiet half is genuinely quiet: a
 * status, a quote's figures, published rates and the data notice are things to read, and a
 * question alongside them competes with nothing.
 */
export const AWAITING_CARDS = [
  'comparison',
  'arrangement',
  'plan_proposal',
  'product_options',
  'review',
  'pause_prompt',
  'partner_invite',
  'upload_request',
  'consent',
  'form_declarations',
  'form_upload',
  'health_form',
  'quote',
  'sign_in',
  'connect_accounts',
  'transfer',
] as const satisfies readonly CardType[]

const AWAITING: ReadonlySet<string> = new Set(AWAITING_CARDS)

/**
 * Whether this card is waiting on the customer, and therefore owns the turn.
 *
 * Takes a plain string rather than a `CardType`, because the places that need to ask have a
 * card they have not narrowed yet, and a cast to make the signature fit would be a lie told to
 * the compiler to avoid one honest set lookup.
 */
export function awaitsCustomer(type: string): boolean {
  return AWAITING.has(type)
}

/**
 * A card as stored, read into today's shape before it is parsed: a `saved_plan` card stored
 * before 2026-11-12 carries arrival tiles of `{ label, value, lines }` (`upgradeStoredArrival`).
 * Anything else passes through untouched.
 */
export function upgradeStoredCard(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const card = raw as Record<string, unknown>
  return card['type'] === 'saved_plan' && card['arrival'] !== undefined
    ? { ...card, arrival: upgradeStoredArrival(card['arrival']) }
    : raw
}
