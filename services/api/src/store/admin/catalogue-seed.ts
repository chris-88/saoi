import {
  knowledgeProductSchema,
  mortgageRateSchema,
  type KnowledgeProductInput,
  type MortgageRateInput,
} from '@shared/contracts/catalogue.ts'
import type { Insert } from '@shared/db/case-repository.ts'
import type { Json } from '@shared/db/database.types.ts'
import { demoKnowledgeBase } from '@shared/tenants/demo/knowledge-base.ts'
import { demoMortgageRates } from '@shared/tenants/demo/mortgage-rates.ts'
import type { Db } from '../client.ts'
import { must } from '../client.ts'

/** The two tables the console edits row by row. */
export type CatalogueTable = 'product_catalogue' | 'mortgage_rates'

/**
 * Copy the published file into its table, leaving any row already there alone (§51).
 *
 * `ignoreDuplicates` makes it a no-op on ids that exist, so loading twice changes nothing and
 * loading after an edit keeps the edit. What comes back is what was actually added. Every write
 * goes through here first: a table with one row in it is the whole catalogue the next turn
 * reads, and thirty products must not vanish from Saoirse because somebody corrected a sentence.
 */
export async function seedProducts(db: Db): Promise<number> {
  const result = await db
    .from('product_catalogue')
    .upsert(
      demoKnowledgeBase.products.map((product) => ({
        id: product.id,
        product: knowledgeProductSchema.parse(product) as unknown as Json,
        enabled: true,
        version: 1,
      })) as Insert<'product_catalogue'>[],
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id')
  return (must(result, 'the published product catalogue') ?? []).length
}

export async function seedRates(db: Db): Promise<number> {
  const result = await db
    .from('mortgage_rates')
    .upsert(
      demoMortgageRates.rates.map((rate) => ({
        id: rate.id,
        rate: mortgageRateSchema.parse(rate),
        enabled: true,
        version: 1,
      })) as Insert<'mortgage_rates'>[],
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id')
  return (must(result, 'the published mortgage rate table') ?? []).length
}

/** The next version of a row, counting saves from the console and nothing else. */
export async function nextVersion(db: Db, table: CatalogueTable, id: string): Promise<number> {
  const existing = await db.from(table).select('version').eq('id', id).maybeSingle()
  return (existing.data?.version ?? 0) + 1
}

export const compiledProduct = (id: string): KnowledgeProductInput | undefined => {
  const found = demoKnowledgeBase.products.find((product) => product.id === id)
  return found === undefined ? undefined : knowledgeProductSchema.parse(found)
}

export const compiledRate = (id: string): MortgageRateInput | undefined => {
  const found = demoMortgageRates.rates.find((rate) => rate.id === id)
  return found === undefined ? undefined : mortgageRateSchema.parse(found)
}
