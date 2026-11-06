-- Saoirse conversational banking POC — initial schema.
--
-- Two rules shape this file:
--   1. Clients READ under RLS and never write. There is not a single insert, update or
--      delete policy below; every mutation goes through an Edge Function holding the
--      service role (CLAUDE.md > Architecture, Invariant 2).
--   2. Only the primary customer and an admin can read a case. The partner never touches
--      these tables: the `partner` function returns scoped DTOs (Invariant 7, §33).
--
-- State and category literals are CHECK constraints rather than Postgres enums, so the spec
-- can still move during the build. `state-literals.test.ts` fails if they drift from the
-- TypeScript unions.

-- ---------------------------------------------------------------------------
-- Synthetic bank-held customer records (Invariant 10: no real customer data)
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  bank_reference text not null unique,
  full_name text not null,
  date_of_birth date not null,
  email text not null,
  mobile text not null,
  existing_products text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.customers is
  'Simulated bank-held customer records. Synthetic only; no real bank data.';

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  -- The presenter case is protected from audience activity (§45).
  kind text not null default 'audience' check (kind in ('presenter', 'audience')),
  label text,
  customer_id uuid references public.customers(id) on delete set null,
  auth_level text not null default 'anonymous'
    check (auth_level in ('anonymous', 'authenticated')),
  -- Drives the "what changed while you were away" summary (§36).
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cases_kind_idx on public.cases (kind);

-- ---------------------------------------------------------------------------
-- Participants and sessions
-- ---------------------------------------------------------------------------

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  role text not null check (role in ('primary', 'partner')),
  display_name text,
  created_at timestamptz not null default now()
);

create index participants_case_idx on public.participants (case_id);
-- A case has at most one primary.
create unique index participants_one_primary_idx
  on public.participants (case_id) where role = 'primary';

-- One participant can span several auth users: Safari and an installed PWA have separate
-- storage on iOS, so the same person arrives twice (§12, §28).
create table public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (participant_id, auth_user_id)
);

create index participant_sessions_auth_idx on public.participant_sessions (auth_user_id);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  product text not null check (
    product in ('mortgage', 'joint_account', 'credit_card', 'personal_loan', 'protection')
  ),
  state text not null default 'not_started' check (
    state in (
      'not_started', 'in_progress', 'waiting_customer', 'waiting_partner', 'ready',
      'submitted', 'under_review', 'info_required', 'approved', 'declined',
      'paused', 'completed'
    )
  ),
  -- Set only while paused; where `resumed` returns to (§13).
  resume_to text check (
    resume_to in ('in_progress', 'waiting_customer', 'waiting_partner', 'ready')
  ),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One application per product per case: §12 independence is per product, not per attempt.
  unique (case_id, product),
  constraint resume_to_only_when_paused
    check ((state = 'paused') = (resume_to is not null))
);

create index applications_case_idx on public.applications (case_id);

-- ---------------------------------------------------------------------------
-- Facts
-- ---------------------------------------------------------------------------

create table public.facts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  key text not null,
  -- Household facts have no participant; person facts must have one.
  participant_id uuid references public.participants(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('participant', 'household')),
  value jsonb not null,
  source text not null check (
    source in (
      'customer_stated', 'partner_stated', 'bank_held',
      'document_extracted', 'document_verified', 'system_derived'
    )
  ),
  verified boolean not null default false,
  -- Null when gathered in general conversation. Drives questions-avoided (§53).
  captured_for uuid references public.applications(id) on delete set null,
  superseded_by uuid references public.facts(id) on delete set null,
  captured_at timestamptz not null default now(),
  constraint participant_matches_subject_kind check (
    (subject_kind = 'household' and participant_id is null) or
    (subject_kind = 'participant' and participant_id is not null)
  ),
  constraint fact_cannot_supersede_itself check (superseded_by is null or superseded_by <> id)
);

create index facts_case_idx on public.facts (case_id);
create index facts_lookup_idx on public.facts (case_id, key, participant_id)
  where superseded_by is null;

-- ---------------------------------------------------------------------------
-- Confirmations: reuse confirmations, declarations and customer confirmations
-- ---------------------------------------------------------------------------

-- Scoped per application, so a declaration made for the mortgage does not satisfy the
-- credit card (§11). This is what the requirement engine reads as `confirmations`.
create table public.application_confirmations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  requirement_id text not null,
  participant_id uuid not null references public.participants(id) on delete cascade,
  kind text not null check (kind in ('reuse', 'declaration', 'confirmation', 'consent')),
  confirmed_at timestamptz not null default now(),
  unique (application_id, requirement_id)
);

create index application_confirmations_app_idx
  on public.application_confirmations (application_id);

-- ---------------------------------------------------------------------------
-- Requests and documents
-- ---------------------------------------------------------------------------

-- `request_upload` may only reference an existing open row here (Saoirse model tools).
create table public.application_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  requirement_id text not null,
  requested_of uuid references public.participants(id) on delete set null,
  kind text not null check (kind in ('document', 'information')),
  status text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  detail text,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

create index application_requests_app_idx on public.application_requests (application_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  requirement_id text,
  participant_id uuid references public.participants(id) on delete set null,
  document_type text not null check (
    document_type in (
      'payslip', 'bank_statement', 'photo_id', 'proof_of_address', 'salary_certificate'
    )
  ),
  storage_path text not null,
  verified boolean not null default false,
  uploaded_at timestamptz not null default now()
);

create index documents_case_idx on public.documents (case_id);
create index documents_app_idx on public.documents (application_id);

-- ---------------------------------------------------------------------------
-- Product interests (§49)
-- ---------------------------------------------------------------------------

create table public.product_interests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  product text not null check (
    product in ('mortgage', 'joint_account', 'credit_card', 'personal_loan', 'protection')
  ),
  status text not null check (status in ('offered', 'accepted', 'declined', 'deferred')),
  -- Why Saoirse raised it, tied to something the customer said.
  reason text,
  updated_at timestamptz not null default now(),
  unique (case_id, product)
);

create index product_interests_case_idx on public.product_interests (case_id);

-- ---------------------------------------------------------------------------
-- Conversation
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  role text not null check (role in ('customer', 'baz', 'system')),
  content text not null,
  -- The gate's verdict for a customer turn (§25). Null for Saoirse and system messages.
  gate_category text check (
    gate_category in (
      'banking', 'ambiguous', 'general_knowledge', 'competitor',
      'off_topic', 'abusive', 'prompt_injection', 'unsupported'
    )
  ),
  created_at timestamptz not null default now()
);

create index messages_case_idx on public.messages (case_id, created_at);

-- ---------------------------------------------------------------------------
-- Events: everything significant, with an actor (§52, Invariant 9)
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  type text not null,
  actor text not null check (actor in ('customer', 'partner', 'model', 'admin', 'system')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index events_case_idx on public.events (case_id, created_at);

-- ---------------------------------------------------------------------------
-- Consents (§9 permissions, §35 SMS)
-- ---------------------------------------------------------------------------

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  kind text not null check (kind in ('sms_notifications', 'health_questions', 'credit_check')),
  granted boolean not null,
  granted_at timestamptz not null default now(),
  unique (participant_id, kind)
);

-- ---------------------------------------------------------------------------
-- Tokens: opaque, hashed, single-use, short-lived (§29, §58, Invariant 8)
-- ---------------------------------------------------------------------------

create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('handoff', 'partner_invite', 'notification')),
  -- The token itself is never stored, only its hash.
  token_hash text not null unique,
  participant_id uuid references public.participants(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index tokens_hash_idx on public.tokens (token_hash) where consumed_at is null;

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

-- Persona is style only and read fresh every turn (§18, §38, Invariant 5).
create table public.persona_config (
  scope text primary key default 'global',
  preset text not null default 'default',
  sliders jsonb not null default
    '{"length":0.5,"humour":0.3,"sarcasm":0.1,"formality":0.5,"playfulness":0.3,"poetic":0.0}',
  updated_at timestamptz not null default now()
);

insert into public.persona_config (scope) values ('global');

create table public.domain_config (
  scope text primary key default 'global',
  -- Makes the gate return a "demo paused" response to everything (§43).
  kill_switch boolean not null default false,
  categories jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

insert into public.domain_config (scope) values ('global');

-- Admins authenticate with real Supabase email auth; this grants the role (§28).
create table public.admin_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where auth_user_id = auth.uid()
  );
$$;

-- Security definer so the policy does not recurse through RLS on participants.
create or replace function public.can_read_case(target_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.participant_sessions ps
      join public.participants p on p.id = ps.participant_id
      where ps.auth_user_id = auth.uid()
        and p.case_id = target_case_id
        -- The partner reads nothing directly; scoped DTOs only (Invariant 7).
        and p.role = 'primary'
    );
$$;

revoke all on function public.can_read_case(uuid) from public;
grant execute on function public.can_read_case(uuid) to anon, authenticated;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: read-only, primary customer and admin
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.cases enable row level security;
alter table public.participants enable row level security;
alter table public.participant_sessions enable row level security;
alter table public.applications enable row level security;
alter table public.facts enable row level security;
alter table public.application_confirmations enable row level security;
alter table public.application_requests enable row level security;
alter table public.documents enable row level security;
alter table public.product_interests enable row level security;
alter table public.messages enable row level security;
alter table public.events enable row level security;
alter table public.consents enable row level security;
alter table public.tokens enable row level security;
alter table public.persona_config enable row level security;
alter table public.domain_config enable row level security;
alter table public.admin_users enable row level security;

create policy cases_read on public.cases
  for select using (public.can_read_case(id));

create policy participants_read on public.participants
  for select using (public.can_read_case(case_id));

create policy applications_read on public.applications
  for select using (public.can_read_case(case_id));

create policy facts_read on public.facts
  for select using (public.can_read_case(case_id));

create policy documents_read on public.documents
  for select using (public.can_read_case(case_id));

create policy product_interests_read on public.product_interests
  for select using (public.can_read_case(case_id));

create policy messages_read on public.messages
  for select using (public.can_read_case(case_id));

create policy events_read on public.events
  for select using (public.can_read_case(case_id));

create policy consents_read on public.consents
  for select using (public.can_read_case(case_id));

-- Joined through the application, which is joined through the case.
create policy application_confirmations_read on public.application_confirmations
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_id and public.can_read_case(a.case_id)
    )
  );

create policy application_requests_read on public.application_requests
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_id and public.can_read_case(a.case_id)
    )
  );

-- Persona and domain config are readable by anyone: the admin console needs them and they
-- contain nothing sensitive. Writes still go through the `admin` function.
create policy persona_config_read on public.persona_config for select using (true);
create policy domain_config_read on public.domain_config for select using (true);

-- Deliberately without a policy, so no client can read them at all:
--   customers            synthetic bank records, loaded server-side on authentication
--   participant_sessions the auth-user-to-participant mapping
--   tokens               opaque secrets, even hashed
--   admin_users          the admin roster
-- An admin reads these through the `admin` Edge Function.

-- ---------------------------------------------------------------------------
-- Realtime: what the app subscribes to in order to invalidate queries
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.applications;
alter publication supabase_realtime add table public.facts;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.product_interests;
alter publication supabase_realtime add table public.application_requests;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cases_touch before update on public.cases
  for each row execute function public.touch_updated_at();
create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();
create trigger product_interests_touch before update on public.product_interests
  for each row execute function public.touch_updated_at();
create trigger persona_config_touch before update on public.persona_config
  for each row execute function public.touch_updated_at();
create trigger domain_config_touch before update on public.domain_config
  for each row execute function public.touch_updated_at();
