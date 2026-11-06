# saoi-api

The business-logic service for Saoirse: Node 24, TypeScript, [Hono](https://hono.dev) with
`@hono/zod-openapi`. It is the only backend the app talks to, at `VITE_SAOI_API_URL`; the Supabase
Edge Functions it replaced were retired on 2026-11-06.

## Endpoints

| Method and path                   | What                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                     | `{ ok: true, version }`. No auth.                                                                                                                                       |
| `GET /openapi.json`               | The OpenAPI 3.1 document, generated from the route schemas. No auth.                                                                                                    |
| `GET /api/cases/:caseId/snapshot` | Applications, plans, requests, form answers, linked accounts, transfers, notifications and `signedIn`: the state cards are resolved against.                            |
| `GET /api/cases/:caseId/history`  | The conversation as the screen renders it, each card carrying `settled` when the case shows its decision was made.                                                      |
| `GET /api/cases/:caseId/events`   | Server-Sent Events change feed. `ready` on open, `update` per narratable event (text from `@domain/narration`), `: keep-alive` every 25 s. Resume with `Last-Event-ID`. |

| `POST /api/cases/:caseId/turns` | One conversation turn (`saoirse-turn`): gate, Saoirse with tools, `text/event-stream`. Primary only (a partner gets 403, a stranger 404). Body `{ trigger, message?, note? }`. See [The turn](#the-turn). |
| `POST /api/sessions` | Attach this browser to its case, starting one if it has none (`session` `start`). |
| `GET /api/cases` | The conversations this browser can open (`list_cases`). `X-Presenter-Key` opens everyone's. |
| `POST /api/cases` | Begin a fresh conversation (`new_case`). 201. |
| `POST /api/cases/:caseId/switch` | Move onto another conversation (`switch_case`): own case, or the presenter key. |
| `POST /api/sessions/claim` | Carry a conversation across a change of auth user (`claim_participant`). |
| `POST /api/interest` | The collaborator form (`register_interest`). Honeypot, daily cap. |
| `POST /api/partner/join` | Open a partner invitation (`partner` `join`). Returns the partner's view. |
| `GET /api/partner/tasks` | The partner's tasks and applications (`tasks`). Scoped DTO only. |
| `POST /api/partner/submit` | Answer tasks (`submit`). Returns the refreshed view. |
| `POST /api/cases/:caseId/documents` | Multipart upload (`upload`): a request document or a form field. Type read from the bytes. |
| `POST /api/cases/:caseId/products/select`, `.../products/:product/decline` | `select_products`, `decline_product`. |
| `POST /api/cases/:caseId/applications/:applicationId/{confirm,submit,pause,resume,consent,form-declarations,health-answers}` | `confirm_requirement`, `submit_application` (one transaction), `pause_application`, `resume_application`, `grant_consent`, `confirm_form_declarations`, `submit_health_form`. |
| `POST /api/cases/:caseId/plans/:planId/decisions` | `decide_plan`. |
| `POST /api/cases/:caseId/invites` | `invite_partner` (one transaction). 201, with `inviteUrl`. |
| `POST /api/cases/:caseId/linked-accounts`, `.../linked-accounts/revoke`, `.../transfers` | `link_accounts`, `revoke_accounts`, `initiate_transfer`. |
| `POST /api/cases/:caseId/push-subscriptions`, `.../feedback` | `subscribe_push`, `give_feedback`. |
| `GET /api/health`, `GET /api/openapi.json` | Aliases of the root ones, no token, so a proxy that forwards `/api/*` needs no rewrite. |

**Who may take a case action.** `requireCaseSeat` admits any seat on the case (a stranger gets 404),
then each route's `requireRole('<action>')` checks `src/routes/cases/policy.ts`, the one table of
action to roles. Today every action is primary only; a partner or an administrator gets 403. The
Edge Function never read the role, so a partner could do all sixteen. The read routes keep
`requireCaseAccess` (primary only). Transactions: `submit_application_tx` and `invite_partner_tx`
are Postgres functions called with `rpc`, because supabase-js cannot hold a transaction.

### Admin API (`/api/admin/*`, tag `admin`)

The presenter console, ported from the `admin` Edge Function. Its own guard, `requireAdmin` (a row
in `admin_users`, else 403), runs before any body is validated. Responses are the bare payloads
`src/admin/adminClient.ts` expects. Destructive routes need `confirm: true` in the body and write
an `admin_audit` row in the same transaction (a Postgres function called through RPC; see
`supabase/migrations/20261104150000_admin_audit.sql`).

| Family    | Routes                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| overview  | `GET overview`, `GET analytics`, `GET feedback`, `GET collaborators`                                                                                                                                                                                |
| cases     | `GET cases/{id}` (inspect), `POST cases/reset` (`caseId` required), `DELETE cases/{id}`, `POST cases/purge`, `POST cases/{id}/tag-test`                                                                                                             |
| simulate  | `POST applications/{id}/events`, `POST cases/{id}/savings-target/reach`, `PUT cases/{id}/savings-balance`, `POST cases/{id}/plans/{planId}/moves`, `POST cases/{id}/documents/verify`, `POST cases/{id}/demo-actions`, `POST transfers/{id}/settle` |
| push      | `POST cases/{id}/notifications`                                                                                                                                                                                                                     |
| config    | `PUT kill-switch`, `PUT persona`, `POST persona/preview`, `POST guardrails/test`                                                                                                                                                                    |
| catalogue | `GET/PUT/DELETE products[/{id}]`, `POST products/load-published`, `POST products/{id}/restore`, the same for `rates`, `GET catalogue-overrides`, `PUT/DELETE catalogue-overrides/{kind}/{entryId}`                                                  |
| forms     | `GET form-applications`, `GET form-applications/{id}`, `POST form-applications/rebuild`                                                                                                                                                             |

Extra environment for these: `ANTHROPIC_API_KEY`, `SAOI_MODEL`, `GATE_MODEL` (guardrail test, persona
preview), `APP_BASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_D`, `VAPID_SUBJECT` (notifications).
Unset, the routes that need them answer 502.

Everything under `/api` needs `Authorization: Bearer <Supabase access token>`: 401 if missing or
invalid. The caller must be the **primary** participant of the case (a `participant_sessions` row
joined to `participants`, the check `case-action` makes, narrowed to the role RLS allowed to read
these tables). Anything else is **404**, not 403. That is the rule for the case read routes; the
session, partner and document routes follow the Edge Function they replace (403 for a case that is
not yours, since the caller already knows the id), and each says so in its OpenAPI responses. Errors use the existing envelope
`{ ok: false, error: { code, message, requestId } }`.

The SSE stream is polled from the database every 2 s per open stream (a Realtime subscription
can replace it without touching the contract). Use `fetch`, not `EventSource`, which cannot send
the header.

## The turn

`POST /api/cases/:caseId/turns` streams the turn. The response is `text/event-stream`,
every frame `data: <json>` and a blank line, the JSON a `SaoirseStreamEvent` (`_shared/contracts/stream.ts`):

| `type`       | Payload                     | When                                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------------------- |
| `text_delta` | `text`                      | Saoirse speaking.                                                         |
| `retract`    | `length`                    | Takes back the last `length` characters (a round whose tool was refused). |
| `card`       | `card`                      | A card to render. After the text before it.                               |
| `status`     | `caseId`, `invalidate`      | The case changed; refetch. Not sent on a blocked turn.                    |
| `done`       | `messageId`, `gateCategory` | The reply is saved. Last on success.                                      |
| `error`      | `error`                     | The turn failed. Last on failure; the reply is not saved.                 |

A failure after the stream opens is an `error` frame inside a 200, never a status code; a failure
before it (the case could not be loaded) is one `error` frame too. `: keep-alive` comment lines
every 25 s keep Cloudflare (about 100 s) and the client (45 s of silence) from cutting a quiet turn.

`src/turn/`, in the order a turn runs them:

| File          | Does                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `turn.ts`     | The pipeline and the limits. What happens before the stream opens runs in the runner; the rest in the generator it returns. |
| `context.ts`  | Loads the case and catalogue; builds plans, goals, suitability, digest and history.                                         |
| `gate.ts`     | The gate (Invariant 4): classifier, kill switch, deterministic checks.                                                      |
| `stage.ts`    | The stage and the tools it offers; computed from the case, never stored.                                                    |
| `generate.ts` | The model behind the seam (`ModelFactory`), the usage meter, the call to `runSaoirseTurn`.                                  |
| `tools.ts`    | Tool dispatch: looks the call up in `tools/index.ts` and runs that module. The rules are in `tools/`, one file per tool.    |
| `persist.ts`  | The customer's message and notice, a blocked turn, the reply and its events.                                                |
| `stream.ts`   | The SSE encoder, headers and keep-alive.                                                                                    |

**Turn tools.** A tool lives in `src/turn/tools/<tool-name>.ts` (kebab-case of the name the model
calls) and exports `{ name, run(input, ctx) }`, typed `ToolModule<'tool_name'>`: `input` is the
inference of the tool's Zod schema in `_shared/llm/tools.ts`, `ctx` is the `ToolContext` (the loaded
case, the admin client, the gate and goal results, and `rejections`). It returns the same
`ToolOutcome` the model sees: `result`, an optional `card`, and `refused: true` for a refusal.
`tools/_shared.ts` holds the context type and helpers used by more than one tool; constants only
one tool reads stay in its module. To add a tool: define its schema, description and entry in
`_shared/llm/tools.ts` (`TOOL_INPUTS`, `TOOLS`), add the module and a `<tool-name>.test.ts` beside
it (use `tools/_testing.ts` for the context), and register it in `tools/index.ts`, whose type
requires one module per name in `TOOL_INPUTS`. Which stages offer it is `stage.ts`. Validation
happens before dispatch, in `runSaoirseTurn`.

`_shared/llm` (prompt, gate, tools, `runSaoirseTurn`) and `_shared/domain` are imported, not copied.
**Provider seam:** `LLM_PROVIDER=anthropic|fixture` is read once in `server.ts` and turned into a
`ModelFactory` handed to `createTurnRunner`; nothing downstream reads the environment, and the
integration specs hand in `fixtureModels`, so no test can reach the network. `LLM_FIXTURE` names
the script in `services/api/src/turn/fixtures/`. **Limits:** the whole turn, gate included,
ends after `TURN_TIMEOUT_MS` (default 85 s) and aborts the provider call; one round writes at most
`TURN_MAX_OUTPUT_TOKENS` (3,072). Each turn logs its rounds, tokens and estimated cost.
`test/recordings/saoirse-turn-opening.json` is the Edge Function's own output for the `opening`
script; the unit and integration specs hold the route to those bytes.

## Layout

```
src/
  app.ts                 createApp(deps): middleware order, routers, OpenAPI doc, error handler
  server.ts              loads env, wires the real deps, listens
  context.ts             AppEnv: what middleware puts on the Hono context
  env.ts  errors.ts  log.ts
  middleware/            requestId, accessLog, auth, rateLimit, requireCaseAccess,
                         requireIdentity (session routes), requirePartner
  routes/
    common.ts            ErrorResponse and the shared response entries
    health.ts
    cases/               one file per resource, its Zod schemas beside it; index.ts composes them
    session/ partner/ documents/   the ported Edge Functions
  store/                 typed data access, no Hono imports (cases, sessions, partners, uploads, client)
  testing.ts             in-memory fake stores and token helper for tests
test/integration/        specs against `supabase start` (harness.ts, one spec per resource)
```

## Add a route

1. Add `src/store/<area>.ts` if you need data: a typed interface plus the Supabase implementation. Add it to `AppDeps` and the context in `app.ts`, and a fake in `testing.ts`.
2. Add `src/routes/<area>/<resource>.ts`: Zod schemas (name every response with `.openapi('Name')`), `createRoute`, and `new OpenAPIHono<AppEnv>().openapi(route, handler)`. Copy `routes/cases/snapshot.ts`.
3. Spread `authenticatedErrors` and add the 4xx you can return to `responses`. Do not return errors: throw `new ApiError(code, 'safe message')`.
4. Per-resource guards go in `routes/<area>/index.ts` with `.use(path, middleware)`, as `requireCaseAccess` does for `/api/cases/:caseId/*`. Read what it loaded with `c.get('caseAccess')`.
5. Compose the area's router in `app.ts` with `app.route('/', ...)`. Everything under `/api/*` already has auth and the rate limit.
6. Test with `createApp({ store: fakeStore(), ... })` and `app.request(...)`; extend the component list in `app.shape.test.ts`.

Errors are `{ ok: false, error: { code, message, details?, requestId } }`. Anything that is not an `ApiError` becomes `internal` with a generic message; the real one goes to the log with the request id. Logs are JSON lines; keys that look like credentials are redacted.

## Environment

| Variable                                    | Required  |                                                                                                                                         |
| ------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                              | yes       | The Supabase gateway as seen from the container, e.g. `http://kong:8000`.                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`                 | yes       | Server-side data access. Never logged, never sent to a browser.                                                                         |
| `SUPABASE_JWT_SECRET`                       | one of    | HS256 secret of the project (self-hosted default).                                                                                      |
| `SUPABASE_JWKS_URL`                         | one of    | Defaults to `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`; used for asymmetric tokens.                                                |
| `SUPABASE_JWT_ISSUER`                       | no        | Required `iss` claim. Unset, not checked.                                                                                               |
| `CORS_ORIGINS`                              | no        | Comma-separated allowed origins. **Default empty: every origin denied**; `*` is ignored. Set `https://app.saoi.ie` in production.       |
| `RATE_LIMIT_MAX`                            | no        | Requests per user per window on `/api/*`, default 120. In memory, per process.                                                          |
| `RATE_LIMIT_WINDOW_MS`                      | no        | Window length, default 60000.                                                                                                           |
| `PRESENTER_KEY`                             | no        | Opens the switcher to every case for a device sending it as `X-Presenter-Key`. Unset, nobody is a presenter. Compared in constant time. |
| `AUDIENCE_MAX_CASES`                        | no        | Customer cases a day before a new one is refused, default 50.                                                                           |
| `APP_BASE_URL`                              | no        | Where the SPA is served; the partner invite link is `${APP_BASE_URL}/#/join/<token>`.                                                   |
| `ANTHROPIC_API_KEY`                         | for turns | Required unless `LLM_PROVIDER=fixture`. `SAOI_MODEL` and `GATE_MODEL` pick the models.                                                  |
| `LLM_PROVIDER`, `LLM_FIXTURE`               | no        | `anthropic` (default) or `fixture`, which replays a script and calls nothing. `LLM_FIXTURE` defaults to `opening`.                      |
| `TURN_TIMEOUT_MS`, `TURN_MAX_OUTPUT_TOKENS` | no        | Wall clock for a whole turn (default 85000, max 95000) and the output ceiling of one round (default 3072).                              |
| `PORT`                                      | no        | Default 3000.                                                                                                                           |
| `APP_VERSION`                               | no        | Reported by `/health`. The image takes it from `--build-arg APP_VERSION=`.                                                              |

Audience must be `authenticated`, so the anon key does not pass for a user. The service fails to start on a missing or malformed variable and names it (never its value).

## Develop

```
cd services/api
npm install
cp .env.example .env   # or export the variables above
npm run dev            # tsx watch, :3000
npm run typecheck && npm run lint && npm test
npm run test:integration   # needs `supabase start` at the repo root; stop it afterwards
npm run build && npm start
```

The shared server code (`supabase/functions/_shared`: `contracts`, `domain`, `db/database.types`)
is imported through the `@shared/*` alias, not copied. The package keeps its own `node_modules`;
the tsconfig, Vitest and esbuild all resolve the shared files' bare imports (`zod`) from there so
there is a single zod instance. The build bundles our code and leaves packages external.

## Docker and the infra stack

The image bundles code from outside the package, so the build context is the **repository root**:

```
docker build -f services/api/Dockerfile -t saoi-api --build-arg APP_VERSION=$(git rev-parse --short HEAD) .
```

Node 24 alpine, multi-stage, runs as `node`, `HEALTHCHECK` on `/health`.

Contract with `~/code/infra` (the `saoi` stack):

- Container name `saoi-api`, listening on port 3000, joined to the stack's network so it can reach
  the Supabase gateway (`SUPABASE_URL=http://kong:8000`).
- Caddy routes `/saoi/api/*` to `saoi-api:3000` ahead of `/saoi/*`. Whether the `/saoi` prefix is
  stripped: the service serves `/health`, `/openapi.json` and `/api/...`, so Caddy strips only
  `/saoi`, and `/saoi/api/cases/...` arrives as `/api/cases/...`.
- The SPA is built with `VITE_SAOI_API_URL=https://api.chrisquinn.ie/saoi` (a repo variable); unset,
  it reads tables directly as before.
- Streams: Cloudflare cuts silent connections at about 100 s; the service sends a keep-alive
  every 25 s. Caddy must not buffer `/saoi/api/*/events` or `/saoi/api/*/turns` (`flush_interval -1`).
- Secrets from `pass` (`infra/saoi/...`), never a committed `.env`.
