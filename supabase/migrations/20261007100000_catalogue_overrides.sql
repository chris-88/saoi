-- Editing the catalogue's wording without pretending its conditions are editable (plan §3.2).
--
-- A goal's signals are predicates over facts. No form edits those, and putting the sharpest part
-- of the system behind one would buy nothing and risk a new class of runtime failure. What a
-- presenter does want to change between run-throughs is the prose, so the prose lives here and
-- overlays the compiled catalogue. `domain/catalogue/overlay.ts` applies it.
--
-- `enabled` is the single field that changes behaviour, and it is a switch rather than a rule,
-- so it cannot be malformed. Everything else changes only what Saoirse says.
create table public.catalogue_overrides (
  kind text not null check (kind in ('goal', 'need')),
  entry_id text not null,

  enabled boolean not null default true,

  -- Null means "not overridden", which is different from an empty string. A presenter who
  -- clears a field is restoring the compiled wording, not setting the name to nothing.
  name text check (name is null or length(btrim(name)) > 0),
  summary text check (summary is null or length(btrim(summary)) > 0),
  priority text check (priority is null or priority in ('low', 'medium', 'high', 'very_high')),

  -- Milestone id to replacement label.
  milestone_labels jsonb not null default '{}'::jsonb,
  -- Check-in key (see `checkinKey`) to replacement agenda, as an array of strings.
  checkin_agendas jsonb not null default '{}'::jsonb,

  -- Bumped on every save, so the console can say how many times something has been reworded.
  -- Lifecycle metadata the spec asks for, which constants in a TypeScript file cannot have.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (kind, entry_id)
);

-- Priority applies to needs. A goal's ranking is evidence, not a stored field.
alter table public.catalogue_overrides
  add constraint catalogue_overrides_priority_is_a_need
  check (priority is null or kind = 'need');

alter table public.catalogue_overrides enable row level security;

-- Read by anyone: the effective catalogue is what Saoirse speaks from, and the customer app shows
-- goal names. Writes go through the `admin` Edge Function on the service role, like every other
-- write in this project.
create policy catalogue_overrides_read on public.catalogue_overrides for select using (true);

create trigger catalogue_overrides_touch before update on public.catalogue_overrides
  for each row execute function public.touch_updated_at();

alter publication supabase_realtime add table public.catalogue_overrides;
