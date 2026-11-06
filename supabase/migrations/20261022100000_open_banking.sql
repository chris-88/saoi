-- Open banking, simulated (§6, §53). A stand-in aggregator ("Nexus") links accounts held at
-- other banks so Saoirse can show one view of the customer's money, assess an application from
-- what it can see rather than from statements, and move savings across when an account opens.
--
-- Nothing here connects to a bank. The accounts and ninety days of transactions are generated
-- from the case's own facts so they agree with what was said in the conversation, the IBANs
-- are synthetic, and a transfer moves numbers between rows. The shapes are the real ones
-- (consent with a scope and an expiry, balances, booked transactions, payment initiation with
-- a settlement state) so the orchestration around them is not a mock.
create table public.linked_accounts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  provider text not null default 'nexus',
  bank text not null,
  display_name text not null,
  account_type text not null check (account_type in ('current', 'savings')),
  iban text not null,
  currency text not null default 'EUR',
  balance numeric(12, 2) not null,
  consent_scope text[] not null,
  consent_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index linked_accounts_case_idx on public.linked_accounts (case_id);

create table public.linked_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linked_accounts(id) on delete cascade,
  booked_on date not null,
  -- Negative is money out.
  amount numeric(12, 2) not null,
  description text not null,
  category text not null
);

create index linked_transactions_account_idx on public.linked_transactions (account_id, booked_on desc);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  from_account_id uuid not null references public.linked_accounts(id) on delete cascade,
  to_application_id uuid references public.applications(id) on delete set null,
  to_label text not null,
  amount numeric(12, 2) not null check (amount > 0),
  cadence text not null check (cadence in ('once', 'monthly')),
  state text not null default 'initiated' check (state in ('initiated', 'settled', 'failed')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index transfers_case_idx on public.transfers (case_id);

alter table public.linked_accounts enable row level security;
alter table public.linked_transactions enable row level security;
alter table public.transfers enable row level security;

create policy linked_accounts_read on public.linked_accounts for select using (public.can_read_case(case_id));
create policy transfers_read on public.transfers for select using (public.can_read_case(case_id));
create policy linked_transactions_read on public.linked_transactions for select using (
  exists (select 1 from public.linked_accounts a where a.id = account_id and public.can_read_case(a.case_id))
);

alter publication supabase_realtime add table public.linked_accounts;
alter publication supabase_realtime add table public.transfers;
