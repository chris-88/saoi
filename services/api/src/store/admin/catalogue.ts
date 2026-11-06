import { catalogueOverridesSchema, type CatalogueOverrides } from '@shared/contracts/admin.ts'
import {
  knowledgeProductSchema,
  mortgageRateSchema,
  type KnowledgeProductInput,
  type MortgageRateInput,
  type MortgageRatesList,
  type ProductCatalogueList,
} from '@shared/contracts/catalogue.ts'
import {
  asOfFrom,
  differsFromPublished,
  publishedProducts,
  publishedRates,
} from '@shared/db/catalogue.ts'
import type { Json } from '@shared/db/database.types.ts'
import { catalogueOverrideRow, toOverride } from '@shared/db/rows.ts'
import { checkinKey } from '@shared/domain/catalogue/overlay.ts'
import { goalCatalogue } from '@shared/domain/goals/catalogue.ts'
import { needCatalogue } from '@shared/domain/needs/catalogue.ts'
import { demoKnowledgeBase } from '@shared/tenants/demo/knowledge-base.ts'
import { demoMortgageRates } from '@shared/tenants/demo/mortgage-rates.ts'
import { ApiError } from '../../errors.ts'
import type { Db } from '../client.ts'
import { must } from '../client.ts'
import {
  compiledProduct,
  compiledRate,
  nextVersion,
  seedProducts,
  seedRates,
} from './catalogue-seed.ts'

export type CatalogueOverrideInput = {
  readonly kind: 'goal' | 'need'
  readonly entryId: string
  readonly enabled: boolean
  readonly name: string | null
  readonly summary: string | null
  readonly priority: CatalogueOverrides['overrides'][number]['priority']
  readonly milestoneLabels: Record<string, string>
  readonly checkinAgendas: Record<string, string[]>
}

export interface AdminCatalogueStore {
  listOverrides(): Promise<CatalogueOverrides>
  setOverride(input: CatalogueOverrideInput): Promise<{ version: number }>
  clearOverride(kind: 'goal' | 'need', entryId: string): Promise<void>

  listProducts(): Promise<ProductCatalogueList>
  setProduct(
    id: string,
    product: KnowledgeProductInput,
    enabled: boolean,
  ): Promise<{ version: number }>
  deleteProduct(id: string): Promise<void>
  loadPublishedProducts(): Promise<{ inserted: number }>
  restoreProduct(id: string): Promise<{ version: number }>

  listRates(): Promise<MortgageRatesList>
  setRate(id: string, rate: MortgageRateInput, enabled: boolean): Promise<{ version: number }>
  deleteRate(id: string): Promise<void>
  loadPublishedRates(): Promise<{ inserted: number }>
  restoreRate(id: string): Promise<{ version: number }>
}

type StoredRow = { id: string; enabled: boolean; version: number; updated_at: string }

/** Plan §3.2: checked against the compiled catalogue before anything is written. */
function validateOverride(input: CatalogueOverrideInput): void {
  const entry =
    input.kind === 'goal'
      ? goalCatalogue.find((goal) => goal.id === input.entryId)
      : needCatalogue.find((need) => need.id === input.entryId)

  if (entry === undefined) {
    throw new ApiError('not_found', `No ${input.kind} called ${input.entryId}.`)
  }
  if (input.priority !== null && input.kind !== 'need') {
    throw new ApiError('bad_request', 'Only a need has a priority. A goal is ranked by evidence.')
  }

  if ('milestones' in entry) {
    const ids = new Set(entry.milestones.map((milestone) => milestone.id))
    const unknown = Object.keys(input.milestoneLabels).find((id) => !ids.has(id))
    if (unknown !== undefined) {
      throw new ApiError('bad_request', `${input.entryId} has no milestone ${unknown}.`)
    }
    const keys = new Set(entry.checkins.map(checkinKey))
    const stray = Object.keys(input.checkinAgendas).find((key) => !keys.has(key))
    if (stray !== undefined) {
      throw new ApiError('bad_request', `${input.entryId} has no check-in ${stray}.`)
    }
  } else if (
    Object.keys(input.milestoneLabels).length > 0 ||
    Object.keys(input.checkinAgendas).length > 0
  ) {
    throw new ApiError('bad_request', 'A need has no milestones or check-ins.')
  }
}

export function supabaseAdminCatalogueStore(db: Db): AdminCatalogueStore {
  return {
    async listOverrides() {
      const result = await db
        .from('catalogue_overrides')
        .select(
          'kind, entry_id, enabled, name, summary, priority, milestone_labels, checkin_agendas, version, created_at, updated_at',
        )
      const data = must(result, 'the catalogue overrides')
      return catalogueOverridesSchema.parse({
        overrides: catalogueOverrideRow.array().parse(data).map(toOverride),
      })
    },

    async setOverride(input) {
      validateOverride(input)

      // `version` is bumped here, not by a trigger, so it counts saves from this action only.
      const existing = await db
        .from('catalogue_overrides')
        .select('version')
        .eq('kind', input.kind)
        .eq('entry_id', input.entryId)
        .maybeSingle()
      const version = (existing.data?.version ?? 0) + 1

      must(
        await db.from('catalogue_overrides').upsert(
          {
            kind: input.kind,
            entry_id: input.entryId,
            enabled: input.enabled,
            name: input.name,
            summary: input.summary,
            priority: input.priority,
            milestone_labels: input.milestoneLabels,
            checkin_agendas: input.checkinAgendas,
            version,
          },
          { onConflict: 'kind,entry_id' },
        ),
        'the catalogue override',
      )
      // No event row: a catalogue edit is global and `events` is per case.
      return { version }
    },

    async clearOverride(kind, entryId) {
      must(
        await db.from('catalogue_overrides').delete().eq('kind', kind).eq('entry_id', entryId),
        'the catalogue override',
      )
    },

    async listProducts() {
      const result = await db
        .from('product_catalogue')
        .select('id, product, enabled, version, updated_at')
        .order('id')
      const stored = must(result, 'the product catalogue') as (StoredRow & { product: unknown })[]

      if (stored.length === 0) {
        const asOf = demoKnowledgeBase.metadata['as_of']
        return {
          loaded: false,
          rows: demoKnowledgeBase.products.map((product) => ({
            id: product.id,
            product: knowledgeProductSchema.parse(product),
            enabled: true,
            edited: false,
            published: true,
            version: 0,
            updatedAt: typeof asOf === 'string' ? asOf : '',
          })),
        }
      }

      const published = publishedProducts()
      return {
        loaded: true,
        rows: stored.map((row) => ({
          id: row.id,
          product: row.product as KnowledgeProductInput,
          enabled: row.enabled,
          edited: differsFromPublished(published, row.id, row.product),
          published: published.has(row.id),
          version: row.version,
          updatedAt: row.updated_at,
        })),
      }
    },

    async setProduct(id, product, enabled) {
      if (product.id !== id) {
        throw new ApiError('bad_request', 'The row id and the product id must match.')
      }
      await seedProducts(db)
      const version = await nextVersion(db, 'product_catalogue', id)
      must(
        await db.from('product_catalogue').upsert(
          {
            id,
            product: product as unknown as Json,
            enabled,
            version,
          },
          { onConflict: 'id' },
        ),
        'the product row',
      )
      return { version }
    },

    async deleteProduct(id) {
      await seedProducts(db)
      must(await db.from('product_catalogue').delete().eq('id', id), 'the product row')
    },

    async loadPublishedProducts() {
      return { inserted: await seedProducts(db) }
    },

    /** Back to the file's wording. A product the file does not have is removed, which is the same thing. */
    async restoreProduct(id) {
      const compiled = compiledProduct(id)
      if (compiled === undefined) {
        must(await db.from('product_catalogue').delete().eq('id', id), 'the product row')
        return { version: 0 }
      }
      await seedProducts(db)
      const version = await nextVersion(db, 'product_catalogue', id)
      must(
        await db.from('product_catalogue').upsert(
          {
            id,
            product: compiled as unknown as Json,
            enabled: true,
            version,
          },
          { onConflict: 'id' },
        ),
        'the product row',
      )
      return { version }
    },

    async listRates() {
      const result = await db
        .from('mortgage_rates')
        .select('id, rate, enabled, version, updated_at')
        .order('id')
      const stored = must(result, 'the mortgage rates') as (StoredRow & { rate: unknown })[]

      const publishedOn = demoMortgageRates.metadata.public_rates_table_last_update.slice(0, 10)
      if (stored.length === 0) {
        return {
          loaded: false,
          asOf: publishedOn,
          rows: demoMortgageRates.rates.map((rate) => ({
            id: rate.id,
            rate: mortgageRateSchema.parse(rate),
            enabled: true,
            edited: false,
            published: true,
            version: 0,
            updatedAt: publishedOn,
          })),
        }
      }

      const published = publishedRates()
      return {
        loaded: true,
        asOf: asOfFrom(publishedOn, stored),
        rows: stored.map((row) => ({
          id: row.id,
          rate: row.rate as MortgageRateInput,
          enabled: row.enabled,
          edited: differsFromPublished(published, row.id, row.rate),
          published: published.has(row.id),
          version: row.version,
          updatedAt: row.updated_at,
        })),
      }
    },

    async setRate(id, rate, enabled) {
      if (rate.id !== id) {
        throw new ApiError('bad_request', 'The row id and the rate id must match.')
      }
      await seedRates(db)
      const version = await nextVersion(db, 'mortgage_rates', id)
      must(
        await db.from('mortgage_rates').upsert(
          {
            id,
            rate: rate,
            enabled,
            version,
          },
          { onConflict: 'id' },
        ),
        'the rate row',
      )
      return { version }
    },

    async deleteRate(id) {
      await seedRates(db)
      must(await db.from('mortgage_rates').delete().eq('id', id), 'the rate row')
    },

    async loadPublishedRates() {
      return { inserted: await seedRates(db) }
    },

    async restoreRate(id) {
      const compiled = compiledRate(id)
      if (compiled === undefined) {
        must(await db.from('mortgage_rates').delete().eq('id', id), 'the rate row')
        return { version: 0 }
      }
      await seedRates(db)
      const version = await nextVersion(db, 'mortgage_rates', id)
      must(
        await db.from('mortgage_rates').upsert(
          {
            id,
            rate: compiled,
            enabled: true,
            version,
          },
          { onConflict: 'id' },
        ),
        'the rate row',
      )
      return { version }
    },
  }
}
