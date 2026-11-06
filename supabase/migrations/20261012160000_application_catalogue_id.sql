-- Which product this application is for, not just which kind.
--
-- A customer asked for SuperSaver for their €500 a month and the 31-Day Notice Account for
-- their €20,000 lump sum. Saoirse offered both, correctly and with the right reasons, and the
-- customer got one savings application: both are `savings`, so the second collapsed into the
-- first. The product options card had shown two rows reading "Savings account" and "Savings
-- account", distinguishable only by the sentence underneath.
--
-- The catalogue has nine savings products and the application model had one. `product` stays
-- what it is — it chooses the journey, and every savings product asks for the same things —
-- while `catalogue_id` records which of them the customer actually chose. Two applications of
-- the same kind can now sit side by side, which is the orchestration this is for (§63).
--
-- Nullable because every application that already exists predates the column, and because a
-- journey without a specific catalogue product behind it is still a legitimate application.

alter table public.applications
  add column if not exists catalogue_id text;

comment on column public.applications.catalogue_id is
  'The knowledge-base product this application is for, e.g. `savings.supersaver`. Null for applications started before the catalogue was wired in. `product` still chooses the journey.';

-- Two applications of one kind are now ordinary, so anything reading them needs a stable order.
create index if not exists applications_case_product_idx
  on public.applications (case_id, product, catalogue_id);
