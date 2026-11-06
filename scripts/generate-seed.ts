/**
 * Generates `supabase/seed.sql` from the canonical seed (§43).
 *
 * The canonical case is defined once, in TypeScript, where it is tested against the fact
 * catalogue. This script projects it into SQL so `supabase db reset` restores exactly the
 * case the domain tests validate — the two cannot drift.
 *
 *   npm run seed:generate     write supabase/seed.sql
 *   npm run seed:check        fail if it is out of date (runs in CI)
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  bankHeldFacts,
  canonicalCase,
  canonicalCustomer,
  type SeedFact,
} from '../supabase/functions/_shared/domain/seed/canonical.ts'

const OUTPUT = fileURLToPath(new URL('../supabase/seed.sql', import.meta.url))

/** Fixed ids, so a reset is idempotent and the presenter can bookmark the case. */
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001'
const CASE_ID = '00000000-0000-4000-8000-000000000002'
const PRIMARY_ID = '00000000-0000-4000-8000-000000000003'

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown): string => `${quote(JSON.stringify(value))}::jsonb`

function factRow(fact: SeedFact): string {
  const household = fact.subject === 'household'
  return [
    '  (',
    quote(CASE_ID),
    ', ',
    quote(fact.key),
    ', ',
    household ? 'null' : quote(PRIMARY_ID),
    ', ',
    quote(household ? 'household' : 'participant'),
    ', ',
    json(fact.value),
    ', ',
    quote(fact.source),
    ', ',
    String(fact.verified),
    ')',
  ].join('')
}

function build(): string {
  const { customer } = canonicalCase

  return `-- GENERATED FILE — do not edit.
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
delete from public.customers where bank_reference = ${quote(customer.bankReference)};

insert into public.customers (id, bank_reference, full_name, date_of_birth, email, mobile, existing_products)
values (
  ${quote(CUSTOMER_ID)},
  ${quote(customer.bankReference)},
  ${quote(customer.fullName)},
  ${quote(customer.dateOfBirth)},
  ${quote(customer.email)},
  ${quote(customer.mobile)},
  array[${customer.existingProducts.map(quote).join(', ')}]
);

insert into public.cases (id, kind, label, customer_id, auth_level)
values (
  ${quote(CASE_ID)},
  'presenter',
  ${quote(canonicalCase.label)},
  ${quote(CUSTOMER_ID)},
  'authenticated'
);

insert into public.participants (id, case_id, role, display_name)
values (
  ${quote(PRIMARY_ID)},
  ${quote(CASE_ID)},
  'primary',
  ${quote(customer.firstName)}
);

-- Facts the bank already holds, loaded as if authentication had just happened (§6 Stage 5).
insert into public.facts (case_id, key, participant_id, subject_kind, value, source, verified)
values
${bankHeldFacts.map(factRow).join(',\n')};

insert into public.events (case_id, type, actor, payload)
values (
  ${quote(CASE_ID)},
  'case_reset',
  'admin',
  ${json({ seed: 'canonical', facts: bankHeldFacts.length })}
);

commit;
`
}

const sql = build()
const mode = process.argv[2] ?? 'write'

if (mode === 'check') {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''
  if (current !== sql) {
    console.error(
      'supabase/seed.sql is out of date with the canonical seed. Run: npm run seed:generate',
    )
    process.exit(1)
  }
  console.log('supabase/seed.sql is up to date.')
} else {
  writeFileSync(OUTPUT, sql)
  console.log(
    `Wrote supabase/seed.sql — ${String(bankHeldFacts.length)} bank-held facts for ${canonicalCustomer.fullName}.`,
  )
}
