-- One row per call an AI makes to the Saoi MCP server (a tool call, a prompt get or a resource
-- read), posted by saoi-mcp to `POST /api/telemetry/mcp` after it has answered. Design: vault
-- `+/fleeting/saoi/2026-11-14-saoi-ai-usage-analytics-design.md`. Read by the console's AI usage
-- screen (`GET /api/admin/ai-usage`).
--
-- What it keeps: which assistant (`host`, from the user agent and the MCP clientInfo), which
-- tool, how it went, and what was asked: free-text fields verbatim (product search words, a
-- product id, an about topic), figures only as bands (`run-bands.ts`). No name, no address, no
-- account: `session_key` is a salted hash of address, user agent and UTC day that groups a
-- conversation loosely and cannot be turned back into an address.
--
-- `plan_saved` and `link_opened_at` outlive the saved plan: an unopened plan is deleted after
-- 24 hours (`sweep_saved_plans`), which nulls `saved_plan_id`, and the funnel still has to count
-- that a plan was held and its link opened.
create table public.mcp_calls (
  id uuid primary key default gen_random_uuid(),
  called_at timestamptz not null default now(),
  kind text not null check (kind in ('tool', 'prompt', 'resource')),
  name text not null check (length(name) between 1 and 200),
  host text not null check (host in ('claude', 'chatgpt', 'gemini', 'cursor', 'other')),
  user_agent text check (user_agent is null or length(user_agent) <= 200),
  client_name text check (client_name is null or length(client_name) <= 100),
  client_version text check (client_version is null or length(client_version) <= 50),
  session_key text check (session_key is null or session_key ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('ok', 'error', 'gated')),
  ms integer not null check (ms >= 0),
  card boolean not null default false,
  gate_missing text[] not null default '{}',
  asked jsonb not null default '{}'::jsonb,
  saved_plan_id uuid references public.saved_plans(id) on delete set null,
  plan_saved boolean not null default false,
  link_opened_at timestamptz
);

create index mcp_calls_called_at_idx on public.mcp_calls (called_at);
create index mcp_calls_host_idx on public.mcp_calls (host);
create index mcp_calls_saved_plan_idx on public.mcp_calls (saved_plan_id)
  where saved_plan_id is not null;

-- Service-role only: RLS on with no policies, and no grants to the browser roles.
alter table public.mcp_calls enable row level security;
revoke all on public.mcp_calls from anon, authenticated;

comment on table public.mcp_calls is
  'One row per AI call to the Saoi MCP server: the assistant, the tool, the outcome, and what was asked (free text verbatim, figures as bands). No name, address or account. Intended retention 180 days (no job yet). Service-role only: RLS denies all rows to anon and authenticated.';

-- When the app first showed the plan behind the link (`POST /api/plans/preview`), for the funnel.
alter table public.saved_plans add column opened_at timestamptz;
