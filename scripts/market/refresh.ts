/**
 * Refresh Saoi's market data from the CCPC comparison tables (`ccpc.ts`), which cover every
 * provider CCPC lists. CCPC is the source of every rate in the application (Chris, 2026-11-13);
 * provider sites are not read for rates, and the Bank of Ireland, bunq and MoCo page readers
 * were removed with that decision.
 *
 *   npm run market:refresh                       fetch, parse, validate and print the diff; writes nothing
 *   npm run market:refresh -- --snapshot         also rewrite the committed CCPC snapshot
 *   npm run market:refresh -- --db               also record the result in market_products
 *   npm run market:refresh -- --provider boi     one provider's CCPC rows only (no snapshot)
 *
 * --db needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment. Against the live
 * stack on this machine:
 *
 *   SUPABASE_URL=http://127.0.0.1:8002 \
 *   SUPABASE_SERVICE_ROLE_KEY="$(pass show infra/saoi/SERVICE_ROLE_KEY | head -1)" \
 *   npm run market:refresh -- --db
 *
 * The diff is against the database with --db, otherwise against the committed snapshot.
 *
 * All or nothing per provider. A CCPC request that fails means nothing from CCPC is written (the
 * sweep would be incomplete, so absences could not be trusted), and a CCPC item that cannot be
 * read means nothing is written for that provider. One provider failing never stops another
 * being written. A product gone from a complete sweep is retired, unless more than half a
 * provider's products went at once, which fails that provider instead. The snapshot is written
 * only when every provider was read.
 *
 * Exit codes: 0 when every provider was read (and written, if asked); 1 when any failed, or the
 * run could not start (bad arguments, no database credentials).
 *
 * Polite by construction: robots.txt is read first on every host and every URL checked against
 * it (a 4xx answer is "unavailable" under RFC 9309 and allows everything; any other non-200
 * stops that source), the requests go one at a time with a pause between them, and the user
 * agent says who is asking.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../../supabase/functions/_shared/db/database.types.ts'
import {
  MARKET_COLUMNS,
  productsFromRows,
  rowFor,
} from '../../supabase/functions/_shared/db/market.ts'
import {
  type MarketProduct,
  marketProductSchema,
  type MarketSnapshot,
  marketSnapshotSchema,
  type MarketSource,
  CCPC_ATTRIBUTION,
} from '../../supabase/functions/_shared/market/schema.ts'
import { ccpcSnapshot } from '../../supabase/functions/_shared/market/ccpc.snapshot.ts'
import {
  type Built,
  CCPC_API,
  CCPC_ORIGIN,
  CCPC_TOOL_PAGES,
  ccpcListSchema,
  ccpcQueries,
  merge,
  termBandSchema,
} from './ccpc.ts'
import { mortgageCheck } from './mortgage-check.ts'
import { describeDiff, diffMarket } from './diff.ts'
import { robotsAllows } from './robots.ts'
import { runProviders } from './run.ts'

const USER_AGENT = 'saoi-market-refresh/0.1 (+https://saoi.ie; one run, a handful of pages)'
const API_PAUSE_MS = 1_500

const argv = process.argv.slice(2)
const args = new Set(argv)
const writeSnapshot = args.has('--snapshot')
const writeDb = args.has('--db')
const valueOf = (flag: string) => (args.has(flag) ? argv[argv.indexOf(flag) + 1] : undefined)
const onlyProvider = valueOf('--provider')
const onlySource = valueOf('--source')

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Page = { readonly status: number; readonly html: string }
type Db = ReturnType<typeof createClient<Database>>

async function get(url: string): Promise<Page> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  return { status: response.status, html: await response.text() }
}

async function post(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': USER_AGENT,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  })
  const raw = await response.text()
  try {
    return { status: response.status, json: JSON.parse(raw) as unknown }
  } catch {
    return { status: response.status, json: null }
  }
}

/** Null when every URL may be fetched; otherwise why not. */
async function robotsCheck(origin: string, urls: readonly string[]): Promise<string | null> {
  const robots = await get(`${origin}/robots.txt`)
  if (robots.status >= 400 && robots.status < 500) {
    console.log(
      `${origin}/robots.txt answered ${String(robots.status)}: "unavailable" under RFC 9309, no restrictions`,
    )
    return null
  }
  if (robots.status !== 200) return `${origin}/robots.txt answered ${String(robots.status)}`
  const refused = urls.filter((url) => !robotsAllows(robots.html, new URL(url).pathname))
  return refused.length === 0 ? null : `${origin}/robots.txt disallows ${refused.join(', ')}`
}

function databaseClient(): Db {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (url === undefined || key === undefined || url === '' || key === '') {
    throw new Error('--db needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

const SNAPSHOT_FILE = fileURLToPath(
  new URL('../../supabase/functions/_shared/market/ccpc.snapshot.ts', import.meta.url),
)

function snapshotSource(snapshot: MarketSnapshot): string {
  return [
    '// GENERATED by scripts/market/refresh.ts (npm run market:refresh -- --snapshot). Do not edit by hand.',
    '//',
    '// Every product in the Competition and Consumer Protection Commission’s comparison tables,',
    '// every provider, as Saoi read them on the date below: the source of every rate, and the',
    '// fallback when `market_products` holds no CCPC rows.',
    '//',
    `// ${CCPC_ATTRIBUTION}`,
    '',
    "import type { MarketSnapshot } from './schema.ts'",
    '',
    `export const ccpcSnapshot: MarketSnapshot = ${JSON.stringify(snapshot, null, 2)}`,
    '',
  ].join('\n')
}

// ---- What a source yields -----------------------------------------------------------------

/** One provider's rows from one source: the unit that is written all or nothing. */
type Group = {
  readonly provider: string
  readonly source: MarketSource
  readonly products: MarketProduct[]
  readonly failures: string[]
}

type Harvest = {
  readonly name: string
  readonly source: MarketSource
  /** Set when the source as a whole could not be read: nothing from it is written. */
  readonly failure: string | null
  readonly groups: readonly Group[]
}

async function harvestCcpc(checkedAt: string): Promise<Harvest> {
  const fail = (failure: string): Harvest => ({ name: 'ccpc', source: 'ccpc', failure, groups: [] })

  const apiOrigin = CCPC_API.replace(/\/$/, '')
  const termTypes = `${CCPC_API}account/get-lump-sum-term-types`
  const refusedApi = await robotsCheck(apiOrigin, [termTypes])
  if (refusedApi !== null) return fail(refusedApi)
  await pause(API_PAUSE_MS)
  const refusedSite = await robotsCheck(CCPC_ORIGIN, Object.values(CCPC_TOOL_PAGES))
  if (refusedSite !== null) return fail(refusedSite)

  await pause(API_PAUSE_MS)
  const bands = await post(termTypes, undefined)
  const termBands = termBandSchema.safeParse(bands.json)
  if (bands.status !== 200 || !termBands.success || termBands.data.length === 0) {
    return fail(`term types answered ${String(bands.status)} with no usable bands`)
  }
  const queries = ccpcQueries(termBands.data.filter((band) => band.Description.trim() !== ''))
  const refusedQueries = await robotsCheckCached(
    apiOrigin,
    queries.map((q) => CCPC_API + q.endpoint),
  )
  if (refusedQueries !== null) return fail(refusedQueries)

  const merged = new Map<string, Built>()
  const itemFailures = new Map<string, string[]>()
  const generated = new Set<string>()
  console.log(
    `\nccpc: ${String(queries.length)} requests to ${CCPC_API}, ${String(API_PAUSE_MS / 1000)}s apart`,
  )

  for (const [index, query] of queries.entries()) {
    await pause(API_PAUSE_MS)
    let answer: { status: number; json: unknown }
    try {
      answer = await post(CCPC_API + query.endpoint, query.body)
    } catch (error) {
      return fail(`${query.label}: request failed (${String(error)})`)
    }
    const list = ccpcListSchema.safeParse(answer.json)
    if (answer.status !== 200 || !list.success) {
      return fail(`${query.label}: answered ${String(answer.status)}, not a product list`)
    }
    console.log(
      `  ${String(index + 1)}/${String(queries.length)} ${query.label}: ${String(list.data.length)}`,
    )
    for (const item of list.data) {
      try {
        const built = query.build(item)
        if (built.generatedProvider)
          generated.add(`${item.ProviderName} -> ${built.product.provider}`)
        merge(merged, built)
      } catch (error) {
        const id = item.ProviderName
        itemFailures.set(id, [
          ...(itemFailures.get(id) ?? []),
          `c${String(item.Id)} ${item.ProductName}: ${error instanceof Error ? error.message : String(error)}`,
        ])
      }
    }
  }

  for (const line of generated) console.log(`NEW PROVIDER  ${line} (add it to ccpc-providers.ts)`)

  const groups = new Map<string, Group>()
  const groupFor = (provider: string): Group => {
    const held = groups.get(provider)
    if (held !== undefined) return held
    const group: Group = { provider, source: 'ccpc', products: [], failures: [] }
    groups.set(provider, group)
    return group
  }
  for (const { product } of merged.values()) {
    const group = groupFor(product.provider)
    const parsed = marketProductSchema.safeParse({ ...product, checkedAt })
    if (parsed.success) group.products.push(parsed.data)
    else {
      group.failures.push(
        `${product.productId} ${product.providerProductName}: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      )
    }
  }
  for (const [providerName, failures] of itemFailures) {
    const id = [...merged.values()].find(
      (built) => built.product.conditions.details?.['CCPC provider name'] === providerName,
    )?.product.provider
    groupFor(id ?? providerName.toLowerCase().replace(/[^a-z0-9]+/g, '_')).failures.push(
      ...failures,
    )
  }

  return { name: 'ccpc', source: 'ccpc', failure: null, groups: [...groups.values()] }
}

const robotsCache = new Map<string, string | null>()
async function robotsCheckCached(origin: string, urls: readonly string[]): Promise<string | null> {
  const key = `${origin} ${urls.join(' ')}`
  if (!robotsCache.has(key)) {
    await pause(API_PAUSE_MS)
    robotsCache.set(key, await robotsCheck(origin, urls))
  }
  return robotsCache.get(key) ?? null
}

// ---- Settling a group: diff, decide, write ------------------------------------------------

async function settle(group: Group, db: Db | null): Promise<boolean> {
  const label = `${group.provider}/${group.source}`

  let baseline: readonly MarketProduct[] = ccpcSnapshot.products.filter(
    (product) => product.provider === group.provider && product.source === group.source,
  )
  let baselineName = `the committed snapshot (${ccpcSnapshot.checkedAt})`
  if (db !== null) {
    const result = await db
      .from('market_products')
      .select(MARKET_COLUMNS)
      .eq('provider', group.provider)
      .eq('source', group.source)
      .is('superseded_at', null)
    if (result.error !== null) {
      console.error(`${label}: reading market_products: ${result.error.message}`)
      return false
    }
    baseline = productsFromRows(result.data)
    baselineName = `market_products (${String(baseline.length)} current rows)`
  }

  const failed = (productId: string) =>
    group.failures.some(
      (failure) => failure.startsWith(`${productId}:`) || failure.startsWith(`${productId} `),
    )
  const diff = diffMarket(baseline, group.products)
  const disappeared = diff.disappeared.filter((productId) => !failed(productId))

  console.log(`\n${label}: ${String(group.products.length)} products, against ${baselineName}`)
  // Hundreds of rows: say what moved, count the rest.
  for (const line of describeDiff({ ...diff, added: [], unchanged: [], disappeared: [] })) {
    console.log(line)
  }
  const added = diff.added.map((product) => product.providerProductName)
  console.log(
    `added ${String(added.length)}, same ${String(diff.unchanged.length)}, changed ${String(diff.changed.length)}` +
      (added.length > 0 && added.length <= 6 ? `: ${added.join('; ')}` : ''),
  )
  for (const productId of disappeared) console.log(`GONE     ${productId}`)
  for (const failure of group.failures) console.error(`COULD NOT READ  ${label} ${failure}`)

  if (group.failures.length > 0) {
    console.error(
      `${label}: ${String(group.failures.length)} failure(s). Nothing written for ${label}.`,
    )
    return false
  }
  if (baseline.length >= 4 && disappeared.length > baseline.length / 2) {
    console.error(
      `${label}: ${String(disappeared.length)} of ${String(baseline.length)} products gone at once, ` +
        'which looks like a broken sweep rather than a withdrawal. Nothing written.',
    )
    return false
  }
  if (group.products.length === 0) {
    if (disappeared.length === 0) return true
    console.error(`${label}: nothing listed this run. Nothing written.`)
    return false
  }

  if (db !== null) {
    const result = await db.rpc('market_record_refresh', {
      p_provider: group.provider,
      p_source: group.source,
      // Validated above; JSON all the way down.
      p_products: group.products.map(rowFor) as unknown as Json,
      p_retired: disappeared,
    })
    if (result.error !== null) {
      console.error(`${label}: market_record_refresh: ${result.error.message}`)
      return false
    }
    const done = result.data as Record<string, readonly string[]> | null
    console.log(
      `market_products: ` +
        Object.entries(done ?? {})
          .map(([key, ids]) => `${key} ${String(ids.length)}`)
          .join(', '),
    )
  }

  return true
}

// ---- The run ------------------------------------------------------------------------------

type Step = { readonly provider: string; readonly run: () => Promise<Harvest> }

async function main(): Promise<number> {
  if (onlySource !== undefined && onlySource !== 'ccpc') {
    console.error(
      `Source ${onlySource} is not read: CCPC is the source of every rate (2026-11-13), and ` +
        'the provider-site readers were removed.',
    )
    return 1
  }
  if (writeSnapshot && onlyProvider !== undefined) {
    console.error('--snapshot writes every provider; it cannot be combined with --provider.')
    return 1
  }
  const checkedAt = new Date().toISOString()
  const steps: Step[] = [{ provider: 'ccpc', run: () => harvestCcpc(checkedAt) }]

  const db = writeDb ? databaseClient() : null
  const settled: Group[] = []

  const failed = await runProviders(steps, async (step) => {
    const harvest = await step.run()
    if (harvest.failure !== null) {
      console.error(`\n${harvest.name}: ${harvest.failure}. Nothing written from ${harvest.name}.`)
      return false
    }
    const groups = harvest.groups.filter(
      (group) => onlyProvider === undefined || group.provider === onlyProvider,
    )
    const results = await runProviders(
      groups.map((group) => ({ provider: `${group.provider}/${group.source}`, group })),
      async ({ group }) => {
        const ok = await settle(group, db)
        if (ok) settled.push(group)
        return ok
      },
    )
    return results.length === 0
  })

  report(settled)

  if (writeSnapshot) {
    if (failed.length > 0) {
      console.error('\nSnapshot not written: not every provider was read.')
    } else {
      const products = settled
        .flatMap((group) => group.products)
        .sort(
          (a, b) => a.provider.localeCompare(b.provider) || a.productId.localeCompare(b.productId),
        )
      const snapshot = marketSnapshotSchema.parse({
        provider: 'ccpc',
        checkedAt,
        rateSheet: null,
        products,
      })
      writeFileSync(SNAPSHOT_FILE, snapshotSource(snapshot))
      execFileSync('npx', ['prettier', '--write', '--log-level', 'warn', SNAPSHOT_FILE], {
        stdio: 'inherit',
      })
      console.log(`\nwrote ${SNAPSHOT_FILE} (${String(products.length)} products)`)
    }
  }

  if (db === null && !writeSnapshot) console.log('\nDry run: nothing written.')
  if (failed.length > 0) {
    console.error(`\nFailed: ${failed.join(', ')}. Everything else was handled.`)
    return 1
  }
  return 0
}

/** Counts per category and provider, and the mortgage data check. */
function report(groups: readonly Group[]): void {
  const ccpc = groups.filter((group) => group.source === 'ccpc')
  if (ccpc.length > 0) {
    const counts = new Map<string, Map<string, number>>()
    for (const group of ccpc) {
      for (const product of group.products) {
        const row = counts.get(product.category) ?? new Map<string, number>()
        row.set(group.provider, (row.get(group.provider) ?? 0) + 1)
        counts.set(product.category, row)
      }
    }
    console.log('\nccpc rows by category:')
    for (const [category, row] of counts) {
      const total = [...row.values()].reduce((sum, n) => sum + n, 0)
      const parts = [...row.entries()].sort().map(([provider, n]) => `${provider} ${String(n)}`)
      console.log(`  ${category} ${String(total)}: ${parts.join(', ')}`)
    }
  }

  console.log('\nmortgages, a data check:')
  for (const line of mortgageCheck(
    groups.flatMap((group) => group.products),
    new Date().toISOString().slice(0, 10),
  )) {
    if (line.includes('CHECK')) console.warn(line)
    else console.log(line)
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
