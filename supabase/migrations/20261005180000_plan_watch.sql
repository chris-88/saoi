-- What the bank said it would watch for (§35, §36).
--
-- "We'll be in touch when you hit your target" is only worth saying if something actually
-- checks. The condition is stored so it can be evaluated by whatever notices first — a
-- scheduled job, the presenter console, or the customer's next turn — and so the promise
-- survives the conversation that made it.

create table public.plan_watches (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('savings_target', 'date')),
  -- Exactly one of these is set, according to `kind`.
  target numeric,
  on_date date,
  describe text not null,
  created_at timestamptz not null default now(),
  met_at timestamptz,
  -- Set once the customer has been told, so a met watch does not notify twice.
  notified_at timestamptz
);

create index plan_watches_case_idx on public.plan_watches (case_id, met_at);

alter table public.plan_watches enable row level security;

create policy plan_watches_read on public.plan_watches
  for select using (public.can_read_case(case_id));

-- Writes are service-role only, like everything else (CLAUDE.md > Architecture).
revoke insert, update, delete on public.plan_watches from anon, authenticated;

comment on table public.plan_watches is
  'A condition the bank committed to watching for, so the customer does not have to come back and check.';
