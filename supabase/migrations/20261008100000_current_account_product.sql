-- A current account in one name is a product Saoirse can start (§7).
--
-- The joint account was built first because it is the one that demonstrates invitation and
-- partner completion, which left somebody banking on their own being told the only current
-- account on offer was a joint one — a gap in the catalogue reading as a gap in the bank.
--
-- The check constraints are what keep the database and the TypeScript union honest with each
-- other, so both move together. `tests/schema-drift.test.ts` fails if they drift.
alter table public.applications drop constraint if exists applications_product_check;
alter table public.applications add constraint applications_product_check check (
  product in ('mortgage', 'current_account', 'joint_account', 'credit_card', 'personal_loan', 'protection', 'savings')
);

alter table public.product_interests drop constraint if exists product_interests_product_check;
alter table public.product_interests add constraint product_interests_product_check check (
  product in ('mortgage', 'current_account', 'joint_account', 'credit_card', 'personal_loan', 'protection', 'savings')
);
