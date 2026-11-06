-- A savings account is a product Saoirse can start (§7).
--
-- Added because a customer saying "I'd like all our savings with Demo Bank, which
-- account suits us" had nothing to be offered: the catalogue held five products and none of
-- them was a place to put money. The check constraints are what keep the database and the
-- TypeScript union honest with each other, so both move together.

alter table public.applications drop constraint if exists applications_product_check;
alter table public.applications add constraint applications_product_check check (
  product in ('mortgage', 'joint_account', 'credit_card', 'personal_loan', 'protection', 'savings')
);

alter table public.product_interests drop constraint if exists product_interests_product_check;
alter table public.product_interests add constraint product_interests_product_check check (
  product in ('mortgage', 'joint_account', 'credit_card', 'personal_loan', 'protection', 'savings')
);
