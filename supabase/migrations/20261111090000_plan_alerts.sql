-- Plan alerts and dated reminders (design 2026-11-11-saoi-plan-alerts-design): the reason to be
-- in the app after a comparison made in the customer's own AI.
--
-- Three kinds of alert, each a fact with its date and source, never a nudge:
--   rate_change        a product in a claimed plan (`saved_plans.document`) has a new version
--                      in `market_products` whose headline rate differs;
--   product_withdrawn  that product's current row was retired with no successor;
--   reminder           a date the customer gave (a fixed rate ending, a deposit maturing) is
--                      90, 60, 30 or 7 days away, or today.
--
-- `POST /api/internal/alerts/run` (daily timer, after the Monday refresh) raises them. A run is
-- idempotent: one alert per case and market version, one per reminder and stage, enforced by
-- the two partial unique indexes below, so a second run inserts nothing. The alert is kept
-- whether or not a push reached a browser; Saoirse states unseen ones on the next visit.
create table public.plan_alerts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('rate_change', 'product_withdrawn', 'reminder')),
  -- The market product id (`savings.supersaver`) a product alert is about.
  product_id text,
  -- The `market_products.id` it is about: the new version, or the withdrawn one.
  product_version bigint,
  reminder_id uuid,
  -- For a reminder: days before the date it was sent at (0 is the day itself).
  stage int check (stage is null or stage in (90, 60, 30, 7, 0)),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 1000),
  -- The figures behind the body (rates, dates, source url), for a card to lay out.
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  -- When a push for it was delivered to at least one browser. Null: none was.
  sent_at timestamptz,
  -- When the customer first saw it: read in the app, or stated by Saoirse in a persisted turn.
  seen_at timestamptz,
  constraint plan_alerts_shape check (
    (kind = 'reminder' and reminder_id is not null and stage is not null and product_version is null)
    or (kind <> 'reminder' and product_id is not null and product_version is not null and reminder_id is null)
  )
);

create unique index plan_alerts_case_version
  on public.plan_alerts (case_id, product_version)
  where product_version is not null;
create unique index plan_alerts_reminder_stage
  on public.plan_alerts (reminder_id, stage)
  where reminder_id is not null;
create index plan_alerts_case_created on public.plan_alerts (case_id, created_at desc);

-- A date the customer gave, by telling Saoirse (`set_reminder`) or in the app.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('fixed_rate_ends', 'deposit_matures', 'other')),
  label text not null check (length(btrim(label)) between 1 and 120),
  due_on date not null,
  -- A market product id the date belongs to, when one was named.
  product_id text,
  -- The participant who set it. Null when set by Saoirse without a known participant.
  created_by uuid references public.participants(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Deleted reminders are kept so a stage already sent is never sent again for them.
  deleted_at timestamptz
);

create index reminders_open on public.reminders (due_on) where deleted_at is null;
create index reminders_case on public.reminders (case_id) where deleted_at is null;

alter table public.plan_alerts
  add constraint plan_alerts_reminder_fk
  foreign key (reminder_id) references public.reminders(id) on delete cascade;

-- What each alerts run covered: the next run reads market changes after `through_at`.
create table public.alert_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  through_at timestamptz not null
);

create index alert_runs_through on public.alert_runs (through_at desc);

-- Service-role only, like `saved_plans`: the customer reads alerts through the API, which
-- checks access to the case.
alter table public.plan_alerts enable row level security;
alter table public.reminders enable row level security;
alter table public.alert_runs enable row level security;
revoke all on public.plan_alerts from anon, authenticated;
revoke all on public.reminders from anon, authenticated;
revoke all on public.alert_runs from anon, authenticated;

comment on table public.plan_alerts is
  'Facts about a claimed plan or a date given (rate changed, product withdrawn, reminder stage), one per case and market version or per reminder and stage. Service-role only: RLS denies all rows to anon and authenticated.';
comment on table public.reminders is
  'Dates the customer gave (a fixed rate ending, a deposit maturing), reminded 90, 60, 30 and 7 days before and on the day. Service-role only.';
comment on table public.alert_runs is
  'Each alerts run and the moment its market changes ran to. Service-role only.';
