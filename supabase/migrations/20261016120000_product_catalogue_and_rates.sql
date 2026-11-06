-- The product catalogue and the mortgage rate table, editable (§51).
--
-- Both were generated TypeScript constants baked into the function bundle: a real bank's
-- published offering, read from their site on a date, and the rate table the same. Right for
-- a snapshot, wrong the moment somebody wants to correct a rate between run-throughs or add a
-- product without a deploy.
--
-- One row per product and one per rate, holding the same JSON shape the compiled files hold,
-- validated by the contract schemas before it is written. Empty tables mean "use the compiled
-- files", so nothing changes until a presenter loads the published set and edits it, and
-- deleting every row is the way back. `enabled` switches a row off without losing it.
--
-- Read by the Edge Functions on the service role at the start of a turn. The console reads
-- through the `admin` function. Nobody else reads them: a half-edited rate is not public
-- information until somebody says it is.
create table public.product_catalogue (
  id text primary key check (length(btrim(id)) > 0),
  product jsonb not null,
  enabled boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mortgage_rates (
  id text primary key check (length(btrim(id)) > 0),
  rate jsonb not null,
  enabled boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_catalogue enable row level security;
alter table public.mortgage_rates enable row level security;

create policy product_catalogue_read on public.product_catalogue for select using (public.is_admin());
create policy mortgage_rates_read on public.mortgage_rates for select using (public.is_admin());

create trigger product_catalogue_touch before update on public.product_catalogue
  for each row execute function public.touch_updated_at();
create trigger mortgage_rates_touch before update on public.mortgage_rates
  for each row execute function public.touch_updated_at();

alter publication supabase_realtime add table public.product_catalogue;
alter publication supabase_realtime add table public.mortgage_rates;
