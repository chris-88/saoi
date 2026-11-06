-- product_interests never learned about savings or current accounts.
--
-- `savings` arrived in 20261005170000 and `current_account` in 20261008100000. Both migrations
-- widened `applications_product_check` and neither touched this table, so for seven days every
-- interest written for either product violated the constraint and failed.
--
-- It failed silently, because `createApplications` does not check the result of its upsert. The
-- visible consequence is §49: declining a savings account did not stick, there was nothing in
-- the digest to say "do not raise again", and Saoirse would offer it back. The case that exposed
-- this had two applications and no interest rows at all.
--
-- The schema-drift test checked applications.product against PRODUCTS and had no idea this
-- column existed. It does now.

alter table public.product_interests drop constraint if exists product_interests_product_check;

alter table public.product_interests add constraint product_interests_product_check check (
  product in (
    'mortgage', 'current_account', 'joint_account', 'credit_card',
    'personal_loan', 'protection', 'savings'
  )
);
