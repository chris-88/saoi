-- Holdings: accounts and debts the customer enters by hand (design 2026-11-11-saoi-holdings-design),
-- so the saved plan moves: progress against it, reminders from a holding's own date, and later
-- alerts on the products held. Not open banking: `linked_accounts` stays the simulated aggregator.
--
-- Seeded once when a plan is claimed (`source = 'plan'`: the plan's `situation.savings` and
-- `situation.debts`, noted on the plan's date), then edited by the customer in the app or by
-- Saoirse's `record_holding`. Deleting is soft, like `reminders`, so a holding's history and its
-- reminder's sent stages stay explainable.
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in (
    'current', 'savings', 'deposit',
    'credit_card', 'personal_loan', 'car_finance', 'overdraft', 'mortgage', 'other_debt'
  )),
  label text not null check (length(btrim(label)) between 1 and 80),
  provider text check (provider is null or length(provider) <= 60),
  -- A market product id (`savings.supersaver`), when the holding is a product Saoi lists.
  product_id text check (product_id is null or length(product_id) <= 80),
  -- What is held, or what is owed: always a positive amount; the kind says which.
  balance numeric(12,2) not null check (balance >= 0),
  -- AER for an account, APR or the mortgage rate for a debt.
  rate_pct numeric(6,3) check (rate_pct is null or (rate_pct >= 0 and rate_pct <= 100)),
  -- Saving in each month for an account; the repayment for a debt.
  monthly_amount_eur numeric(12,2) check (monthly_amount_eur is null or monthly_amount_eur >= 0),
  -- A fixed rate's end or a deposit's maturity. Set: a matching reminder is kept in `reminders`.
  fixed_until date,
  -- The day the balance was true.
  noted_on date not null,
  source text not null check (source in ('plan', 'customer', 'saoirse')),
  -- The reminder kept for `fixed_until`, when there is one.
  reminder_id uuid references public.reminders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index holdings_case on public.holdings (case_id) where deleted_at is null;

-- Service-role only, like `saved_plans`: the customer reads and writes holdings through the API,
-- which checks access to the case.
alter table public.holdings enable row level security;
revoke all on public.holdings from anon, authenticated;

comment on table public.holdings is
  'Accounts and debts the customer entered by hand (or seeded from a claimed plan): balance, rate, monthly amount, fixed-until date and the day the balance was true. Progress against the plan is worked out from them. Service-role only: RLS denies all rows to anon and authenticated.';
