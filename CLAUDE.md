# CLAUDE.md: Saoi backend (assistant: Saoirse) Conversational Banking POC

## What this is

Naming: everything is `saoi` (repo `chris-88/saoi`, `saoi-api`, `SAOI_*`, `--saoi-*`); `saoirse` is only the assistant as a persona (`Saoirse*`; the chat UI is `src/saoirse/` in saoi-web). The `baz` left in this repo is the pooler tenant and sender noted in the infra README. The assistant is stored as `assistant` (`messages.role`, `assistant_usage` in catalogue products); the MCP server lives in its own repo.

**This repo is the backend.** Since 2026-11-09 (cutover step 8) the browser apps are their own repos:

| Repo                     | What                                                                                                                                              | Where                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `chris-88/saoi` (this)   | `saoi-api` (`services/api`), migrations and seed, `supabase/functions/_shared` (domain, contracts, prompts, tenants), evals, `supabase/templates` | `https://api.saoi.ie`, built by `~/code/infra/stacks/saoi-api/redeploy-api.sh` |
| `chris-88/saoi-web`      | the Saoirse chat, partner join, ask, privacy; PWA and push                                                                                        | `https://app.saoi.ie`                                                          |
| `chris-88/saoi-admin`    | the presenter console                                                                                                                             | `https://admin.saoi.ie`                                                        |
| `chris-88/saoi-showcase` | showcase, explainer, article                                                                                                                      | `https://showcase.saoi.ie`                                                     |

The apps call `saoi-api` through a client generated from `https://api.saoi.ie/api/openapi.json`
(`npm run api:generate` in each), and keep copies of the `_shared` files they import in
`src/shared/` (`npm run shared:sync` / `shared:check`, reading a checkout of this repo). A change to
a route or a contract here is finished when both apps have regenerated and synced.
`supabase/templates/sign-in-link.html` stays at that path: the auth stack loads it from GitHub.

Saoirse is a conversational orchestration layer over simulated retail banking product journeys for a fictional Demo Bank. The customer says what they are trying to do. Saoirse discovers needs, the customer chooses products, facts are collected once and reused across concurrent applications, and the case persists across channels, sessions, a partner and time.

Source of truth, in `vault/docs/`:

- `03-saoi-poc-requirements.md`: the spec. Cite sections as §N.
- `01-conversational-banking-poc-vision.md`: intent and tone.

Where they conflict, the requirements doc wins. Both were always gitignored (the repo is public) and
both are still retrievable from the public git history - see
`vault/docs/security/public-repository-review.md`.

The whole documentation tree moved from `docs/` to `vault/docs/` on 2026-10-20, and `vault/` is
gitignored: the docs are local only from that commit on, but every version committed before it
remains in the public history. `vault/` is also an Obsidian vault; `relationship-banking.md` at its
root is the one copy of the white paper draft, and `writing-style.md` is how anything in Chris's
voice should read.

`vault/docs/README.md` is the map of everything else. This file is the operational summary; where it
and a document under `vault/docs/` disagree, check the code - this file has been the stale one before.

The only test that matters is §67: a customer comes for a mortgage, Saoirse discovers the wider life event, the customer picks products, facts are reused across applications, the customer moves from public web to the app without restarting, the spouse joins separately and advances several applications, the personal loan is deliberately held, the customer leaves, the bank moves, a notification arrives, the customer returns and Saoirse knows exactly what changed.

## Priorities

When trading off, follow §63 in order: persistent context, natural conversation, domain restriction, multi-application orchestration, reuse, state integrity, public-to-app continuity, confirmation, partner, return, notification, admin, persona, audience QR, visual polish.

- Weak orchestration with perfect visuals is a failed POC.
- Do not build production infrastructure because production would need it.
- Do not fake orchestration to improve polish.

## Stack

Standard prototyping stack. Do not add frameworks or services outside it without asking.

| Concern       | Choice                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Service       | `saoi-api`: Node 24, Hono, `@hono/zod-openapi` (the OpenAPI document the apps generate from)                                  |
| Validation    | Zod at every boundary; contracts in `_shared/contracts`                                                                       |
| Backend       | Supabase, self-hosted (stack `saoi` in `~/code/infra`): Postgres, RLS, Auth (anonymous + email for admins), Realtime, Storage |
| LLM           | Anthropic API, called only from `saoi-api`                                                                                    |
| Notifications | Web Push (RFC 8291/8292), hand-written in `saoi-api`. Twilio was never built                                                  |
| Tests         | Vitest (shared domain here, routes in `services/api`)                                                                         |
| Monitoring    | **`saoi-api` has none**: failures surface as `events` rows and service logs. Browser Sentry lives in the apps                 |
| Hosting       | `saoi-api` in Docker behind the Cloudflare Tunnel; the apps on GitHub Pages from their repos                                  |

Models are env-configured. Defaults: `SAOI_MODEL=claude-sonnet-5-5`, `GATE_MODEL=claude-haiku-4-5-20251001`.

## Architecture

```
Browsers
  saoi-web    https://app.saoi.ie     Saoirse, /ask, /privacy, /join/:token, PWA and push;
                                       /admin/* redirects to admin.saoi.ie
  saoi-admin  https://admin.saoi.ie   the presenter console, email sign-in
    writes and reads: saoi-api only (https://api.saoi.ie), generated client
    auth:             supabase-js against the stack; the console also uses Realtime under RLS

saoi-api, services/api (Node, Hono; service role; holds ANTHROPIC_API_KEY, VAPID keys, PRESENTER_KEY)
  turns         gate -> Saoirse model with tools -> SSE stream -> persist
  cases/*       UI-committed actions: select products, submit, pause/resume,
                consent, invite partner, upload complete; documents; snapshot,
                history and change-feed reads
  session       anonymous start, case listing and switching, participant claiming
  plans         POST /api/plans (public: the MCP saves a plan, gets a one-time link);
                POST /api/plans/claim (the app opens it into a conversation)
  partner       join via invite, scoped DTO reads, partner task submission
  admin         simulate events, send notification, reset, persona/domain
                config, case inspection, metrics

Postgres
  34 tables. Core: cases, participants, participant_sessions, customers
  (synthetic bank-held), facts, messages, events, consents, tokens.
  Applications: applications, application_requests, application_confirmations,
  documents, product_interests.
  Plans and discovery: plans, plan_milestones, plan_checkins, plan_watches,
  need_decisions, saved_plans (plans made in the customer's own AI).
  Forms: form_applications, form_answers.
  Config and ops: persona_config, domain_config, catalogue_overrides,
  product_catalogue, mortgage_rates, market_products,
  admin_users, push_subscriptions.
  Open banking, simulated: linked_accounts, linked_transactions, transfers.
  Feedback and collaborators: feedback, collaborators.
  Evidence: calculator_runs (one anonymous, banded row per home-calculator run).
```

### A Saoirse turn (`POST /api/cases/:caseId/turns`)

1. **Load** the case: facts, applications, outstanding requirements (computed, not remembered), advisories, product interests including declined ones, persona, domain config.
2. **Gate** the latest message, with the previous Saoirse turn as context so short answers ("about 92k", "yes", "Emma") classify correctly. Out of scope: canned response, `request_blocked` event, stop. The Saoirse model never sees blocked input.
   2b. **Compute the stage** from the case: `opening`, `direction`, `discovering`, `planning`, `arranging`, `choosing`, `applying`. Ordered, first match wins, never stored and never chosen by the model, so correcting a fact moves the conversation back by itself. The stage decides the guidance, the declared reply length, and which tools the turn is offered (§6, §63).
3. **Generate** with the system prompt in fixed order: policy (immutable) → domain → product catalogue → persona style → case digest. Stable prefix first for prompt caching. Stream over SSE.
4. **Persist** messages, validated facts and events. Recompute requirements.

## Invariants

Never weaken one of these to make a demo step work. Fix the data or the flow instead.

1. **The model proposes, the UI commits.** The model has no tool that creates, submits, pauses or resumes an application, grants consent, invites a partner or makes a declaration. It renders a card; the customer's tap calls the case action route, which validates session access, state, required information and business rules (§27, §48).
2. **State comes from the database.** Every status Saoirse states must appear in the case digest built from controlled data (§14). Status cards render from the DB independently of model text. Saoirse reports an action only after the case action route confirms it (§59).
3. **What is outstanding is computed.** `outstanding(journey, facts)` in `_shared/domain` decides what an application still needs. The model decides only how to ask (§8).
4. **The gate is enforcement.** Domain restriction is a classifier plus deterministic checks in front of the model, not a prompt instruction (§25). Blocked responses are short and never contain the answer (§26).
5. **Persona is style only.** Persona composes into a labelled style block after policy. It cannot change scope, tools, rules or protections (§18). Sensitive turns force humour, sarcasm, playfulness and poetic to zero.
6. **No sensitive inference.** Protection health data is collected only through an explicit structured form with consent. `record_facts` rejects any fact marked `extractable: false` (§7.5, §11).
7. **Partner isolation.** The partner never reads tables directly. the partner routes return scoped DTOs: their own tasks, their own facts, the names and states of applications they are party to. Never the primary's conversation or facts (§33).
8. **Nothing sensitive in URLs.** Links carry opaque tokens: 128-bit random, stored hashed (§29, §58). Handoff codes and notification links are single-use with a short TTL, consumed on redemption. The partner invite is the exception: it neither expires nor is used up, because the second applicant opens it when they get to it and on whichever phone they have; inviting again voids every earlier link for any browser that has not already joined.
9. **Everything significant writes an event.** Every item in §52 is an `events` row with actor (`customer | partner | model | admin | system`). Metrics are derived from events.
10. **Synthetic data only.** No real credentials, no real Demo Bank auth, no real customer data. The simulated login accepts anything and says so.
11. **Saoirse is portable.** `_shared/domain/**` here and `src/saoirse/**` in saoi-web never import from `_shared/tenants/demo/**`. Tenant config is injected. Enforced with ESLint `no-restricted-imports` (§32).

## Domain model

All domain logic is pure TypeScript in `supabase/functions/_shared/domain/`, imported by `saoi-api` (`@shared` alias) and copied into saoi-web and saoi-admin (`src/shared/`, `@domain` alias). No Node or browser APIs in this folder. The only third-party import allowed is bare `zod`, pinned to the same major version in the apps and the service.

### Facts

A fact is a typed value about a subject, with provenance.

```ts
type Fact = {
  key: FactKey // from the catalogue, never free text
  subject: ParticipantId | 'household'
  value: unknown // validated by the catalogue schema for key
  source:
    | 'customer_stated'
    | 'partner_stated'
    | 'bank_held'
    | 'document_extracted'
    | 'document_verified'
    | 'system_derived'
  verified: boolean
  capturedFor: ApplicationId | null // used for questions-avoided
  supersededBy: FactId | null
}
```

The catalogue (`facts.ts`) defines each key once:

```ts
'income.annualBasic': {
  schema: z.number().int().positive(),
  subject: 'person',
  reuse: 'confirm',          // auto | confirm | fresh | never
  sensitivity: 'standard',   // standard | special
  extractable: true,
},
```

Person-specific data is handled by `subject`: the primary's income never satisfies the partner's income requirement.

### Journeys

One file per product in `journeys/`, translated from the recordings (§8). Each requirement references a fact key or is a declaration, document or confirmation. Per-requirement reuse policy overrides the catalogue default.

```ts
export const creditCard = defineJourney({
  product: 'credit_card',
  status: 'draft', // 'draft' until matched to recording
  source: 'recording: <file> @ mm:ss',
  requirements: [
    { id: 'address', fact: 'identity.address', subject: 'primary', reuse: 'confirm' },
    { id: 'income', fact: 'income.annualBasic', subject: 'primary' },
    { id: 'declaration', kind: 'declaration', fresh: true },
  ],
  branches: [/* conditional requirements */],
})
```

Products: `mortgage`, `joint_account`, `credit_card`, `personal_loan`, `protection`,
`current_account`, `savings` (§7). Seven journeys, all `status: 'draft'`.

Which current account is decided from facts, not by the model: `tenants/demo/current-accounts.ts`
picks golden years, third level, graduate, basic or personal in that order from date of birth,
employment status, `education.graduatedYear` and `banking.holdsIrishPaymentAccount`, citing the
pack's own eligibility and fee lines. The pick goes into the digest while the `everyday_banking`
need is live, and `show_product_options` swaps whatever current account the model named for it
(`product_swapped` event). The onboarding use case this serves is `vault/docs/journeys/onboarding.md`.

### Application state machine

`state-machine.ts` holds the transition table. The only path to a state change is `transition(app, event)`, called from saoi-api. Clients cannot update `applications`.

States (§13): `not_started`, `in_progress`, `waiting_customer`, `waiting_partner`, `ready`, `submitted`, `under_review`, `info_required`, `approved`, `declined`, `paused`, `completed`. `paused` stores `resumeTo`. `ready → submitted` requires a customer confirmation from the review card.

### Advisories

Deterministic rules in `advisories.ts`, not model judgement. Required: `loan_vs_mortgage` fires when a personal loan is progressing while a mortgage is active. Saoirse explains; the advisory card offers Pause or Continue (§6 Stage 8).

### Questions avoided

A requirement satisfied by a fact that was bank-held or captured for a different application writes a `context_reused` event. The metric is the count (§53). Pure function, fully tested.

### Product catalogue

`_shared/tenants/demo/products.ts`: names, plain-language descriptions, eligibility notes, illustrative terms clearly marked synthetic. Saoirse states product details only from this catalogue (§51).

The knowledge base the prompt is built from (`kb-prompt.ts`) and the mortgage rate table (`mortgage-rates-select.ts`) take their data as an argument. Every turn reads `product_catalogue` and `mortgage_rates` at the start (`_shared/db/catalogue.ts`) and passes the rows in when there are any, the compiled files when there are none. The console's Products & rates screen loads the files into rows, then edits, adds, switches off and restores them; each payload is validated against the file's own shape (`contracts/catalogue.ts`) on the way in, and a row is re-validated on the way out, so Saoirse can be handed a different catalogue but never a malformed one. A write to an empty table copies the file in first, so one edited product never becomes the whole catalogue.

### Market data

What providers publish about their products, from two sources, side by side with their own
history (`market_products.source`):

- `bank`: the provider's own website, deep: the rates, limits and bonus conditions the savings
  engine reasons on. Bank of Ireland's six savings and deposit products
  (`_shared/market/boi-sources.ts`, parsers in `scripts/market/boi.ts`), and bunq's savings
  account (`scripts/market/bunq.ts`), whose 3.11% is a bonus until the next 1 January or 1 July
  and then only above a threshold: stored as `rates.thresholdBonus`, modelled month by month.
  MoCo's EasySaver (`scripts/market/moco.ts`, the savings page plus its FAQ via `alsoRead`):
  2.1% variable for new accounts, and who can open it (`conditions.eligibility`: over 18,
  resident in Ireland, not a US citizen, individuals, no joint accounts), daily interest
  (`conditions.interestPaid`), `conditions.rateForNewAccounts`, DIRT deducted by MoCo
  (`conditions.dirtAtSource`, so no "a bank abroad may not take DIRT" check). The view carries
  `eligibility` and states it in `checks` instead of "check eligibility". EBS, AIB and PTSB
  refuse automated requests at their edge (Akamai 403, even on robots.txt) and State Savings
  serves a bot challenge (Radware), all on 2026-11-09: not read, and the client is not
  disguised to get past them. CCPC regular savers that say their rate is fixed for N months
  (an introductory offer, or a "(Fixed)" name with a minimum savings period: EBS Family
  Savings) are stored with `fixedMonths` and the reversion unknown, so figures stop there.
- `ccpc`: the Competition and Consumer Protection Commission's comparison tables, broad: every
  provider CCPC lists, in savings, deposits, mortgages, loans, credit cards and current accounts
  (`scripts/market/ccpc.ts`, read from the JSON API behind ccpc.ie at compare.ccpc.ie). Rows
  carry CCPC's attribution, CCPC's product id, CCPC's prose and every field it states verbatim
  (`conditions.prose`, `conditions.details`), and name what CCPC leaves out in `unknown`. CCPC's
  terms ask for written approval before commercial use of comparison data; the prototype uses it
  attributed, approval to be sought once there is revenue (decision 2026-11-09).

`provider` is always the bank (`boi`, `aib`, `ptsb`); CCPC's names map in
`scripts/market/ccpc-providers.ts`, and an unknown name gets a generated id and a `NEW PROVIDER`
line in the refresh output. Shapes in `_shared/market/schema.ts`: `rates` is a union on `kind`
(`deposit`, `mortgage`, `loan`, `credit_card`, `current_account`).

- **Stored** as versioned rows: a changed record supersedes the current row and inserts a new
  one, an unchanged one moves `checked_at`. `market_record_refresh(provider, source, ...)` writes
  one provider from one source in one transaction. `_shared/market/<provider>.snapshot.ts`
  (generated, Bank of Ireland, bunq and MoCo) are the bank-direct fallback when the table is empty;
  a turn's fallback takes Bank of Ireland's only. CCPC has no snapshot.
- **Refreshed** by `npm run market:refresh` (dry run and diff), `-- --snapshot`, `-- --db` (needs
  `SUPABASE_URL=http://127.0.0.1:8002` and the service role key from
  `pass show infra/saoi/SERVICE_ROLE_KEY`), `-- --provider boi`, `-- --source ccpc`. Weekly by the
  `market-refresh` timer in `~/dotfiles`. robots.txt first on every host (a 4xx is "no
  restrictions" under RFC 9309). All or nothing per provider and source; a failed CCPC request
  writes nothing from CCPC; exit 1 if anything failed. It ends with CCPC row counts and a
  cross-check of Bank of Ireland's own pages against CCPC (`scripts/market/crosscheck.ts`);
  differences are warnings.
- **Read** on a turn: only Bank of Ireland's own rows (`loadMarket`), laid over the catalogue by
  `withMarketData`: `rateOf`, the savings engine and the deposit-stack combination take every
  figure from them. Other providers and every CCPC row stay out of turns. The console's Market
  data screen shows all of it.
- **Compared** by the public comparison API (below), which reads every row.

### The comparison engine and its public API

The engine behind the Saoi MCP tools, in `_shared/domain/market/` (pure; contracts in
`contracts/market-tools.ts`), served by saoi-api without sign-in:

| Route                                      | MCP tool                  | What                                               |
| ------------------------------------------ | ------------------------- | -------------------------------------------------- |
| `POST /api/market/search`                  | `saoi_search_products`    | rank one category for the caller's figures         |
| `GET /api/market/products/{id}`            | `saoi_product`            | the view, rate history, the source's words         |
| `GET /api/market/about/{ranking,earnings}` | resources                 | how Saoi ranks; how Saoi earns                     |
| `POST /api/calc/review-situation`          | `saoi_review_situation`   | findings with euro figures, candidate goals        |
| `POST /api/calc/savings-projection`        | `saoi_savings_projection` | month by month, net of DIRT                        |
| `POST /api/calc/mortgage`                  | `saoi_mortgage`           | affordability (Central Bank limits) or switch      |
| `POST /api/calc/debt`                      | `saoi_debt`               | cost, payoff order, overpay versus save, refinance |
| `POST /api/calc/build-plan`                | `saoi_build_plan`         | a `MarketPlan` for `POST /api/plans`               |
| `POST /api/calc/first-home`                | `saoi_first_home`         | Help to Buy, CB limits with it, green rates        |
| `POST /api/calc/home`                      | `saoi_home_calculator`    | the home calculator: limits, deposit, date, routes |
| `POST /api/calc/money-check`               | `saoi_money_check`        | the entry: review, plan or questions, link         |

- **Normalised** (`normalise.ts`): one view per product. CCPC's one-row-per-term fixed deposits
  fold into ladders; bank-direct rows (Bank of Ireland, bunq, MoCo) replace their CCPC twins by the pairing in
  `_shared/market/bank-ccpc-pairs.ts`; only providers that operate in Ireland are compared
  (Raisin's platform banks are dropped here, their rows kept; Chris, 2026-11-09); every view
  carries source, checked, last changed (from history), attribution, unknowns and eligibility
  checks, and a deposit its guarantee: `_shared/market/deposit-guarantees.ts` records the scheme
  and limit per provider from primary pages (provider depositor sheets, the Central Bank
  register, depositguarantee.ie), each with its source URL and checked date; a provider not
  recorded there falls back to the scheme CCPC's text names, and otherwise stays unknown and is
  flagged. Re-read the record when a provider is added or changes licence.
- **Alternatives** (`plan.ts`, after test 5): `alternatives` (up to three named variations: a
  buffer, a debt's plan, the monthly amount, the goal's date or target, a home price) are worked
  out in the same build-plan or money-check call, each returning its own position and one
  comparison line in the presentation. Hosts call one of the two tools once per reply and compare
  options through this, not by calling again.
- **Assumed repayments** (`plan.ts`, Chris 2026-11-09): a non-mortgage debt with a balance and
  rate but no repayment or months left is modelled as repaid in equal monthly instalments over
  the plan's horizon, so clearing and keeping are both worked out and the saving counts in money
  found. `assumedRepayments` lists each; its note leads the presentation after the position, sits
  in the assumptions and `next`, and the first question asks for the actual repayment. The plan's
  situation keeps what the customer said (no repayment is written in).
- **Plans** (`plan.ts`): the emergency buffer is an amount, months of outgoings, or an
  `emergency_fund` goal, held apart in instant access. The debts and the split run twice, with
  terms allowed and with everything in instant access; a term is used only where it leaves at
  least `minLockGainEur` (default €100) and `minLockGainPctPerYear` (0.25%) more by the goal date,
  and never with `keepAccessible` or `goalDateCertain: false`. `liquidity` states the decision with
  both figures; `whatIf` gives an extra €100 a month, each debt cleared or kept, and the month a
  target is reached, every line starting "What if"; a cleared debt's repayment is saved and the
  reasoning says so. Each debt takes `plan`: `compare` (default), `keep` or `clear`; keeping a
  debt is modelled by keeping it in the call, never by dropping it. A debt with no repayment or
  months left counts today's balance as still owed (the most it can be) and is not compared.
  `position` (and `plan.position`, first in `plan.assumptions`) is everything held at the end,
  towards the goal plus the buffer, less what is still owed, with the parts named; every net
  figure includes the buffer, and with no debts given the line says so instead of "net". Review
  and plan results carry `next`, the offer to save for the host to relay; a plan also carries the
  money check's `questions`, so build_plan and money_check present the same for the same input.
- **Money check** (`money-check.ts`): the one-call entry (Chris, 2026-11-09: "connect it and
  just talk"). Takes whatever the customer has said, however partial; returns the review, a plan
  when there is money to place (for "the savings held, no date" when no goal was given, stated in
  `planGoalAssumed`), up to three questions that would sharpen it, the presentation, and the
  24-hour save link. The granular tools are for follow-ups.
- **Held rates** (`held-rates.ts`, after the fourth Claude test): money in a current account
  (`access: 'current_account'`, or a "current account" label with no access given) and no rate
  given earns what CCPC's current-account table states (the provider's row, else 0% when every
  stated rate is 0%), with the basis in `moneyFound.basis` and a line in its headline. A savings
  account without a rate stays unknown.
- **Compare, never pick** (decision `2026-11-10-saoi-compare-with-customer-filters`): no
  result picks a product, lender or combination for the customer. `MarketPlan.combination`
  (was `recommendation`; `upgradeStoredPlan` reads old stored plans) is the worked combination
  under the stated rule, with `runnersUp` beside it; home options are every eligible option,
  filtered by `homePreferences` (stay with my bank, fixed or variable, green) and sorted by
  `sortBy` (`five_year_cost`, `keys_date`, `monthly_repayment`), each filter stated
  ("Showing Bank of Ireland options, as you asked."). Every result closes with the statement
  in `_shared/market/disclosures.ts` (not regulated by the Central Bank of Ireland, no advice);
  mortgage results carry the three statutory warnings; `adviceWordsIn` is the test for wording.
  The home calculator (`home-calculator.ts`, `POST /api/calc/home`) returns the limits, the
  cash at the keys and the month it is saved, the missing inputs as questions, and `rules` so
  the MCP calculator card recomputes as sliders move.
- **Options for a home** (`pathways.ts`, Chris 2026-11-10): for a house-deposit goal, `home`
  compares lenders end to end: the price (given, or what the savings by the date support at 90%
  LTV, capped by 4 times income when given), the cash needed at the keys (deposit plus 1% stamp
  duty and a €3,000 legal and survey estimate, less Help to Buy for a new build), each lender's
  cheapest first-time-buyer mortgage at that LTV over the first 5 years (Chris, 2026-11-10:
  interest on a 30-year term plus the valuation fee, a shorter fix moving to its follow-on rate,
  less cashback paid within 5 years; later cashback is listed, not ranked; the 30-year figure is
  secondary, "if today's follow-on rates held"), its cashback and linked
  savings bonus (`_shared/market/mortgage-incentives.ts`, with conditions, source and
  `confirmed`), ranked by cost, with the keys month beside it. A new build is taken as BER A
  (green rates, Help to Buy); otherwise standard rates and BER C where a lender prices by BER.
  First-time buyer is assumed when no home is mentioned. Every assumption is stated in one line.
  High-value rates count when the loan reaches the minimum the source states (`terms.minLoanEur`,
  parsed from "borrowing €250,000 or more"); where it does not state one, the rate counts and the
  option says to check it. Each lender's option per rate type and fixed period is its product
  with the lowest cost net of cashback (`considered` lists the runners-up). The refresh ends with a data check
  (`scripts/market/mortgage-check.ts`): each lender's lowest first-time-buyer rate, and a CHECK
  where a reference pathway's pick is more than 0.25 points above the lender's lowest eligible rate.
  The BoI MortgageSaver bonus is paid after drawdown (its brochure), so it lowers cost, not the
  deposit; cashback is always cost.
- **Bundles, the next question, the save call** (Chris, 2026-11-10): each pathway lists what
  would be held with that lender (`bundle`: its linked saver, its own regular saver where the
  split uses one, the mortgage, the cashback) and states that none is recorded as needing a
  current account with the lender.
  `nextQuestion` is worked out in `next-question.ts`: each unanswered input (income, new build
  or second-hand, price, a debt's repayment, the current account's bank) is run across a few
  plausible answers, scored in euro on the goal (the spread in the price that can be bought, keys
  months × monthly saving, what is held, and cost per €100,000 borrowed; never the absolute cost
  of a bigger home, and not the price when the price is what is asked), and the
  largest is asked; the rest are `laterQuestions`. The presentation ends with that one question.
  `completeness` counts answered and assumed inputs; `saveCall` is always "Save this comparison"
  (`ready` once, for a home, income and the kind of home are known) and lists what the app does
  today and what is coming (never offered as available).
- **Money found** (`money-found.ts`): review and plan results lead with `moneyFound`, one euro a
  year in parts (idle cash against the best confirmed instant-access rate after DIRT, debt
  interest not paid less what the money would earn, a mortgage switch at a band reaching 90% LTV,
  no green rate), each with its source and checked date. A rate resting on CCPC's one figure, a
  current rate not given, bonuses and cashback are shown in `notCounted`, never in the total.
- **First home** (`first-home.ts`): the rules live in `_shared/market/first-home-rules.ts` with
  their Revenue and Central Bank pages and dates (Help to Buy cap €35,000 for applications from
  7 October 2026, to 31 December 2029; LTI 4 and 3.5, LTV 90%, 15% allowances). The review adds a
  `help_to_buy` finding and the plan's affordability adds Help to Buy for a first-time buyer.
- **Routes to a home** (`routes.ts`, decision `2026-11-10-saoi-routes-card`): the home
  calculator and first-home results carry `routes`, every way to a home as a fact: second-hand
  and a new build with Help to Buy (each with a keys date from `home-arithmetic.ts`, the same
  arithmetic as the headline), the First Home Scheme, the Local Authority Home Loan, affordable
  purchase from a council and the Vacant Property Refurbishment Grant. Each is `potential`,
  `needs_one_detail` (with `missing`, one plain question) or `not_applicable` (with `reason`),
  with a line of about 90 characters, its conditions, `confirmed` and dated sources. Order: the
  customer's own kind of property, then by status; no route is best, fastest or recommended.
  Presentations show three route lines right after the headline, then "More routes: N". The
  scheme rules were read 2026-11-10 (header of `first-home-rules.ts`: firsthomescheme.ie,
  localauthorityhomeloan.ie, newstarterhomes.ie and two councils, as gov.ie and
  citizensinformation.ie refused automated reads; the grant's build year is unconfirmed). On a
  new build with tax paid not given, the calculator's headline leaves Help to Buy out
  (`helpToBuyConditional`) and the new-build route carries the keys date if tax paid covers it.
  The first-time-buyer default is named in `assumed`. Rent a month (`monthlyRentEur`) is an
  optional input that changes no figure: first-home sets it beside the options' repayments
  (`rentVsRepayment`), and the calculator asks it last, marked `optional`.
- **Calculator runs** (`run-bands.ts`, `calculator_runs`): each `POST /api/calc/home` writes one
  anonymous row after responding (fire and forget; a failure is logged, never returned): the day,
  income band, months-to-the-keys band, target met, county (only from the fixed list in
  `_shared/market/areas.ts`), rent band, kind of property, first-time buyer. No figures, no
  identifiers, no IP, no free text. Service-role only; nothing reads it yet. Build-plan, money
  check and plan previews write nothing.
- **Rules** that hold everywhere: DIRT at 33% except DIRT-free products; interest credited
  yearly; an unknown is never zero and never assumed to hold, so a fixed term or an introductory
  rate with no stated reversion ends the figures there and says so; bonuses are never interest;
  ranking objective stated in every result; no "you should" in any text returned. A savings or
  deposit rate resting on CCPC's one figure (no provider page read, no stated reversion) is
  `rateConfirmed: false` and flagged when it ranks in the top three, and in plans and
  projections, until a bank-direct row confirms it.
- **Limits**: per address (`CF-Connecting-IP`, then `X-Forwarded-For`) 120 a minute, bodies 32
  KiB. The market is read whole (paged) and held ten minutes (`store/market.ts`).

### Plans from the customer's own AI

The MCP tools (`saoi-mcp`) build a plan in the customer's own assistant. `POST /api/calc/build-plan`
holds every plan it builds as a 24-hour draft in `saved_plans` (client `draft`) and returns
`saveLink` ("Save this plan to the Saoi app: <link>"; Chris, 2026-11-09, after the second Claude
test); `saoi_save_plan` (`POST /api/plans`) still saves one for hosts that call it. The document is
`_shared/contracts/market-plan.ts` (`MarketPlan`, version 1; a worked example in
`market-plan.example.ts`): situation, goals, the products with provider, source, product id,
amounts, projections and unknowns, the payoff order, the ranking basis, assumptions,
`createdAt` and `dataCheckedAt`. Unknown keys are stripped, so the engine can add fields first.

- **Stored** in `saved_plans`, not `plans`: it exists before any case and holds several goals.
  Service-role only. The token is 128 bits, base64url, stored as its SHA-256, single use, 24
  hours (Invariant 8). Unopened plans are deleted by `sweep_saved_plans()`: hourly from saoi-api,
  and before each draft at most every ten minutes.
- **Saving** is public: 64 KiB body cap, 20 a minute per address (`CF-Connecting-IP`, then
  `X-Forwarded-For`, which saoi-mcp forwards), 5,000 a day overall, drafts and saves together.
  Drafts: 30 a minute per address; past a limit, or if the write fails, the plan comes back with
  `saveLink: null` and says so.
- **Presentation**: review, plan and first-home results lead with `presentation`, the sentences
  a host reads first: money found, the position with its parts, one net figure per scenario (everything held less what is still owed,
  never a gross pot alone), the split, the liquidity call, Help to Buy for a home, the questions, the save link,
  and that the customer decides. No imperatives.
- **The link** is `https://app.saoi.ie/?plan=<token>` (2026-11-10: opened from claude.ai's card on a phone, a `#/plan/<token>` fragment never reached the app; the app moves `?plan=` into its route and strips it). `POST /api/plans/preview` (public, by token, not spent) gives the app's welcome the title, the figures in one line and a home comparison's first three options (`plan.comparison`, every option the customer saw, carried in the `MarketPlan`), before the data notice and the claim.
- **Claiming** (`#/plan/<token>` in saoi-web, after the welcome and the data notice) puts it in the browser's current conversation when
  that is empty, otherwise a new one (`source: 'plan'`, under the audience cap, refused before
  the token is spent). It records the situation's figures that map cleanly onto the fact
  catalogue (`factsFromPlan` in `_shared/db/saved-plans.ts`: take-home pay, rent, outgoings,
  monthly saving, savings held, card balances, loan repayments, the leading goal, its target and
  date; never gross income) as `customer_stated`, skipping keys the case holds, and writes
  `plan_saved` and `plan_claimed`. The same browser opening its link again lands in the same
  conversation; another browser gets 409, an expired link 410 `expired`, an unknown one 404.
- **Opening**: `plan_claimed` is narratable, so the next `POST /api/sessions` says `hasUpdates`
  and the app runs a `return` turn. That turn shows the `saved_plan` card before Saoirse speaks
  (built from the stored plan, once per plan, like the account welcome), the digest carries "The
  plan they brought" on every turn, and the return instruction asks for what it is and what is
  next (its `Next:` line), no figures.
- `npm run plan:sample` saves the worked example against the live API and prints a link.

### Open banking, simulated

A stand-in aggregator, Nexus, links the accounts a customer holds at other banks (§6, §53).
Nothing connects to a bank: `link_accounts` generates one current and, when a savings balance
is held, one savings account with ninety days of transactions from the case's own facts
(`_shared/domain/open-banking/synthesise.ts`), so what the overview shows agrees with what was
said. Consent has a scope (balances, transactions, payments) and a ninety-day expiry, and is
revoked from the menu. Three cards: `connect_accounts` (the consent tap), `accounts_overview`
(server-built, read only), `transfer` (the tap initiates; the console settles). The requirement
engine satisfies a payslip or bank-statement document from `accountEvidence` (two months of
salary seen, sixty days of history), recorded as `account_data` reuse. The tables are
`linked_accounts`, `linked_transactions`, `transfers`. Tools: `show_connect_accounts`,
`show_accounts`, `show_transfer`. Smoke and mirrors by design: the shapes are real, the data is
synthetic, and the document says so (`vault/docs/features/open-banking.md`).

### Product interests

`offered | accepted | declined | deferred`. Declined products are listed in the case digest as "do not raise again" (§49).

### Digital forms

Saoirse reads the bank's own published form definitions and is another renderer of them. Two are
snapshotted: `1833` SuperSaver (499 fields) and `1940` personal loan (418). Adding a third is a
snapshot plus two rows in `tenants/demo/forms/mapping.ts`; nothing in `_shared/domain/forms`
knows a form id.

- `definition.ts` parses the published JSON. Operators are `is`, `isnot`, `>`, `<`.
- `logic.ts` decides what applies. **Most branching is on the page, not the field**: a page
  break gates every field carrying its `pageNumber`.
- `calculations.ts` evaluates the definition's own formulas (`{:179}+{:218}`) with a
  hand-written four-operator parser. Never `eval`, never the model.
- `state.ts` settles: defaults, then calculations, then active fields, repeat. Stale answers on
  abandoned branches are dropped.
- `ndi.ts` handles the calculating controls, each declaring its fidelity:
  `source_faithful | fixture | unsupported`. Repayments are computed from the control's own
  declared inputs; **eligibility is always a fixture** and the model can never set it.
- `submission.ts` builds the ordered FormData packet. **Nothing ever POSTs it.** The endpoint is
  recorded as intended-destination metadata.

Facts are canonical and each form has its own adapter table: the two forms share two toscana
names out of 120 and 154, and a name is not unique within a form either, so destinations
resolve against the live branch. Never prefill a `hidden` field. Where several fields share a
name, required ones win.

The digest lists each outstanding question with its field id in brackets, and
`record_form_answers` matches by that id first and by label second (one match accepted, several
refused as ambiguous with their ids, none refused with the open questions). The feature recorded
nothing for two days because the digest showed labels and the tool wanted ids; the detector is a
count of `form_answers` rows.

Answers that are not facts (a form-specific question, a declaration, a document reference) live
in `form_answers`, with the wording for consents. `form_applications.answers` is the merge,
facts last.

A declaration can only be made by tapping the card; `record_form_answers` refuses a checkbox or
an upload whatever it is sent. Document manifests leave `x-file-hash` and `x-signed-file-hash`
null, because the service issuing them is not ours.

## Saoirse model tools

Every tool input is Zod-validated before any effect. Invalid input returns a tool error to the model and is never thrown to the user.

- `record_facts`: facts from the conversation. Server checks catalogue key, `extractable`, value schema; writes `customer_stated` or `partner_stated`.
- `show_product_options`: product ids plus one-line reasons tied to what the customer said. Selection happens in the card.
- `show_review`: application id. The server builds the review content from DB data, not model text.
- `show_pause_prompt`: application id. Customer confirms in the card.
- `request_upload`: an existing open `application_request` only, including one the console opened with "information requested" (`bank:<slug>`), which the requirement engine treats as an outstanding document until the upload fulfils it.
- `show_partner_invite`: application ids the partner is needed for. Refused when none of them has an outstanding partner-subject requirement.
- `show_status`: renders the DB status card.
- `record_form_answers`: an answer to the bank form's own question. Server checks the field is
  live, is a question, and that a choice value is one the form offers. Refuses declarations and
  uploads outright.
- `show_form_declarations`: the form's declarations, in its published wording, for the customer
  to tick. The model supplies no text.
- `show_form_upload`: the next document the form wants, with the control's own size and type
  limits.
- `show_form`: the next form an application needs. The model names the application only; which
  form is due is decided for it.
- `propose_plan`: offers to keep a goal that outlives any one application. Nothing is kept until
  the customer taps.
- `show_comparison`: two to four catalogue products side by side. Nothing is started by tapping.
- `show_quote`: what something costs, pays or takes. Any two of amount, months and monthly is
  enough; the server works out the third. The model never does the arithmetic.
- `show_mortgage_rates`: the published rate table, indexed by customer type, BER, amount and
  term. All four required, so the model must ask rather than quote a range. The server decides
  which rates are shown and computes the repayments.

- `show_arrangement`: how the money they hold and the money they save each month should be
  split across savings accounts, from `_shared/domain/savings/arrange.ts`. Takes nothing; the
  server reads the facts and the published rates. One tap starts every account on it through
  `select_products`.

Nineteen tools. **Which ones a turn is offered is decided by the conversation's stage** - the
form tools are gated further on a form existing. Withholding a tool is enforcement; telling the
model not to use one is advice.

Stream events are a Zod discriminated union: `text_delta | retract | card | status | done | error`. A round that spoke and then had a tool refused is withdrawn: `retract` takes its characters back off the screen and out of the record, and the refused result tells the model to write again. A handler marks a refusal with `refused: true`; partial rejections from the two recording tools are not refusals.

## The showcase, explainer and article

These moved out on 2026-11-04 to their own repo and site, `chris-88/saoi-showcase`, served at
`https://showcase.saoi.ie/` (`/#/`, `/#/how-it-works/:section?`, `/#/article`). This repo
has nothing of them; saoi-web keeps the redirects (`src/app/ExternalRedirect.tsx`) and the
`showcaseUrls` links in `src/app/routes.ts`. The feature doc is still `vault/docs/features/showcase.md`.

## Guardrails (§19 to §27, §39, §47)

Gate output:

```ts
{ category: 'banking' | 'ambiguous' | 'general_knowledge' | 'competitor'
          | 'off_topic' | 'abusive' | 'prompt_injection' | 'unsupported',
  profanity: boolean, sensitive: boolean }
```

- Deterministic pre-checks first: input length cap, empty input, known injection patterns (flagged, still classified).
- `banking` → Saoirse. `ambiguous` → Saoirse, instructed to clarify within banking scope. Profanity with banking intent is `banking` (§23).
- Everything else → canned response from `refusals.ts`, keyed by category and persona tone bucket.
- Classifier error or timeout fails closed with a short retry message.
- `max_tokens` on Saoirse is low enough that "count to 10,000" cannot succeed even if it slips through.
- `sensitive: true` zeroes humour for that turn and suppresses product offers (§50).
- Output re-classification is not in v1. Add it only if evals show leaks.

## Persona (§16 to §18, §38, §56)

- Sliders 0 to 1: `length`, `humour`, `sarcasm`, `formality`, `playfulness`, `poetic`.
- Presets are named slider sets: default, concise, friendly, formal, dry humour, poetic. Custom means custom slider values. No free-text persona instructions.
- `persona.ts` maps sliders to fixed prose fragments. Snapshot-tested.
- Read fresh every turn so admin changes apply immediately.
- Saoirse always discloses it is AI and never claims to be human.

## Identity, sessions and continuity (§12, §28, §29)

- Every visitor gets a Supabase anonymous user. `participant_sessions` maps auth users to a participant, so one participant can span browser contexts (Safari and an installed PWA have separate storage on iOS).
- Public → app: `session` issues a handoff code → `/#/app/login?h=<code>` → simulated Demo Bank login → redeem: attach the new session to the same participant, link the case to the synthetic customer, set `auth_level = authenticated`, load bank-held facts.
- Bank-held facts are not re-asked unless the journey requirement says `confirm` or `fresh` (§6 Stage 5).
- Admins use real Supabase email auth plus an `admin` role, checked client-side for routing and server-side on every `admin` call.

## Partner (§6 Stage 9, §33)

- Invite link carries an opaque token that does not expire and is not used up. Each opening attaches that browser's anonymous session to the same partner participant, so the partner can move between phones. Inviting again voids the earlier links for any browser that has not already joined.
- v1 partner experience: task list with RHF forms and uploads. Saoirse in partner mode is a stretch goal.
- One partner answer (e.g. income, employment) writes one fact that satisfies requirements in every application the partner is party to. The demo must show this.
- Partner completion writes events and updates the primary's case via Realtime.
- What the primary says their partner earns is `income.partnerAnnualStated`, a household-level hearsay fact that never satisfies the partner's own requirement.

## Events, notifications, return (§6 Stages 11 to 13, §35, §36, §42)

- Admin simulates downstream events through the state machine. No random timers.
- Sending a notification is a separate explicit admin action, over Web Push. The console can send the fixed copy or write its own.
- The copy contains nothing about the application. Link: `/#/?n=<code>`, carrying an opaque single-use token.
- On return, `saoirse-turn` runs with a `return` trigger: the digest includes events since `last_seen_at`. Saoirse phrases the summary; the status card renders from DB beside it.
- Push has been confirmed arriving on a real phone, so no simulated notification is wired
  into the product. The showcase site draws its own lock screen with the fixed push copy.

## Admin console (§37 to §44)

- Case inspector: context with provenance, partner, applications, outstanding requirements, conversation, events.
- Event simulator: buttons for §41 events, each a state-machine transition. "Information requested" also opens an `application_requests` row with the wording, so the customer has something to upload to. "Documents checked" is the one move that is not a transition: it flips `documents.verified` and is narrated on return; a completed current or joint account is narrated as "open" and welcomed with a server-built `account_opened` card (illustrative IBAN under the bank code `SAOI`, which no institution holds).
- Notify, persona sliders and presets, domain category view, audience metrics.
- Reset restores the canonical presenter case from `_shared/domain/seed/canonical.ts`. Build a minimal reset in M1; you will need it constantly.
- Purge audience cases. Global kill switch that makes the gate return a "demo paused" response.

## Feedback, traffic and collaborators (§44, §53)

- Feedback comes from the conversation: a thumbs on a Saoirse reply (`give_feedback`, kind `turn`,
  kept against the message) or a 1 to 5 rating with words from the menu (kind `session`). It
  is never a turn: Saoirse does not reply to feedback. `feedback_given` is the event; the console
  lists feedback by period and shows a turn's thumbs beside the turn.
- A case carries `source`, the entry point it arrived through (`?src=qr|poster|link`), set on
  creation only. The analytics screen shows the journey after a show and tell (arrived, said
  something, kept a plan, started, submitted, signed in, came back, gave feedback), the
  sources, where conversations stalled (the detector events) and the feedback figures.
- Collaborators are people who asked to be contacted about taking this further, or who asked a
  question after the showcase: `register_interest` on `session`, anonymous, with a `kind`
  (`collaborate | question`), a daily cap and a honeypot field; `collaborators` is read by
  the console only, with CSV export. Not case activity, so no event.

## Audience (§45 to §47)

- `/#/try` creates an isolated anonymous session and a new case. Options: start fresh, or clone the canonical customer (authenticated, bank-held facts present).
- Isolation is by case ownership under RLS. Audience cases can never touch the presenter case.
- Cap via env: `AUDIENCE_MAX_CASES`, customer cases created in the last 24 hours. A rate, not a
  lifetime total. No SMS.
- `AUDIENCE_MAX_TURNS` is declared but nothing reads it: there is no per-conversation turn
  limit. The cap limits how many people can start, not what any one of them can spend.
- A case created by an automated probe is tagged `kind = 'test'` through the admin-only
  `tag_test_case` action, which takes it out of the cap. Tag and delete any
  probe's cases: twenty-five replays against the live model once used the day's allowance up
  and started refusing real visitors. (The old `scripts/live-probe.mjs` helper was deleted with
  the Edge Functions; it called `/functions/v1/admin`.)

## Engineering standards

**TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noImplicitOverride`. No `any`. No non-null `!` outside tests. `satisfies` for config objects. Discriminated unions with exhaustive `switch` and `assertNever` for states, categories, cards and stream events.

**Zod**: every saoi-api route validates its request body and returns `{ ok: true, data } | { ok: false, error: { code, message } }`. Request and response schemas live in `_shared/contracts/` and types are inferred from them. Never hand-write a type that duplicates a schema.

**Server failures**: there is no Sentry on the server. A write that matters goes through `mustWrite`, which throws rather than failing silently, and anything worth explaining afterwards writes an `events` row (`tool_rejected`, `turn_tools`, `request_blocked`). This was learned the hard way: thirty-nine writes had no error check, and one of them broke §49 for a week without a symptom.

**Browser apps**: TanStack Query, Zustand, forms, shadcn, Sentry and Pages rules live in the CLAUDE.md of saoi-web and saoi-admin.

**Secrets**: nothing secret in any app's `VITE_*`. The Anthropic key, the VAPID private key and `PRESENTER_KEY` exist only in the saoi-api environment.

## Repo layout

```
vault/docs/                 gitignored since 2026-10-20. README.md is the map; start-here,
                            dev, architecture, design, features, journeys, decisions,
                            learnings, security, operations, archive
docs/                       overview.md: the long-form product pitch (the old README)
supabase/
  migrations/  seed.sql     schema, RLS, the canonical seed (npm run seed:generate)
  templates/                auth email templates; sign-in-link.html is loaded by the stack
  functions/
    _shared/
      domain/               facts, journeys/, state-machine, requirements,
                            advisories, metrics, seed/   (pure TS, @domain)
      contracts/            Zod request/response schemas
      llm/                  gate, prompt composer, persona, refusals, tools
      tenants/demo/         products, domain config, brand strings
      db/  push/            generated DB types, Web Push
services/
  api/                      saoi-api: Hono service (its own package), the whole backend;
                            bundles supabase/functions/_shared via @shared
scripts/                    seed generator, model comparison, market/ (the market data refresh)
tests/                      schema-drift test
evals/guardrails/           cases.jsonl + runner
.github/workflows/          ci.yml (shared checks, api, api-integration, api-image)
```

## Commands

```
npx supabase start           # local Supabase
(cd services/api && npm run dev)   # saoi-api; needs services/api/.env
npm run check                # the pre-merge gate: typecheck, lint, format, seed check, tests
npm run typecheck
npm run lint
npm run test                 # Vitest: _shared and tests/
npm run eval:guardrails      # live gate against the adversarial set
```

**The fixture LLM provider.** `LLM_PROVIDER=fixture` replays a script from
`services/api/src/turn/fixtures/` instead of calling Anthropic, so a conversation can be
driven with no key and no bill. `LLM_FIXTURE` names the script; the turn within it is chosen by
how many times Saoirse has already spoken on the case, so a scripted conversation advances as a real
one does. Scripts are transcribed from real conversations, turn for turn. `runSaoirseTurn` takes a
`ModelProvider` (`_shared/llm/model.ts`); the Anthropic adapter and the fixture are the only two
implementations, and `_shared` reads no environment to choose between them.

## Environment

The browser apps' `VITE_*` variables are documented in saoi-web and saoi-admin. Root `.env` here is read only by `eval:guardrails` and `compare:models` (the Anthropic key).

saoi-api environment, as actually read: `ANTHROPIC_API_KEY`, `SAOI_MODEL`, `GATE_MODEL`,
`APP_BASE_URL`, `AUDIENCE_MAX_CASES`, `PRESENTER_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_D`,
`VAPID_SUBJECT`.

Soft-read, unset in production: `LLM_PROVIDER` (`fixture` replays a script) and `LLM_FIXTURE`
(which one).

Set on the project but read nowhere: `TWILIO_*` and `SENTRY_DSN` (never built) and
`AUDIENCE_MAX_TURNS` (declared, never implemented). Removed from the `.env.example` files on
2026-10-15; `vault/docs/dev/environment-variables.md` is the full reference.

GitHub: the `VITE_*` repo variables here are no longer read by anything (the apps have their own copies). The `SUPABASE_*` secrets are left over from the retired hosted-project deploy.

## CI and deploy

- `ci.yml` on push and PR: the shared checks (typecheck, lint, format, seed check, tests); the
  `api` job checks `services/api`, `api-integration` runs its routes against a local stack,
  `api-image` builds its container.
- No Pages deploy here any more: the apps deploy from saoi-web and saoi-admin.
- `saoi-api` is built from `origin/main` and redeployed from the infra repo (`stacks/saoi-api/redeploy-api.sh`), not by a workflow here.

## Testing

- **Vitest, required**: requirement engine, reuse policies, subject matching, state machine (every legal and illegal transition), advisories, questions-avoided, persona composer, gate routing given fixed classifier outputs, token issue and redeem.
- **Playwright** lives in saoi-web and saoi-admin: route, render and disclosure checks. It does
  not yet drive a conversation; the fixture provider (`LLM_PROVIDER=fixture`) makes that possible.
- **Guardrail evals**: `evals/guardrails/cases.jsonl` holds a must-block set (§22, §24, §47: trivia, jokes, competitors, excessive output, injection, persona escape) and a must-allow set (profane banking questions, short contextual answers, sensitive but in-scope disclosures). 100% on both before any presentation.

## Build order

Each milestone ends deployed.

- **M0 Skeleton**: Vite, shadcn, routes for all five surfaces, Supabase project, CI, Pages deploy, browser Sentry.
- **M1 Domain core**: fact catalogue, draft journeys, requirement engine, state machine, reuse, advisories, metrics, canonical seed, minimal reset. Tests first.
- **M2 Saoirse turn**: gate, prompt composer, tools, SSE, chat UI, card registry, eval set.
- **M3 Applications**: product selection, concurrent applications, review and submit, loan advisory and pause.
- **M4 Continuity**: public site, handoff, simulated login, bank-held enrichment, PWA.
- **M5 Partner**: invite, tasks, cross-application partner facts.
- **M6 Return**: event simulation, Web Push, return summary.
- **M7 Admin**: inspector, notify, persona, domain view, metrics, purge, kill switch.
- **M8 Audience**: QR entry, clone, caps.
- **M9 Polish**: Demo Bank shell fidelity, film run-through.

## Working rules

- Read the relevant § before implementing. Reference §N in commit messages.
- Domain logic goes in `_shared/domain` as pure functions, with tests written first.
- Where the spec is silent, choose the fastest credible option (§68) and add one line to `vault/docs/decisions.md`: date, decision, §.
- Ask before adding any dependency outside the stack.
- When a journey is matched against its recording, set `status: 'final'` and fill `source`.
- A change that invalidates a document under `vault/docs/` updates it in the same change, and bumps its
  `last_verified`. Never describe something unbuilt in the present tense.
- Any change that moves what a turn costs — prompt size, cache breakpoints or TTLs, model
  choice, tool rounds, reply length — updates `vault/docs/04-cost-of-running-a-conversational-assistant.md`,
  including its changelog. The numbers in it are measured; do not revise them from memory.
- A live model is for checking what the model does. Layout, card ordering and copy placement
  are not that, and running a full conversation to check them is how an API budget disappears.
  Check those against `LLM_PROVIDER=fixture`, which costs nothing.

## Open items

- Journey recordings not yet translated. All journeys start as `draft`.
- Partner name: the vision doc says Sarah, the requirements say Emma. Seed uses Emma.
- Primary customer name and synthetic bank-held record: define in the seed.
- Web Push is built and delivers to a real phone. No SMS, and no plan to add it.
- Custom domain or github.io base path.
