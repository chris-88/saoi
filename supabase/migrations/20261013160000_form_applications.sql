-- An application against a real digital form definition.
--
-- Distinct from `applications`, which tracks a product journey through Saoirse's own state machine.
-- This is narrower and more literal: the answers collected for one form, keyed by that form's
-- own field ids, so the packet the existing web journey would POST can be built from them at
-- any moment.
--
-- Answers live in one jsonb column rather than a row per answer. They are only ever read and
-- written as a set, the form's field ids are the keys and the definition is the schema, so a
-- table of key-value rows would add joins and a second place for the shape to drift.
--
-- Deliberately inspectable while incomplete. The console must be able to open an application
-- nobody has finished and show what has been collected so far beside the packet it maps to,
-- which is how the mapping is demonstrated rather than asserted.

create table if not exists public.form_applications (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  -- The bank's form id, e.g. 1833 for SuperSaver.
  form_id text not null,
  -- The definition's own version string, so a packet can always be read against the revision
  -- it was built from.
  form_version text not null,
  -- Hash of the definition bytes this was collected against.
  source_hash text not null,
  answers jsonb not null default '{}'::jsonb,
  -- Which answers came from what Saoirse already held rather than from asking. The questions-
  -- avoided story is only credible if it is recorded as it happens.
  reused_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, form_id)
);

create index if not exists form_applications_case_idx on public.form_applications (case_id);

alter table public.form_applications enable row level security;

create policy form_applications_read on public.form_applications
  for select using (public.can_read_case(case_id));

comment on table public.form_applications is
  'Answers collected against a bank digital form definition. Never submitted anywhere: the packet is generated for inspection only.';
