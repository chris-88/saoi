-- GENERATED FILE — do not edit.
-- Source: supabase/functions/_shared/domain/seed/canonical.ts
-- Regenerate: npm run seed:generate
--
-- The canonical presenter case (§43, §46). Synthetic data only (Invariant 10).
--
-- Reset state is the start of the story: an existing customer, authenticated, with the facts
-- the bank already holds. No applications, no product interests and no conversation — Saoirse
-- discovers all of that live.

begin;

-- Clear any previous presenter case. Audience cases are untouched (§45).
delete from public.cases where kind = 'presenter';
delete from public.customers where bank_reference = 'DEMO-SYNTHETIC-000417';

insert into public.customers (id, bank_reference, full_name, date_of_birth, email, mobile, existing_products)
values (
  '00000000-0000-4000-8000-000000000001',
  'DEMO-SYNTHETIC-000417',
  'Aoife Ní Bhriain',
  '1992-04-17',
  'aoife.demo@example.invalid',
  '+353871000417',
  array['personal_current_account']
);

insert into public.cases (id, kind, label, customer_id, auth_level)
values (
  '00000000-0000-4000-8000-000000000002',
  'presenter',
  'Canonical presenter case',
  '00000000-0000-4000-8000-000000000001',
  'authenticated'
);

insert into public.participants (id, case_id, role, display_name)
values (
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000002',
  'primary',
  'Aoife'
);

-- Facts the bank already holds, loaded as if authentication had just happened (§6 Stage 5).
insert into public.facts (case_id, key, participant_id, subject_kind, value, source, verified)
values
  ('00000000-0000-4000-8000-000000000002', 'identity.fullName', '00000000-0000-4000-8000-000000000003', 'participant', '"Aoife Ní Bhriain"'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'identity.dateOfBirth', '00000000-0000-4000-8000-000000000003', 'participant', '"1992-04-17"'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'identity.address', '00000000-0000-4000-8000-000000000003', 'participant', '"14 Seapoint Terrace, Dublin 8, D08 XY12"'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'identity.yearsAtAddress', '00000000-0000-4000-8000-000000000003', 'participant', '3'::jsonb, 'bank_held', false),
  ('00000000-0000-4000-8000-000000000002', 'identity.email', '00000000-0000-4000-8000-000000000003', 'participant', '"aoife.demo@example.invalid"'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'identity.mobile', '00000000-0000-4000-8000-000000000003', 'participant', '"+353871000417"'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'identity.nationality', '00000000-0000-4000-8000-000000000003', 'participant', '"Irish"'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'identity.ppsn', '00000000-0000-4000-8000-000000000003', 'participant', '"9000417T"'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'identity.maritalStatus', '00000000-0000-4000-8000-000000000003', 'participant', '"single"'::jsonb, 'bank_held', false),
  ('00000000-0000-4000-8000-000000000002', 'employment.status', '00000000-0000-4000-8000-000000000003', 'participant', '"employed_full_time"'::jsonb, 'bank_held', false),
  ('00000000-0000-4000-8000-000000000002', 'employment.employerName', '00000000-0000-4000-8000-000000000003', 'participant', '"Ardán Software Limited"'::jsonb, 'bank_held', false),
  ('00000000-0000-4000-8000-000000000002', 'income.annualBasic', '00000000-0000-4000-8000-000000000003', 'participant', '92000'::jsonb, 'bank_held', false),
  ('00000000-0000-4000-8000-000000000002', 'liabilities.creditCardBalance', '00000000-0000-4000-8000-000000000003', 'participant', '0'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'liabilities.monthlyLoanRepayments', '00000000-0000-4000-8000-000000000003', 'participant', '0'::jsonb, 'bank_held', true),
  ('00000000-0000-4000-8000-000000000002', 'banking.existingCustomer', '00000000-0000-4000-8000-000000000003', 'participant', 'true'::jsonb, 'bank_held', true);

insert into public.events (case_id, type, actor, payload)
values (
  '00000000-0000-4000-8000-000000000002',
  'case_reset',
  'admin',
  '{"seed":"canonical","facts":15}'::jsonb
);

commit;
