-- What the customer saw this application called when they started it.
--
-- Three savings products started with one tap arrived as three applications all called
-- "Savings account": the review cards, the status card, the partner invite and every event
-- took the name from the journey, and nine savings products share one journey. The customer
-- confirmed three identical-looking review cards without being told which account each was.
-- `catalogue_id` says which product it is, but only the tenant's catalogue can turn that into
-- a name, and the code that renders a card is tenant-free (Invariant 11). So the name is
-- written once, at creation, and read back wherever the application is shown or recorded.
--
-- Nullable because every application created before today has none, and null means what it
-- always meant: the journey's own name.

alter table public.applications
  add column if not exists display_name text;

comment on column public.applications.display_name is
  'What the customer saw this application called when they started it, e.g. "SuperSaver". Null means the journey''s name, which is what every application created before the column existed is called.';
