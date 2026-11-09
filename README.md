```text
███▄▄████▄▄                   ▄▄█████▄         ▄▄█████▄         ▄▄█████▄       ███
██████▀▀████▄               ▄████▀▀▀███▄     ▄████▀▀▀████     ▄████▀▀▀████     ███
████      ▀██▄              ███ ▄▄▄▄▄        ███      ▀███    ███      ▀███
███  ▀  ▀  ███             ██████████████   ████       ███    ███       ███    ███
▀███      ▄██▀                  ▀▀▀▀▀████    ███      ▄███    ███      ▄███    ███
 ▀████▄▄████▀               ▀████▄▄▄███▀     ▀████▄▄▄█████    ▀████▄▄▄████     ███
   ▀▀████▀▀                   ▀▀█████▀         ▀▀█████▀███      ▀▀█████▀       ███
```

# Saoi

Saoi is a conversational orchestration layer over simulated retail banking product journeys for a
fictional Demo Bank; Saoirse is its assistant. The customer says what they are trying to do;
Saoirse discovers the wider need, the customer chooses products, and facts are collected once and
reused across concurrent applications. The case persists across channels, sessions, a partner and
time. This is a proof of concept, not a bank: nothing in it is real. The long-form pitch is in
[docs/overview.md](docs/overview.md).

This repo is the backend: `saoi-api`, the database schema, and the shared domain, contracts and
prompts. The browser apps live in their own repos:

| Repo                                                                | What                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| [chris-88/saoi-web](https://github.com/chris-88/saoi-web)           | the Saoirse chat, [app.saoi.ie](https://app.saoi.ie)          |
| [chris-88/saoi-admin](https://github.com/chris-88/saoi-admin)       | the presenter console, [admin.saoi.ie](https://admin.saoi.ie) |
| [chris-88/saoi-showcase](https://github.com/chris-88/saoi-showcase) | the showcase, [showcase.saoi.ie](https://showcase.saoi.ie)    |

The apps call the API through a client generated from
[api.saoi.ie/api/openapi.json](https://api.saoi.ie/api/openapi.json).

## Requirements

- Node 24 (`.nvmrc`; use [nvm](https://github.com/nvm-sh/nvm)) and npm
- A Supabase project, either local (`supabase start`, needs Docker and the
  [Supabase CLI](https://supabase.com/docs/guides/cli), pinned at 2.108.0 in CI) or a hosted or
  self-hosted one
- An Anthropic API key, only to run Saoirse against a real model (see the fixture provider below)

## Setup

```sh
git clone https://github.com/chris-88/saoi.git
cd saoi
nvm use
npm ci
cp supabase/.env.local.example services/api/.env
npx supabase start          # or point services/api/.env at a hosted or self-hosted project
(cd services/api && npm ci && npm run dev)   # saoi-api; see services/api/README.md
```

Then run [saoi-web](https://github.com/chris-88/saoi-web) or
[saoi-admin](https://github.com/chris-88/saoi-admin) with `VITE_SAOI_API_URL` pointing at it.

### Environment variables

Names only; copy the `.example` files and fill in values. Never commit them.

| File                | Variables                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CORS_ORIGINS`, `PORT`, `ANTHROPIC_API_KEY`, `SAOI_MODEL`, `GATE_MODEL`, `APP_BASE_URL`, `AUDIENCE_MAX_CASES`, `PRESENTER_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_D`, `VAPID_SUBJECT`, `LLM_PROVIDER`, `LLM_FIXTURE` |
| `.env`              | `ANTHROPIC_API_KEY`, for `eval:guardrails` and `compare:models` only                                                                                                                                                                                                                      |

The service role key and the Anthropic key never reach a browser. To run with no model key and no
bill, set `LLM_PROVIDER=fixture` and `LLM_FIXTURE` to a script in
`services/api/src/turn/fixtures/`.

## Commands

| Command                               | What it does                                                         |
| ------------------------------------- | -------------------------------------------------------------------- |
| `npm run check`                       | The pre-merge gate: typecheck, lint, format check, seed check, tests |
| `npm run typecheck`                   | `tsc -b` over `supabase/functions/_shared`, scripts, evals and tests |
| `npm run lint`                        | ESLint                                                               |
| `npm run format`, `format:check`      | Prettier write or check                                              |
| `npm test`, `test:watch`              | Vitest: the shared domain, contracts, prompts and the schema drift   |
| `npm run seed:generate`, `seed:check` | Regenerate or verify `supabase/seed.sql`                             |
| `npm run eval:guardrails`             | Live gate against the adversarial set (needs `.env`)                 |
| `npm run compare:models`              | Compare models on recorded turns (needs `.env`)                      |
| `npm run db:types`                    | Regenerate Supabase types from the linked project                    |

## Layout

```
supabase/migrations/  Postgres schema and RLS; seed.sql
supabase/templates/   auth email templates (sign-in-link.html is loaded by the auth stack)
supabase/functions/   _shared only (domain, contracts, llm, tenants), bundled by the service
services/api/         saoi-api, the Node service that is the whole backend (see below)
scripts/  evals/  tests/
docs/                 long-form documentation
CLAUDE.md             operational summary for contributors and coding agents
```

## services/api

`saoi-api` is a Hono service (Node 24, its own `package.json` and lockfile) and the only backend
the apps talk to. It bundles `supabase/functions/_shared`. See
[services/api/README.md](services/api/README.md).

```sh
cd services/api
npm ci
npm run dev        # also: typecheck, lint, test, build
```

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE).
