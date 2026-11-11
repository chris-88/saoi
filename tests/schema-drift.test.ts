import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CASE_KINDS } from '../supabase/functions/_shared/domain/case.ts'
import { FACT_SOURCES } from '../supabase/functions/_shared/domain/facts.ts'
import { DOCUMENT_TYPES, PRODUCTS } from '../supabase/functions/_shared/domain/journey.ts'
import { APPLICATION_STATES } from '../supabase/functions/_shared/domain/state-machine.ts'
import { LOCAL_AREAS } from '../supabase/functions/_shared/market/areas.ts'
import { PROPERTY_KINDS } from '../supabase/functions/_shared/contracts/market-tools.ts'
import {
  ALERT_KINDS,
  REMINDER_KINDS,
  REMINDER_STAGES,
} from '../supabase/functions/_shared/contracts/alerts.ts'
import {
  GAP_MONTHS_BANDS,
  INCOME_BANDS,
  RENT_BANDS,
  UNKNOWN_BAND,
} from '../supabase/functions/_shared/domain/market/run-bands.ts'

/**
 * Lives outside `_shared/domain` on purpose: it reads the filesystem, and the domain folder
 * must stay free of platform APIs so the same files compile under Deno and the browser.
 *
 * The schema uses CHECK constraints rather than Postgres enums so the spec can still move.
 * The cost is that a literal can drift: a state added to the TypeScript union but not to the
 * database would fail at write time, in the demo. These tests close that gap.
 */

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

const migrations = readdirSync(migrationsDir)
  .filter((name: string) => name.endsWith('.sql'))
  .sort()
  .map((name: string) => readFileSync(join(migrationsDir, name), 'utf8'))
  .join('\n')

/**
 * Pulls the literals out of the last `check (<column> in (...))` for a column ON ONE TABLE.
 *
 * Scoped to the table because column names repeat: `need_decisions.state` is a different
 * thing from `applications.state`, and an unscoped search quietly started comparing the
 * application states against the wrong constraint the moment the second table existed. The
 * last match within the table still wins, so a later migration widening a constraint counts.
 */
function checkConstraintLiterals(table: string, column: string): readonly string[] {
  // Everything the migrations say about this table: its definition and any later alters.
  const blocks = [
    ...migrations.matchAll(
      new RegExp(`create table public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'gi'),
    ),
    ...migrations.matchAll(new RegExp(`alter table public\\.${table}[\\s\\S]*?;`, 'gi')),
  ]
    .map((match) => match[0])
    .join('\n')

  const pattern = new RegExp(`${column}\\s+in\\s*\\(([^)]*)\\)`, 'gis')
  const last = [...blocks.matchAll(pattern)].at(-1)
  if (!last?.[1]) return []

  return [...last[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined)
}

describe('the database agrees with the TypeScript unions', () => {
  it('finds the migration to check against', () => {
    expect(migrations.length).toBeGreaterThan(1_000)
  })

  it('accepts exactly the twelve application states (§13)', () => {
    expect([...checkConstraintLiterals('applications', 'state')].sort()).toEqual(
      [...APPLICATION_STATES].sort(),
    )
  })

  /**
   * The gap this closes cost a working demonstration. A migration made `customer` the default
   * case kind; the Zod row schema still accepted only `presenter` and `audience`, so every
   * case in the system failed to parse and every conversation died on load.
   */
  it('accepts exactly the four case kinds', () => {
    expect([...checkConstraintLiterals('cases', 'kind')].sort()).toEqual([...CASE_KINDS].sort())
  })

  /**
   * The column this test did not know about.
   *
   * `savings` and `current_account` were added to applications.product in two migrations and
   * to neither this column nor this file. Every interest written for them violated the
   * constraint and failed silently for a week, which showed up as §49 not working: a declined
   * product had no row to be declined in, so Saoirse offered it back.
   */
  it('agrees with applications about what a product is', () => {
    expect([...checkConstraintLiterals('product_interests', 'product')].sort()).toEqual(
      [...PRODUCTS].sort(),
    )
  })

  it('accepts exactly the five products (§7)', () => {
    expect([...checkConstraintLiterals('applications', 'product')].sort()).toEqual(
      [...PRODUCTS].sort(),
    )
  })

  it('accepts exactly the six fact sources (§10)', () => {
    expect([...checkConstraintLiterals('facts', 'source')].sort()).toEqual([...FACT_SOURCES].sort())
  })

  it('accepts exactly the five document types', () => {
    expect([...checkConstraintLiterals('documents', 'document_type')].sort()).toEqual(
      [...DOCUMENT_TYPES].sort(),
    )
  })

  it('only allows resuming into a pre-submission state', () => {
    expect([...checkConstraintLiterals('applications', 'resume_to')].sort()).toEqual([
      'in_progress',
      'ready',
      'waiting_customer',
      'waiting_partner',
    ])
  })
})

describe('the schema keeps the invariants', () => {
  it('grants no client insert, update or delete anywhere (Invariant 2)', () => {
    const writePolicies = [...migrations.matchAll(/for\s+(insert|update|delete|all)\b/gi)]
    expect(writePolicies.map((m) => m[0])).toEqual([])
  })

  it('gives tokens, sessions, customers and the admin roster no read policy at all', () => {
    for (const table of ['tokens', 'participant_sessions', 'customers', 'admin_users']) {
      expect(migrations, table).not.toMatch(
        new RegExp(`create policy \\w+ on public\\.${table}`, 'i'),
      )
    }
  })

  it('enables row level security on every table it creates', () => {
    const created = [...migrations.matchAll(/create table public\.(\w+)/g)].map((m) => m[1])
    const secured = new Set(
      [...migrations.matchAll(/alter table public\.(\w+) enable row level security/g)].map(
        (m) => m[1],
      ),
    )

    expect(created.length).toBeGreaterThan(10)
    expect(created.filter((table) => table !== undefined && !secured.has(table))).toEqual([])
  })

  it('stores only a hash of a token, never the token (Invariant 8)', () => {
    expect(migrations).toMatch(/token_hash text not null unique/)
    expect(migrations).not.toMatch(/\btoken text\b/)
  })

  it('accepts exactly the calculator-run bands, counties and kinds', () => {
    const sorted = (values: readonly string[]) => [...values].sort()
    expect(sorted(checkConstraintLiterals('calculator_runs', 'income_band'))).toEqual(
      sorted([...INCOME_BANDS, UNKNOWN_BAND]),
    )
    expect(sorted(checkConstraintLiterals('calculator_runs', 'gap_months_band'))).toEqual(
      sorted([...GAP_MONTHS_BANDS, UNKNOWN_BAND]),
    )
    expect(sorted(checkConstraintLiterals('calculator_runs', 'rent_band'))).toEqual(
      sorted(RENT_BANDS),
    )
    expect(sorted(checkConstraintLiterals('calculator_runs', 'county'))).toEqual(
      sorted(LOCAL_AREAS),
    )
    expect(sorted(checkConstraintLiterals('calculator_runs', 'property_kind'))).toEqual(
      sorted(PROPERTY_KINDS),
    )
  })

  it('accepts exactly the alert and reminder kinds', () => {
    const sorted = (values: readonly string[]) => [...values].sort()
    expect(sorted(checkConstraintLiterals('plan_alerts', 'kind'))).toEqual(sorted(ALERT_KINDS))
    expect(sorted(checkConstraintLiterals('reminders', 'kind'))).toEqual(sorted(REMINDER_KINDS))
    expect(migrations).toMatch(new RegExp(`stage in \\(${REMINDER_STAGES.join(', ')}\\)`))
  })
})
