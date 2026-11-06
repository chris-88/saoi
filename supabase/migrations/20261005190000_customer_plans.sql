-- Customer Plans: the trajectory a customer is on, not just the products they hold.
--
-- The line this schema draws, and the reason it looks sparse: decisions are stored, and
-- derivations never are. What the customer agreed to, when a milestone was actually reached,
-- when a check-in is due — those are facts about what happened. Progress, projected dates, the
-- gap remaining and whether the plan is on track are computed from the case every time, the
-- same rule the requirement engine and the needs engine already follow (Invariant 3). A stored
-- `progress_percentage` is a number that can disagree with the balance it came from.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,

  -- What the customer is trying to do, in their words and in ours.
  goal text not null check (
    goal in (
      'buy_first_home', 'move_home', 'emergency_fund', 'save_for_child',
      'buy_car', 'renovate', 'retire', 'become_debt_free', 'other'
    )
  ),
  title text not null,

  status text not null default 'draft' check (
    status in ('draft', 'active', 'paused', 'completed', 'abandoned', 'archived')
  ),

  -- The target itself is a decision — the customer said "sixty thousand" or agreed to it.
  target_amount numeric,
  target_date date,

  created_at timestamptz not null default now(),
  -- Null until the customer said yes. A plan Saoirse proposed is not a plan the customer has.
  confirmed_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  -- §44 — when the customer last confirmed the assumptions are still right.
  last_confirmed_at timestamptz
);

create index plans_case_idx on public.plans (case_id, status);

-- A meaningful point on the route. Definition and outcome, never progress.
create table public.plan_milestones (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,

  kind text not null check (
    kind in ('numeric', 'date', 'application', 'customer', 'external')
  ),
  label text not null,
  sort integer not null default 0,

  target_amount numeric,
  target_date date,
  -- For application milestones: which product and which state counts as reaching it.
  target_product text,
  target_state text,

  state text not null default 'not_started' check (
    state in ('not_started', 'in_progress', 'achieved', 'missed', 'no_longer_relevant')
  ),
  achieved_at timestamptz
);

create index plan_milestones_plan_idx on public.plan_milestones (plan_id, sort);

-- A planned reason to speak again. Not an appointment — a scheduled usefulness.
create table public.plan_checkins (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,

  purpose text not null,
  -- The agenda is written when the check-in is created so the customer can see why, and so
  -- Saoirse has something to work from rather than improvising a reason to make contact (§20).
  agenda jsonb not null default '[]'::jsonb,

  trigger_kind text not null check (trigger_kind in ('date', 'event')),
  due_at timestamptz,
  trigger_event text,

  state text not null default 'scheduled' check (
    state in ('scheduled', 'due', 'completed', 'skipped', 'cancelled', 'rescheduled')
  ),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index plan_checkins_plan_idx on public.plan_checkins (plan_id, state);

-- What the customer settled about a need, and what would make it worth raising again.
--
-- `product_interests` was standing in for this and could not carry a revisit condition, so a
-- deferred need was indistinguishable from a declined one once the conversation moved on.
create table public.need_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,

  need_id text not null,
  state text not null check (
    state in ('surfaced', 'accepted', 'declined', 'deferred')
  ),
  -- §27 — "come back to this when the mortgage is done", in a form something can evaluate.
  revisit_when text check (
    revisit_when in ('mortgage_completed', 'plan_completed', 'savings_target_reached', 'date')
  ),
  revisit_on date,
  revisited_at timestamptz,

  reason text,
  decided_at timestamptz not null default now()
);

create unique index need_decisions_current_idx
  on public.need_decisions (case_id, need_id)
  where revisited_at is null;

-- An application exists because of something the customer is trying to do.
alter table public.applications
  add column if not exists plan_id uuid references public.plans(id) on delete set null;

create index if not exists applications_plan_idx on public.applications (plan_id);

alter table public.plans enable row level security;
alter table public.plan_milestones enable row level security;
alter table public.plan_checkins enable row level security;
alter table public.need_decisions enable row level security;

create policy plans_read on public.plans
  for select using (public.can_read_case(case_id));

create policy plan_milestones_read on public.plan_milestones
  for select using (
    exists (
      select 1 from public.plans p
      where p.id = plan_milestones.plan_id and public.can_read_case(p.case_id)
    )
  );

create policy plan_checkins_read on public.plan_checkins
  for select using (
    exists (
      select 1 from public.plans p
      where p.id = plan_checkins.plan_id and public.can_read_case(p.case_id)
    )
  );

create policy need_decisions_read on public.need_decisions
  for select using (public.can_read_case(case_id));

revoke insert, update, delete on public.plans from anon, authenticated;
revoke insert, update, delete on public.plan_milestones from anon, authenticated;
revoke insert, update, delete on public.plan_checkins from anon, authenticated;
revoke insert, update, delete on public.need_decisions from anon, authenticated;

alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.plan_milestones;
alter publication supabase_realtime add table public.plan_checkins;

comment on table public.plans is
  'A customer goal that outlives any single application (§3). Progress is never stored — it is computed from the case.';
