-- Make the deny-all tables visible as such, and add the indexes the functions' queries need.
--
-- Five tables have RLS enabled and deliberately no policy: admin_users, customers,
-- participant_sessions, push_subscriptions, tokens. That denies every row to anon and
-- authenticated (20261001140000_revoke_internal_tables.sql also revokes the grants on four of
-- them), but the intent was only implicit. It is stated here as table comments.
--
-- No restrictive deny-all policy is added: tests/schema-drift.test.ts holds the rule "these
-- tables have no policy at all", which is how the revoke migration treats them, and a policy
-- of any kind would make that rule unreadable. The service role bypasses RLS and is unaffected.
-- Nothing here grants anything.

comment on table public.admin_users is
  'Admin roster. Service-role only: RLS denies all rows to anon and authenticated.';
comment on table public.customers is
  'Simulated bank-held customer records. Synthetic only. Service-role only: RLS denies all rows to anon and authenticated.';
comment on table public.participant_sessions is
  'Auth-user-to-participant mapping. Service-role only: RLS denies all rows to anon and authenticated.';
comment on table public.push_subscriptions is
  'Web Push endpoints. Service-role only: RLS denies all rows to anon and authenticated.';
comment on table public.tokens is
  'Opaque single-use secrets, stored hashed. Service-role only: RLS denies all rows to anon and authenticated.';

-- Indexes. `events (case_id, created_at)` and `messages (case_id, created_at)` already exist
-- (events_case_idx, messages_case_idx in the init migration), so the per-case feed and history
-- reads are covered. What is not covered is the admin analytics path, which filters both
-- tables by `created_at` alone across every case (and the metrics_by_day / messages_by_day
-- functions group by day), so it scans the whole table.
create index if not exists events_created_at_idx on public.events (created_at);
create index if not exists messages_created_at_idx on public.messages (created_at);
