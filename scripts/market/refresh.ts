/**
 * Refresh Saoi's market data from every source: each provider's own website (`providers.ts`)
 * and the CCPC comparison tables (`ccpc.ts`), which cover every provider CCPC lists.
 *
 *   npm run market:refresh                       fetch, parse, validate and print the diff; writes nothing
 *   npm run market:refresh -- --snapshot         also rewrite each bank-direct provider's committed snapshot
 *   npm run market:refresh -- --db               also record the result in market_products
 *   npm run market:refresh -- --accept-removals  let a bank-direct product whose page has gone be retired
 *   npm run market:refresh -- --provider boi     one provider only (its own site, and its CCPC rows)
 *   npm run market:refresh -- --source ccpc      one source only (bank or ccpc)
 *
 * --db needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment. Against the live
 * stack on this machine:
 *
 *   SUPABASE_URL=http://127.0.0.1:8002 \
 *   SUPABASE_SERVICE_ROLE_KEY="$(pass show infra/saoi/SERVICE_ROLE_KEY | head -1)" \
 *   npm run market:refresh -- --db
 *
 * The diff is against the database with --db, otherwise against the committed snapshot (bank
 * rows) or nothing (CCPC rows, which have no snapshot).
 *
 * All or nothing per provider and source. A bank-direct provider whose page cannot be read or
 * parsed writes nothing; a CCPC request that fails means nothing from CCPC is written (the sweep
 * would be incomplete, so absences could not be trusted), and a CCPC item that cannot be read
 * means nothing from CCPC is written for that provider. One provider or source failing never
 * stops another being written. A product gone from a complete CCPC sweep is retired, unless more
 * than half a provider's products went at once, which fails that provider instead. A bank-direct
 * page that has gone (404) fails unless --accept-removals.
 *
 * Exit codes: 0 when every provider and source was read (and written, if asked); 1 when any
 * failed, or the run could not start (bad arguments, no database credentials). Cross-check
 * differences between Bank of Ireland's own pages and CCPC are warnings and do not change it.
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
} from '../../supabase/functions/_shared/market/schema.ts'
import { ParseError } from './boi.ts'
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
import { crossCheckBoi } from './crosscheck.ts'
import { mortgageCheck } from './mortgage-check.ts'
import { describeDiff, diffMarket } from './diff.ts'
import type { MarketProvider } from './provider.ts'
import { MARKET_PROVIDERS } from './providers.ts'
import { robotsAllows } from './robots.ts'
import { runProviders } from './run.ts'

const USER_AGENT = 'saoi-market-refresh/0.1 (+https://saoi.ie; one run, a handful of pages)'
const PAGE_PAUSE_MS = 2_000
const API_PAUSE_MS = 1_500

const argv = process.argv.slice(2)
const args = new Set(argv)
const writeSnapshot = args.has('--snapshot')
const writeDb = args.has('--db')
const acceptRemovals = args.has('--accept-removals')
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

function snapshotFile(provider: string): string {
  return fileURLToPath(
    new URL(`../../supabase/functions/_shared/market/${provider}.snapshot.ts`, import.meta.url),
  )
}

function snapshotSource(snapshot: MarketSnapshot): string {
  return [
    '// GENERATED by scripts/market/refresh.ts (npm run market:refresh -- --snapshot). Do not edit by hand.',
    '//',
    `// ${snapshot.provider}: the published rates and conditions for the products Saoi models, read`,
    '// from the provider’s public website. The fallback when `market_products` is empty, and the',
    '// record in git of what the site said on the date below.',
    '',
    "import type { MarketSnapshot } from './schema.ts'",
    '',
    `export const ${snapshot.provider}Snapshot: MarketSnapshot = ${JSON.stringify(snapshot, null, 2)}`,
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
  /** Bank-direct pages that answered 404 or 410. */
  readonly gone: string[]
  /** Bank-direct only: the committed snapshot, its rate sheet this run. */
  readonly snapshot?: MarketSnapshot
  readonly rateSheet?: MarketSnapshot['rateSheet']
}

type Harvest = {
  readonly name: string
  readonly source: MarketSource
  /** Set when the source as a whole could not be read: nothing from it is written. */
  readonly failure: string | null
  readonly groups: readonly Group[]
}

async function harvestBank(provider: MarketProvider, checkedAt: string): Promise<Harvest> {
  const name = provider.provider
  const group: Group = {
    provider: name,
    source: 'bank',
    products: [],
    failures: [],
    gone: [],
    snapshot: provider.snapshot,
  }
  const urls = [
    ...(provider.rateSheet === undefined ? [] : [provider.rateSheet.page]),
    ...provider.sources.flatMap((source) => [source.url, ...(source.alsoRead ?? [])]),
  ]
  const refused = await robotsCheck(provider.origin, urls)
  if (refused !== null) return { name, source: 'bank', failure: refused, groups: [] }

  let rateSheet: MarketSnapshot['rateSheet'] = null
  if (provider.rateSheet !== undefined) {
    await pause(PAGE_PAUSE_MS)
    const page = await get(provider.rateSheet.page)
    rateSheet = page.status === 200 ? provider.rateSheet.read(page.html) : null
    if (rateSheet === null) console.warn(`${name}: no rate sheet on ${provider.rateSheet.page}`)
  }

  // A page two products share (bunq's, MoCo's FAQ) is fetched once a run.
  const fetched = new Map<string, Page>()
  const fetchOnce = async (url: string): Promise<Page> => {
    const seen = fetched.get(url)
    if (seen !== undefined) return seen
    await pause(PAGE_PAUSE_MS)
    const page = await get(url)
    fetched.set(url, page)
    return page
  }

  sources: for (const source of provider.sources) {
    const html: string[] = []
    for (const url of [source.url, ...(source.alsoRead ?? [])]) {
      let page: Page
      try {
        page = await fetchOnce(url)
      } catch (error) {
        group.failures.push(`${source.productId}: fetch failed on ${url} (${String(error)})`)
        continue sources
      }
      if (url === source.url && (page.status === 404 || page.status === 410)) {
        group.gone.push(source.productId)
        continue sources
      }
      if (page.status !== 200) {
        group.failures.push(`${source.productId}: ${url} answered ${String(page.status)}`)
        continue sources
      }
      html.push(page.html)
    }
    try {
      group.products.push({
        provider: name,
        source: 'bank',
        productId: source.productId,
        category: source.category,
        ...source.parse(html.join('\n')),
        sourceUrl: source.url,
        checkedAt,
        effectiveFrom: null,
      })
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
      group.failures.push(`${source.productId}: ${error.message} on ${source.url}`)
    }
  }

  const snapshot = marketSnapshotSchema.safeParse({
    provider: name,
    checkedAt,
    rateSheet,
    products: group.products,
  })
  if (!snapshot.success) {
    for (const issue of snapshot.error.issues) {
      group.failures.push(`schema: ${issue.path.join('.')}: ${issue.message}`)
    }
  }
  return { name, source: 'bank', failure: null, groups: [{ ...group, rateSheet }] }
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
    const group: Group = { provider, source: 'ccpc', products: [], failures: [], gone: [] }
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

  let baseline: readonly MarketProduct[] = group.snapshot?.products ?? []
  let baselineName =
    group.snapshot === undefined
      ? 'nothing (no snapshot for this source)'
      : `the committed snapshot (${group.snapshot.checkedAt})`
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
  const disappeared = [
    ...new Set([...group.gone, ...diff.disappeared.filter((productId) => !failed(productId))]),
  ]

  console.log(`\n${label}: ${String(group.products.length)} products, against ${baselineName}`)
  if (group.rateSheet !== undefined && group.rateSheet !== null) {
    console.log(`rate sheet: ${group.rateSheet.asOf ?? 'undated'} ${group.rateSheet.url}`)
  }
  if (group.source === 'bank') {
    for (const line of describeDiff({ ...diff, disappeared: [] })) console.log(line)
  } else {
    // Hundreds of rows: say what moved, count the rest.
    for (const line of describeDiff({ ...diff, added: [], unchanged: [], disappeared: [] })) {
      console.log(line)
    }
    const added = diff.added.map((product) => product.providerProductName)
    console.log(
      `added ${String(added.length)}, same ${String(diff.unchanged.length)}, changed ${String(diff.changed.length)}` +
        (added.length > 0 && added.length <= 6 ? `: ${added.join('; ')}` : ''),
    )
  }
  for (const productId of disappeared) console.log(`GONE     ${productId}`)
  for (const failure of group.failures) console.error(`COULD NOT READ  ${label} ${failure}`)

  if (group.failures.length > 0) {
    console.error(
      `${label}: ${String(group.failures.length)} failure(s). Nothing written for ${label}.`,
    )
    return false
  }
  if (group.source === 'bank' && disappeared.length > 0 && !acceptRemovals) {
    console.error(
      `${label}: a product has gone from the site. Nothing written. Check the page, then run ` +
        'again with --accept-removals to retire it.',
    )
    return false
  }
  if (group.source === 'ccpc' && baseline.length >= 4 && disappeared.length > baseline.length / 2) {
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

  if (writeSnapshot && group.snapshot !== undefined) {
    const snapshot: MarketSnapshot = {
      provider: group.provider,
      checkedAt: group.products[0]?.checkedAt ?? new Date().toISOString(),
      rateSheet: group.rateSheet ?? null,
      products: group.products,
    }
    const file = snapshotFile(group.provider)
    writeFileSync(file, snapshotSource(snapshot))
    execFileSync('npx', ['prettier', '--write', '--log-level', 'warn', file], { stdio: 'inherit' })
    console.log(`wrote ${file}`)
  }
  return true
}

// ---- The run ------------------------------------------------------------------------------

type Step = { readonly provider: string; readonly run: () => Promise<Harvest> }

async function main(): Promise<number> {
  if (onlySource !== undefined && onlySource !== 'bank' && onlySource !== 'ccpc') {
    console.error(`No source called ${onlySource}.`)
    return 1
  }
  const checkedAt = new Date().toISOString()
  const banks = MARKET_PROVIDERS.filter(
    (p) => onlyProvider === undefined || p.provider === onlyProvider,
  )
  const steps: Step[] = [
    ...(onlySource === 'ccpc'
      ? []
      : banks.map((p) => ({ provider: p.provider, run: () => harvestBank(p, checkedAt) }))),
    ...(onlySource === 'bank' ? [] : [{ provider: 'ccpc', run: () => harvestCcpc(checkedAt) }]),
  ]
  if (steps.length === 0) {
    console.error(`Nothing to run for provider ${String(onlyProvider)}.`)
    return 1
  }

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

  if (db === null && !writeSnapshot) console.log('\nDry run: nothing written.')
  if (failed.length > 0) {
    console.error(`\nFailed: ${failed.join(', ')}. Everything else was handled.`)
    return 1
  }
  return 0
}

/** Counts per category and provider, and the Bank of Ireland cross-check. */
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

  const bank = groups.find((g) => g.provider === 'boi' && g.source === 'bank')?.products
  const fromCcpc = groups.find((g) => g.provider === 'boi' && g.source === 'ccpc')?.products
  if (bank === undefined || fromCcpc === undefined) return
  const check = crossCheckBoi(bank, fromCcpc)
  console.log('\nBank of Ireland, its own pages against CCPC:')
  if (check.differences.length === 0) console.log('  every figure both state agrees')
  for (const line of check.differences) console.warn(`  WARNING ${line}`)
  for (const line of check.missingFromCcpc) console.warn(`  WARNING ${line}: not found on CCPC`)
  for (const line of check.notReadFromBank) console.log(`  on CCPC only: ${line}`)
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
