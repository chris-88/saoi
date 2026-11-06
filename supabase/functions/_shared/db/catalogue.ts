import { knowledgeProductSchema, mortgageRateSchema } from '../contracts/catalogue.ts'
import type { KnowledgeProduct } from '../tenants/demo/kb-types.ts'
import { demoKnowledgeBase } from '../tenants/demo/knowledge-base.ts'
import type { MortgageRate } from '../tenants/demo/mortgage-rate-types.ts'
import { demoMortgageRates } from '../tenants/demo/mortgage-rates.ts'
import type { Db } from './case-repository.ts'

/**
 * The catalogue and the rate table as Saoirse should use them this turn (§51).
 *
 * Rows in the database when there are any, the compiled files when there are none. The
 * compiled files are the published set, read from the bank's site on a date; the rows are what
 * a presenter has loaded and edited since. Each row is re-validated on the way out, so a row
 * that somehow stopped matching its schema is skipped with a note in the logs rather than
 * handed to the prompt or to `selectRates`.
 *
 * One query each, at the start of a turn, on the service role. The result goes into the cached
 * prompt prefix, which stays byte-identical turn to turn as long as the rows do, so caching is
 * unaffected until somebody edits something, and then it rewrites once.
 */

export type LoadedCatalogue = {
  readonly products: readonly KnowledgeProduct[]
  /** Whether the rows came from the database rather than the compiled file. */
  readonly loaded: boolean
}

export type LoadedRates = {
  readonly rates: readonly MortgageRate[]
  /** The date every figure carries: the table's own, or the latest edit if later. */
  readonly asOf: string
  readonly loaded: boolean
}

export async function loadProductCatalogue(client: Db): Promise<LoadedCatalogue> {
  const result = await client.from('product_catalogue').select('id, product, enabled')
  const rows = (result.data ?? []) as { id: string; product: unknown; enabled: boolean }[]

  if (result.error !== null || rows.length === 0) {
    return { products: demoKnowledgeBase.products, loaded: false }
  }

  return { products: productsFrom(rows), loaded: true }
}

export function productsFrom(
  rows: readonly { readonly id: string; readonly product: unknown; readonly enabled: boolean }[],
): readonly KnowledgeProduct[] {
  return rows.flatMap((row) => {
    if (!row.enabled) return []
    const parsed = knowledgeProductSchema.safeParse(row.product)
    if (!parsed.success) {
      console.error(`product_catalogue row ${row.id} does not match its schema; skipped`)
      return []
    }
    // The schema is the compiled type as Zod, proven by the contract test on every published row.
    return [parsed.data as KnowledgeProduct]
  })
}

export async function loadMortgageRates(client: Db): Promise<LoadedRates> {
  const published = demoMortgageRates.metadata.public_rates_table_last_update.slice(0, 10)
  const result = await client.from('mortgage_rates').select('id, rate, enabled, updated_at')
  const rows = (result.data ?? []) as {
    id: string
    rate: unknown
    enabled: boolean
    updated_at: string
  }[]

  if (result.error !== null || rows.length === 0) {
    return { rates: demoMortgageRates.rates, asOf: published, loaded: false }
  }

  return { rates: ratesFrom(rows), asOf: asOfFrom(published, rows), loaded: true }
}

export function ratesFrom(
  rows: readonly { readonly id: string; readonly rate: unknown; readonly enabled: boolean }[],
): readonly MortgageRate[] {
  return rows.flatMap((row) => {
    if (!row.enabled) return []
    const parsed = mortgageRateSchema.safeParse(row.rate)
    if (!parsed.success) {
      console.error(`mortgage_rates row ${row.id} does not match its schema; skipped`)
      return []
    }
    return [parsed.data as MortgageRate]
  })
}

/**
 * One value as text, the same text whatever order its keys arrived in.
 *
 * Postgres stores jsonb with its own key order, so a row read back never stringifies the same
 * as the object that was written. Comparing "is this row still the published one" needs both
 * sides in one order, and this is the one order.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The published products, in the shape the schema stores: what a loaded row is compared to. */
export function publishedProducts(): ReadonlyMap<string, string> {
  return new Map(
    demoKnowledgeBase.products.map((product) => [
      product.id,
      canonical(knowledgeProductSchema.parse(product)),
    ]),
  )
}

export function publishedRates(): ReadonlyMap<string, string> {
  return new Map(
    demoMortgageRates.rates.map((rate) => [rate.id, canonical(mortgageRateSchema.parse(rate))]),
  )
}

/** Whether a stored payload still says what the published file says. Unpublished ids are edits. */
export function differsFromPublished(
  published: ReadonlyMap<string, string>,
  id: string,
  payload: unknown,
): boolean {
  return published.get(id) !== canonical(payload)
}

/**
 * The date a figure carries.
 *
 * The published table has its own date, and every rate Saoirse states cites it. A rate somebody
 * edited yesterday is not "as of" last November, so the later of the two is used: the latest
 * edit among rows that differ from the published set, or the published date if nothing does.
 */
export function asOfFrom(
  published: string,
  rows: readonly { readonly id: string; readonly rate: unknown; readonly updated_at: string }[],
): string {
  const compiled = publishedRates()
  const edited = rows
    .filter((row) => differsFromPublished(compiled, row.id, row.rate))
    .map((row) => row.updated_at.slice(0, 10))
    .sort()

  const latest = edited[edited.length - 1]
  return latest !== undefined && latest > published ? latest : published
}
