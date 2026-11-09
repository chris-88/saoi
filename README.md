# Saoi

Saoi is a conversational orchestration layer over simulated retail banking product journeys for a
fictional Demo Bank; Saoirse is its assistant. The customer says what they are trying to do; Saoirse discovers the wider need,
the customer chooses products, and facts are collected once and reused across concurrent
applications. The case persists across channels, sessions, a partner and time. This is a proof of
concept, not a bank: nothing in it is real. The long-form pitch is in
[docs/overview.md](docs/overview.md).

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
cp .env.example .env
cp supabase/.env.local.example services/api/.env
npx supabase start          # or point .env at a hosted or self-hosted project
(cd services/api && npm ci && npm run dev)   # saoi-api; see services/api/README.md
npm run dev
```

### Environment variables

Names only; copy the `.example` files and fill in values. Never commit them.

| File                   | Variables                                                                                                                                                                                                                                                                                 | Where from                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `.env` (browser build) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`, `VITE_BASE_PATH`, `VITE_SAOI_API_URL` (required), `VITE_VAPID_PUBLIC_KEY`                                                                                                                                               | Supabase project settings (anon key only), Sentry, your VAPID key pair |
| `services/api/.env`    | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CORS_ORIGINS`, `PORT`, `ANTHROPIC_API_KEY`, `SAOI_MODEL`, `GATE_MODEL`, `APP_BASE_URL`, `AUDIENCE_MAX_CASES`, `PRESENTER_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_D`, `VAPID_SUBJECT`, `LLM_PROVIDER`, `LLM_FIXTURE` | Supabase project settings                                              |

The service role key and the Anthropic key never reach a browser. To run with no model key and no
bill, set `LLM_PROVIDER=fixture` and `LLM_FIXTURE` to a script in
`services/api/src/turn/fixtures/`.

## Commands

| Command                               | What it does                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run check`                       | The pre-merge gate: typecheck, lint, format check, seed check, test, build, bundle scan |
| `npm run dev`                         | Vite dev server                                                                         |
| `npm run build`                       | Typecheck and production build                                                          |
| `npm run preview`                     | Serve the production build                                                              |
| `npm run typecheck`                   | `tsc -b`                                                                                |
| `npm run lint`                        | ESLint                                                                                  |
| `npm run format`, `format:check`      | Prettier write or check                                                                 |
| `npm test`, `test:watch`              | Vitest                                                                                  |
| `npm run e2e`                         | Playwright route and render checks                                                      |
| `npm run seed:generate`, `seed:check` | Regenerate or verify `supabase/seed.sql`                                                |
| `npm run check:bundle`                | Scan `dist/` for secrets                                                                |
| `npm run eval:guardrails`             | Live gate against the adversarial set (needs `.env`)                                    |
| `npm run compare:models`              | Compare models on recorded turns (needs `.env`)                                         |
| `npm run db:types`                    | Regenerate Supabase types from the linked project                                       |

## Layout

```
src/                  the SPA (React, Vite, Tailwind, shadcn/ui): app, saoirse, surfaces, admin, partner
supabase/migrations/  Postgres schema and RLS
supabase/functions/   _shared only (domain, contracts, llm, tenants), bundled by the service and the app
services/api/         saoi-api, the Node service that is the whole backend (see below)
scripts/  e2e/  evals/  tests/
docs/                 long-form documentation
CLAUDE.md             operational summary for contributors and coding agents
```

## services/api

`saoi-api` is a Hono service (Node 24, its own `package.json` and lockfile) and the only backend the app
talks to, at `VITE_SAOI_API_URL`. It bundles `supabase/functions/_shared`. See [services/api/README.md](services/api/README.md).

```sh
cd services/api
npm ci
npm run dev        # also: typecheck, lint, test, build
```

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE).
