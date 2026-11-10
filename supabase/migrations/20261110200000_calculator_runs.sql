-- One anonymous row per run of the home calculator (`POST /api/calc/home`), as evidence for
-- HomeOwn of who uses it and how far they are from the keys (decision
-- `2026-11-10-saoi-routes-card`). Written by saoi-api after it responds; a failed write never
-- fails the request.
--
-- Bands only, worked out by `_shared/domain/market/run-bands.ts`: no raw figure, no identifier,
-- no address or IP, no free text, and the day it ran rather than a timestamp. A county is kept
-- only when it is on the fixed list (the 26 counties and Dublin's four local authorities).
-- Nothing reads it yet.
create table public.calculator_runs (
  id uuid primary key default gen_random_uuid(),
  ran_on date not null default current_date,
  kind text not null check (kind in ('home')),
  income_band text not null check (
    income_band in ('<40k', '40-60k', '60-80k', '80-100k', '100-150k', '150k+', 'unknown')
  ),
  gap_months_band text not null check (
    gap_months_band in ('0', '1-6', '7-12', '13-24', '25-48', '48+', 'never', 'unknown')
  ),
  target_met boolean,
  county text check (
    county is null or county in (
      'carlow', 'cavan', 'clare', 'cork', 'donegal', 'dublin', 'galway', 'kerry', 'kildare',
      'kilkenny', 'laois', 'leitrim', 'limerick', 'longford', 'louth', 'mayo', 'meath',
      'monaghan', 'offaly', 'roscommon', 'sligo', 'tipperary', 'waterford', 'westmeath',
      'wexford', 'wicklow', 'dublin_city', 'dun_laoghaire_rathdown', 'fingal', 'south_dublin'
    )
  ),
  rent_band text check (
    rent_band is null or rent_band in ('<1000', '1000-1500', '1500-2000', '2000-2500', '2500+')
  ),
  property_kind text check (
    property_kind is null or property_kind in ('new_build', 'self_build', 'second_hand')
  ),
  first_time_buyer boolean
);

create index calculator_runs_ran_on_idx on public.calculator_runs (ran_on);

-- Service-role only: RLS on with no policies, and no grants to the browser roles.
alter table public.calculator_runs enable row level security;
revoke all on public.calculator_runs from anon, authenticated;

comment on table public.calculator_runs is
  'One anonymous, banded row per home-calculator run (run-bands.ts): no figures, no identifiers, the day only. Service-role only: RLS denies all rows to anon and authenticated.';
