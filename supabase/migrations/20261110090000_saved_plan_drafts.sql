-- Plans held as 24-hour drafts (Chris, 2026-11-09, after the second Claude test).
--
-- `saoi_build_plan` now holds every plan it builds in `saved_plans` behind a single-use link,
-- so the customer's own AI can hand over "Save this plan to the Saoi app" without a second call.
-- A plan nobody opens is deleted after 24 hours; `saoi_save_plan` links last 24 hours too.
-- Opening a link claims the plan exactly as before, and a claimed plan belongs to its case.
--
-- `sweep_saved_plans()` deletes every unclaimed plan past its expiry or older than 24 hours.
-- saoi-api calls it hourly and before each draft it writes; this migration runs it once, which
-- also removes unclaimed plans saved under the old seven-day links.

create or replace function public.sweep_saved_plans()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.saved_plans
    where claimed_at is null
      and (expires_at <= now() or created_at <= now() - interval '24 hours')
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.sweep_saved_plans() from public, anon, authenticated;
grant execute on function public.sweep_saved_plans() to service_role;

select public.sweep_saved_plans();

comment on table public.saved_plans is
  'Plans from the customer''s own AI behind a single-use claim link (market-plan.ts): drafts from saoi_build_plan and saves from saoi_save_plan, both held 24 hours unless opened, then deleted by sweep_saved_plans(). Token stored hashed. Service-role only: RLS denies all rows to anon and authenticated.';
