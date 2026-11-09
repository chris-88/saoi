import type { MarketProduct } from '../../supabase/functions/_shared/market/schema.ts'

/**
 * What a refresh found, compared with what was held before: every field that moved, by path.
 * `checkedAt` is not content, so it never counts as a change.
 */

export type FieldChange = { readonly path: string; readonly from: unknown; readonly to: unknown }

export type MarketDiff = {
  readonly added: readonly MarketProduct[]
  readonly changed: readonly {
    readonly productId: string
    readonly fields: readonly FieldChange[]
  }[]
  readonly unchanged: readonly string[]
  readonly disappeared: readonly string[]
}

type Flat = ReadonlyMap<string, unknown>

function flatten(value: unknown, prefix: string, into: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${String(index)}]`, into))
    if (value.length === 0) into.set(prefix, [])
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) flatten(item, prefix === '' ? key : `${prefix}.${key}`, into)
    }
    return
  }
  into.set(prefix, value)
}

function content(product: MarketProduct): Flat {
  const into = new Map<string, unknown>()
  const { checkedAt: _checkedAt, ...rest } = product
  flatten(rest, '', into)
  return into
}

export function diffMarket(
  before: readonly MarketProduct[],
  after: readonly MarketProduct[],
): MarketDiff {
  const held = new Map(before.map((product) => [product.productId, product]))
  const found = new Set(after.map((product) => product.productId))

  const added: MarketProduct[] = []
  const changed: { productId: string; fields: FieldChange[] }[] = []
  const unchanged: string[] = []

  for (const product of after) {
    const previous = held.get(product.productId)
    if (previous === undefined) {
      added.push(product)
      continue
    }
    const from = content(previous)
    const to = content(product)
    const paths = [...new Set([...from.keys(), ...to.keys()])].sort()
    const fields = paths
      .filter((path) => JSON.stringify(from.get(path)) !== JSON.stringify(to.get(path)))
      .map((path) => ({ path, from: from.get(path), to: to.get(path) }))
    if (fields.length === 0) unchanged.push(product.productId)
    else changed.push({ productId: product.productId, fields })
  }

  const disappeared = before
    .map((product) => product.productId)
    .filter((productId) => !found.has(productId))

  return { added, changed, unchanged, disappeared }
}

const show = (value: unknown): string => (value === undefined ? '(none)' : JSON.stringify(value))

export function describeDiff(diff: MarketDiff): readonly string[] {
  return [
    ...diff.changed.flatMap(({ productId, fields }) => [
      `changed  ${productId}`,
      ...fields.map(
        (field) => `           ${field.path}: ${show(field.from)} -> ${show(field.to)}`,
      ),
    ]),
    ...diff.added.map(
      (product) => `added    ${product.productId} (${product.providerProductName})`,
    ),
    ...diff.disappeared.map((productId) => `GONE     ${productId}`),
    ...diff.unchanged.map((productId) => `same     ${productId}`),
  ]
}
