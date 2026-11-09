-- Plans made in the customer's own AI, through the Saoi MCP tools, waiting to be opened in the app.
--
-- `saoi_save_plan` sends the plan document (`_shared/contracts/market-plan.ts`) to the public
-- `POST /api/plans`, which stores it here behind a one-time claim link. Opening the link
-- (`POST /api/plans/claim`) attaches the plan to a conversation.
--
-- Its own table rather than `plans`: a row in `plans` is one goal on one case, kept by the
-- customer's tap, with milestones the plan engine reconciles. This is a document made outside
-- the app that exists before there is any case (so `case_id` is null until it is claimed),
-- holds several goals and the products for them, and is read whole to build a card. The goals
-- it carries can become `plans` rows later through the ordinary `propose_plan` tap.
--
-- The link's token is stored only as its SHA-256 (Invariant 8, §58): 128 random bits, single
-- use, seven days. `claimed_at`, `claimed_by` and `case_id` are set together by one
-- conditional update, which is what makes a second claim lose.
create table public.saved_plans (
  id uuid primary key default gen_random_uuid(),
  version integer not null check (version >= 1),
  -- The document as validated on the way in.
  document jsonb not null,
  title text not null check (length(title) between 1 and 200),
  -- Which assistant saved it (`claude`), when it said.
  client text check (client is null or client ~ '^[a-z0-9_-]{1,40}$'),

  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),

  claimed_at timestamptz,
  -- The auth user that opened it, so the same browser opening it again lands in the same place.
  claimed_by uuid,
  case_id uuid references public.cases(id) on delete cascade,

  constraint saved_plans_claimed_together check (
    (claimed_at is null and claimed_by is null and case_id is null)
    or (claimed_at is not null and claimed_by is not null and case_id is not null)
  )
);

create index saved_plans_case_idx on public.saved_plans (case_id) where case_id is not null;
-- The daily cap on saves counts by this.
create index saved_plans_created_at_idx on public.saved_plans (created_at);

-- Service-role only, like `tokens`: the row holds a token hash, and the customer sees the plan
-- through the card the server builds from it.
alter table public.saved_plans enable row level security;
revoke all on public.saved_plans from anon, authenticated;

comment on table public.saved_plans is
  'Plans saved from the customer''s own AI behind a one-time claim link (market-plan.ts). Token stored hashed. Service-role only: RLS denies all rows to anon and authenticated.';
