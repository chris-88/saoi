-- One application per PRODUCT, not per kind.
--
-- `unique (case_id, product)` has been on this table since the beginning, from when a product
-- was a kind and nothing else: one mortgage, one credit card, one savings account. The
-- catalogue has nine savings products, and migration 20261012160000 taught the card and the
-- code to tell SuperSaver from the 31-Day Notice Account — and stopped there. The database
-- went on enforcing one savings application per case, so a customer who chose two got a 500,
-- and because no Edge Function had a top-level catch it reached them as "failed to send a
-- request", which is a network error, which it was not.
--
-- `catalogue_id` is nullable and Postgres treats NULLs as distinct in a unique index, so a bare
-- column list would let two catalogue-less savings applications exist side by side — the exact
-- duplicate the original constraint was there to stop. Coalescing to '' keeps that promise:
-- at most one application per (case, kind, specific product), and at most one with no specific
-- product behind it.

alter table public.applications drop constraint if exists applications_case_id_product_key;

create unique index if not exists applications_case_product_catalogue_key
  on public.applications (case_id, product, coalesce(catalogue_id, ''));
