-- A case created by a probe is not a customer.
--
-- The capacity cap in `session` counts cases with kind = 'customer' created in the last 24
-- hours, which is the right question to ask about a room full of people and the wrong one to
-- ask about a test harness. Diagnosing one bug took roughly twenty-five replays against the
-- live model, each one an anonymous session with its own case, and they ate the day's
-- allowance: real visitors were told the demonstration was at capacity because of automated
-- runs nobody was watching.
--
-- `test` is a fourth kind. Nothing else changes: the cap already filters on 'customer', so a
-- tagged case drops out of the count without touching the capacity logic.
--
-- Only an authenticated admin can apply it (`tag_test_case`). It is deliberately not something
-- a client can ask for at session start, because a kind that exempts a case from the rate limit
-- is exactly the thing a rate limit exists to stop anyone choosing for themselves.

alter table public.cases drop constraint if exists cases_kind_check;

alter table public.cases add constraint cases_kind_check check (
  kind in ('customer', 'presenter', 'audience', 'test')
);

comment on column public.cases.kind is
  'Ordinarily `customer`. `test` marks a case created by an automated probe, which is excluded from the capacity cap and may be deleted at any time. The legacy presenter/audience values are accepted so old rows load, but nothing writes them.';
