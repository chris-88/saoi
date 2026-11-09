import type {
  AccessKind,
  DepositGuarantee,
  DepositTerms,
  ProductTerms,
  ProductView,
  Provenance,
  UnknownField,
} from '../../contracts/market-tools.ts'
import { BANK_CCPC_PAIRS } from '../../market/bank-ccpc-pairs.ts'
import type { DepositRates, MarketProduct } from '../../market/schema.ts'
import type { Market, MarketRecord } from './types.ts'

/**
 * Market rows into one comparable view per product.
 *
 * The rows come from two sources with different shapes. CCPC lists every fixed term as its own
 * product; the bank's own page is one product with a ladder. CCPC gives a regular saver's
 * balance bands; the bank gives a cap and a rate above it. Bank of Ireland is read from both.
 * The comparison needs one shape, so this is where:
 *
 * - CCPC's per-term rows fold into a ladder (same provider, same name once the term is taken
 *   out, same limits);
 * - Bank of Ireland's own row is shown and its CCPC twin is set aside, by the pairing recorded
 *   in `market/bank-ccpc-pairs.ts`, and the view names what it set aside;
 * - products reached through the Raisin platform are flagged, with the home country's deposit
 *   guarantee where the source names it;
 * - every view carries where it came from, when it was checked, when it last changed and the
 *   attribution the source requires;
 * - anything the source does not give stays unknown, named, and is never read as zero.
 */

const DIRT_FREE = '0'

/** Where Saoi has recorded the licence a provider's deposits are guaranteed under. */
const RECORDED_GUARANTEES: Readonly<Record<string, DepositGuarantee>> = {
  boi: irish(),
  aib: irish(),
  ptsb: irish(),
  ebs: irish(),
  haven: irish(),
  credit_union: irish(),
  state_savings: {
    scheme: 'Guaranteed by the State (Ireland State Savings, managed by the NTMA)',
    country: 'Ireland',
    coverEur: null,
    basis: 'recorded_by_saoi',
  },
}

function irish(): DepositGuarantee {
  return {
    scheme: 'Deposit Guarantee Scheme (Central Bank of Ireland)',
    country: 'Ireland',
    coverEur: 100_000,
    basis: 'recorded_by_saoi',
  }
}

/** Providers whose deposits Saoi records as Irish-licensed: DIRT is taken at source. */
const IRISH_PROVIDERS: ReadonlySet<string> = new Set(
  Object.entries(RECORDED_GUARANTEES)
    .filter(([, guarantee]) => guarantee.country === 'Ireland')
    .map(([provider]) => provider),
)

/** The adjective a source uses for a scheme, to the country. */
const SCHEME_COUNTRIES: Readonly<Record<string, string>> = {
  german: 'Germany',
  italian: 'Italy',
  swedish: 'Sweden',
  dutch: 'Netherlands',
  spanish: 'Spain',
  french: 'France',
  maltese: 'Malta',
  austrian: 'Austria',
  belgian: 'Belgium',
  portuguese: 'Portugal',
  lithuanian: 'Lithuania',
  latvian: 'Latvia',
  estonian: 'Estonia',
  irish: 'Ireland',
  polish: 'Poland',
  czech: 'Czechia',
  finnish: 'Finland',
  luxembourg: 'Luxembourg',
}

/** What each path in a row's `unknown` means, in words. */
const UNKNOWN_MEANINGS: Readonly<Record<string, string>> = {
  'conditions.minAge': 'the minimum age to open it',
  'conditions.takesLumpSum': 'whether it takes a lump sum',
  'conditions.takesMonthly': 'whether it takes regular monthly saving',
  'conditions.maxLumpSumEur': 'the most that can be deposited',
  'rates.basis': 'whether the rate is fixed or variable',
  'rates.lumpSumAerPct': 'the rate paid on a lump sum',
  'rates.thenAerPct': 'the rate after the introductory or fixed period',
  'rates.aprcPct': 'the APRC',
  'rates.minAmountEur': 'the smallest amount that can be borrowed',
  'rates.rateType': 'whether the rate is fixed or variable',
  'rates.maxTermMonths': 'the longest term',
}

const meaningOf = (field: string): string => UNKNOWN_MEANINGS[field] ?? field

const rowKey = (product: MarketProduct): string =>
  `${product.provider}|${product.source}|${product.productId}`
const rowId = (product: MarketProduct): string => `${product.provider}:${product.productId}`

/**
 * Saoi compares providers that operate in Ireland (Chris, 2026-11-09): Irish banks and credit
 * unions, State Savings, and EU banks with an Irish branch or service (bunq, Revolut, Avant
 * Money, MoCo). Banks reached only through the Raisin deposit platform are left out of the
 * comparison; their rows stay in `market_products`. `includePlatforms` is for tests.
 */
export type NormaliseOptions = { readonly includePlatforms?: boolean }

export function normaliseMarket(
  records: readonly MarketRecord[],
  options: NormaliseOptions = {},
): Market {
  const includePlatforms = options.includePlatforms ?? false
  const versions = new Map<string, MarketRecord[]>()
  for (const record of records) {
    const key = rowKey(record.product)
    versions.set(key, [...(versions.get(key) ?? []), record])
  }
  const current = records.filter((record) => record.supersededAt === null)
  const providerNames = providerNamesFrom(current)

  const products: ProductView[] = []
  const recordsOf = new Map<string, readonly MarketRecord[]>()
  const viewOfRow = new Map<string, string>()
  const used = new Set<string>()

  const emit = (view: ProductView, rows: readonly MarketRecord[]) => {
    if (view.platform !== null && !includePlatforms) {
      for (const row of rows) used.add(rowKey(row.product))
      return
    }
    products.push(view)
    recordsOf.set(
      view.id,
      rows.flatMap((row) => versions.get(rowKey(row.product)) ?? [row]),
    )
    for (const row of rows) {
      viewOfRow.set(rowId(row.product), view.id)
      used.add(rowKey(row.product))
    }
  }

  // ---- Bank-direct rows, with the CCPC rows they replace ---------------------------------
  for (const bank of current.filter((record) => record.product.source === 'bank')) {
    const twins = current.filter(
      (record) =>
        record.product.source === 'ccpc' &&
        BANK_CCPC_PAIRS.some(
          (pair) =>
            pair.provider === bank.product.provider &&
            pair.bankId === bank.product.productId &&
            pair.category === record.product.category &&
            record.product.provider === pair.provider &&
            pair.ccpcName.test(record.product.providerProductName) &&
            (pair.termMonths === undefined ||
              (record.product.rates.kind === 'deposit' &&
                record.product.rates.termMonths === pair.termMonths)),
        ),
    )
    const view = viewFor({
      id: rowId(bank.product),
      rows: [bank],
      setAside: twins,
      versions,
      providerNames,
    })
    emit(view, [bank, ...twins])
  }

  // ---- CCPC fixed terms, folded into ladders ---------------------------------------------
  const ladders = new Map<string, MarketRecord[]>()
  for (const record of current) {
    if (used.has(rowKey(record.product))) continue
    const key = ladderKey(record.product)
    if (key === null) continue
    ladders.set(key, [...(ladders.get(key) ?? []), record])
  }
  for (const rungs of ladders.values()) {
    const months = rungs.map((rung) => termOf(rung.product))
    // Two rows for the same term are two products, not one ladder.
    if (rungs.length < 2 || new Set(months).size !== months.length) continue
    const first = [...rungs].sort((a, b) => termOf(a.product) - termOf(b.product))[0]
    if (first === undefined) continue
    const slug = slugOf(baseName(first.product.providerProductName))
    emit(
      viewFor({
        id: `${first.product.provider}:${first.product.category}.ladder_${slug}`,
        rows: rungs,
        setAside: [],
        versions,
        providerNames,
      }),
      rungs,
    )
  }

  // ---- Everything else, one row each ------------------------------------------------------
  for (const record of current) {
    if (used.has(rowKey(record.product))) continue
    emit(
      viewFor({ id: rowId(record.product), rows: [record], setAside: [], versions, providerNames }),
      [record],
    )
  }

  return { products, recordsOf, viewOfRow }
}

// -------------------------------------------------------------------------------------------
// Ladders
// -------------------------------------------------------------------------------------------

/** `12 Month`, `- 3 months`, `1 Year`, `7 years`: the term in a product's name. */
const TERM_IN_NAME = /[-–]?\s*\b\d+\s*(?:month|months|mth|year|years|yr|yrs)\b/gi

const baseName = (name: string): string =>
  name
    .replace(TERM_IN_NAME, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–]\s*$/, '')
    .trim()

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'fixed_term'

function termOf(product: MarketProduct): number {
  return product.rates.kind === 'deposit' ? (product.rates.termMonths ?? 0) : 0
}

/** Rows that can share a ladder share this key; null for a row that is not a fixed term. */
function ladderKey(product: MarketProduct): string | null {
  if (product.source !== 'ccpc' || product.rates.kind !== 'deposit') return null
  if (fixedTermOf(product) === null) return null
  const { conditions } = product
  return [
    product.provider,
    product.category,
    baseName(product.providerProductName).toLowerCase(),
    conditions.minLumpSumEur ?? '',
    conditions.maxLumpSumEur ?? '',
  ].join('|')
}

/**
 * The term, when a row is a fixed-term deposit: a fixed rate with a term, and a reversion the
 * source does not leave unknown. A fixed rate for a term followed by an unstated rate is an
 * introductory offer on an account the money can leave (Raisin's demand deposits), not a term.
 */
function fixedTermOf(product: MarketProduct): number | null {
  const rates = product.rates
  if (rates.kind !== 'deposit' || rates.termMonths === undefined) return null
  if (rates.basis !== 'fixed') return null
  if ((product.unknown ?? []).includes('rates.thenAerPct')) return null
  return rates.termMonths
}

// -------------------------------------------------------------------------------------------
// One view
// -------------------------------------------------------------------------------------------

type ViewInput = {
  readonly id: string
  /** The rows the figures come from: one, or the rungs of a ladder. */
  readonly rows: readonly MarketRecord[]
  /** Rows for the same product from another source, set aside. */
  readonly setAside: readonly MarketRecord[]
  readonly versions: ReadonlyMap<string, readonly MarketRecord[]>
  readonly providerNames: ReadonlyMap<string, string>
}

function viewFor(input: ViewInput): ProductView {
  const rows = [...input.rows].sort((a, b) => termOf(a.product) - termOf(b.product))
  const head = rows[0]
  if (head === undefined) throw new Error(`no rows for ${input.id}`)
  const product = head.product
  const providerName = input.providerNames.get(product.provider) ?? product.provider
  const platform = platformOf(product)
  const unknowns = unknownsOf(rows.map((row) => row.product))
  const terms = termsFor(
    rows.map((row) => row.product),
    unknowns,
  )
  const name = rows.length > 1 ? baseName(product.providerProductName) : product.providerProductName

  return {
    id: input.id,
    provider: product.provider,
    providerName,
    name,
    category: product.category,
    terms,
    provenance: provenanceOf(rows, input.setAside, input.versions),
    platform: platform ? { name: 'Raisin', note: raisinNote(providerName) } : null,
    depositGuarantee:
      terms.kind === 'deposit'
        ? guaranteeOf(
            rows.map((row) => row.product),
            unknowns,
          )
        : null,
    unknowns,
    rateConfirmed: rateConfirmed(product, terms),
    checks: checksFor(product, providerName, terms, platform),
  }
}

/**
 * Whether a savings or deposit rate is confirmed beyond CCPC's one figure. CCPC states a rate
 * and nothing after it; bunq's "3.11% variable" turned out to be a bonus that lasts only until
 * the next threshold reset. A fixed term is confirmed (the money comes back at maturity); a
 * provider's own page, or a stated reversion, confirms the rest.
 */
function rateConfirmed(product: MarketProduct, terms: ProductTerms): boolean {
  if (terms.kind !== 'deposit') return true
  if (product.source === 'bank' || terms.access === 'fixed_term') return true
  return terms.introductory !== null && terms.introductory.thenAerPct !== null
}

function providerNamesFrom(records: readonly MarketRecord[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const { product } of records) {
    const stated = product.conditions.details?.['CCPC provider name']
    if (stated === undefined || names.has(product.provider)) continue
    names.set(
      product.provider,
      stated
        .replace(/\s+via\s+.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
  }
  return names
}

function provenanceOf(
  rows: readonly MarketRecord[],
  setAside: readonly MarketRecord[],
  versions: ReadonlyMap<string, readonly MarketRecord[]>,
): Provenance {
  const head = rows[0]
  if (head === undefined) throw new Error('no rows')
  const all = rows.flatMap((row) => versions.get(rowKey(row.product)) ?? [row])
  const changed = rows
    .filter((row) => (versions.get(rowKey(row.product)) ?? []).length > 1)
    .map((row) => row.firstSeenAt)
  const earliest = (values: readonly string[]) => [...values].sort()[0] ?? null
  const latest = (values: readonly string[]) => [...values].sort().at(-1) ?? null

  return {
    source: head.product.source,
    sourceUrl: head.product.sourceUrl,
    providerUrl: head.product.providerUrl ?? null,
    // The oldest check of any row the figures rest on: freshness is the stalest part.
    checkedAt: earliest(rows.map((row) => row.product.checkedAt)) ?? head.product.checkedAt,
    lastChangedAt: latest(changed),
    firstRecordedAt: earliest(all.map((row) => row.firstSeenAt)) ?? head.firstSeenAt,
    attribution: head.product.attribution ?? null,
    rows: rows.map((row) => ({ source: row.product.source, productId: row.product.productId })),
    preferredOver: setAside.map((row) => ({
      source: row.product.source,
      productId: row.product.productId,
      providerProductName: row.product.providerProductName,
    })),
  }
}

function unknownsOf(products: readonly MarketProduct[]): UnknownField[] {
  const fields = new Set(products.flatMap((product) => product.unknown ?? []))
  return [...fields].sort().map((field) => ({ field, meaning: meaningOf(field) }))
}

// -------------------------------------------------------------------------------------------
// Terms by kind
// -------------------------------------------------------------------------------------------

function termsFor(products: readonly MarketProduct[], unknowns: UnknownField[]): ProductTerms {
  const head = products[0]
  if (head === undefined) throw new Error('no products')
  const rates = head.rates
  switch (rates.kind) {
    case 'deposit':
      return depositTerms(products, rates, unknowns)
    case 'mortgage': {
      const named = /\bBER\s+([A-G][1-3]?|Exempt)\b/i.exec(head.providerProductName)?.[1] ?? null
      const details = head.conditions.details ?? {}
      const cashbackText = details['Cashback description'] ?? details['Cashback'] ?? null
      const pctText = /(\d+(?:\.\d+)?)\s*%/.exec(cashbackText ?? '')?.[1]
      return {
        kind: 'mortgage',
        rateType: rates.rateType,
        fixedYears: rates.fixedYears,
        initialRatePct: rates.initialRatePct,
        followOnRatePct: rates.followOnRatePct,
        fullTermRatePct: rates.fullTermRatePct,
        ltvMinPct: rates.ltvMinPct,
        ltvMaxPct: rates.ltvMaxPct,
        ber: rates.ber ?? named,
        berFromName: rates.ber === null && named !== null,
        buyerTypes: [...rates.customerTypes],
        cashback: {
          offered: rates.cashback,
          pct: rates.cashback === true && pctText !== undefined ? Number(pctText) : null,
          stated: cashbackText,
        },
        fees: Object.fromEntries(
          Object.entries(details).filter(([label]) => /fee|charge/i.test(label)),
        ),
        highValue: /\bHVM\b|high value/i.test(head.providerProductName),
      }
    }
    case 'loan': {
      const stated = head.conditions.details?.['Maximum term:'] ?? null
      const months = loanTermMonths(stated, rates.maxTermMonths)
      if (months === null && stated !== null) {
        // The refresh names it unknown too since 2026-11-09; one entry, with CCPC's words.
        const at = unknowns.findIndex((unknown) => unknown.field === 'rates.maxTermMonths')
        if (at >= 0) unknowns.splice(at, 1)
        unknowns.push({
          field: 'rates.maxTermMonths',
          meaning: `the longest term: CCPC gives “${stated}” with no unit`,
        })
      }
      return {
        kind: 'loan',
        aprPct: rates.aprPct,
        rateType: rates.rateType,
        maxAmountEur: rates.maxAmountEur,
        maxTermMonths: months,
        maxTermStated: stated,
        purposes: [...rates.purposes],
        setupFees: head.conditions.details?.['Set-up fees:'] ?? null,
      }
    }
    case 'credit_card':
      return {
        kind: 'credit_card',
        aprPct: rates.aprPct,
        purchaseRatePct: rates.purchaseRatePct,
        cashRatePct: rates.cashRatePct,
        balanceTransfer:
          rates.balanceTransferIntroMonths !== null &&
          rates.balanceTransferIntroMonths > 0 &&
          rates.balanceTransferIntroPct !== null
            ? {
                introMonths: rates.balanceTransferIntroMonths,
                introPct: rates.balanceTransferIntroPct,
              }
            : null,
      }
    case 'current_account':
      return {
        kind: 'current_account',
        quarterlyFeeEur: rates.quarterlyFeeEur,
        annualFeeEur: rates.quarterlyFeeEur === null ? null : rates.quarterlyFeeEur * 4,
        creditInterestPct: rates.creditInterestPct,
        overdraft: rates.overdraft,
      }
  }
}

/**
 * A loan's longest term in months, from the words CCPC gives: "60 months", "10 Years". The
 * stored figure reads "10 Years" as ten months, so the words win, and a bare "7" is not read.
 */
function loanTermMonths(stated: string | null, stored: number | null): number | null {
  if (stated === null) return stored
  const value = Number(/(\d+(?:\.\d+)?)/.exec(stated)?.[1])
  if (!Number.isFinite(value) || value <= 0) return null
  if (/month/i.test(stated)) return Math.round(value)
  if (/year|yr/i.test(stated)) return Math.round(value * 12)
  return null
}

function depositTerms(
  products: readonly MarketProduct[],
  rates: DepositRates,
  unknowns: UnknownField[],
): DepositTerms {
  const head = products[0]
  if (head === undefined) throw new Error('no products')
  const { conditions } = head
  const fixedTerm = fixedTermOf(head)

  const ladder =
    rates.terms !== undefined
      ? rates.terms.map((term) => ({
          months: term.months,
          aerPct: term.aerPct,
          productId: head.productId,
        }))
      : fixedTerm !== null
        ? products.flatMap((product) =>
            product.rates.kind === 'deposit' &&
            product.rates.termMonths !== undefined &&
            product.rates.aerPct !== null
              ? [
                  {
                    months: product.rates.termMonths,
                    aerPct: product.rates.aerPct,
                    productId: product.productId,
                  },
                ]
              : [],
          )
        : []

  const noticeDays =
    rates.noticeDays ??
    (() => {
      const named = /(\d+)[\s-]*day[\s-]*notice/i.exec(head.providerProductName)?.[1]
      return named === undefined ? null : Number(named)
    })()

  const access: AccessKind =
    ladder.length > 0 ? 'fixed_term' : noticeDays !== null && noticeDays > 0 ? 'notice' : 'instant'

  const thenUnknown = (head.unknown ?? []).includes('rates.thenAerPct')
  const introMonths =
    rates.fixedMonths ??
    (access !== 'fixed_term' && rates.basis === 'fixed' ? rates.termMonths : undefined)
  const introductory =
    introMonths === undefined
      ? null
      : { months: introMonths, thenAerPct: thenUnknown ? null : (rates.thenAerPct ?? null) }
  if (introductory !== null && introductory.thenAerPct === null && !thenUnknown) {
    unknowns.push({ field: 'rates.thenAerPct', meaning: meaningOf('rates.thenAerPct') })
  }

  const bonus = conditions.bonus
  return {
    kind: 'deposit',
    access,
    noticeDays: access === 'fixed_term' ? (noticeDays ?? null) : noticeDays,
    aerPct: ladder.length > 1 ? null : (rates.aerPct ?? ladder[0]?.aerPct ?? null),
    basis: rates.basis,
    bands: ladder.length > 0 ? [] : bandsOf(rates),
    thresholdBonus:
      rates.thresholdBonus === undefined
        ? null
        : {
            bonusAerPct: rates.thresholdBonus.bonusAerPct,
            resetMonths: [...rates.thresholdBonus.resetMonths],
            lookbackMonths: rates.thresholdBonus.lookbackMonths,
            baseBands: rates.thresholdBonus.baseTiers.map((tier) => ({
              fromEur: tier.minEur,
              toEur: tier.maxEur,
              aerPct: tier.aerPct,
            })),
          },
    lumpSumAerPct: rates.lumpSumAerPct ?? null,
    introductory,
    ladder: [...ladder].sort((a, b) => a.months - b.months),
    takesMonthly: conditions.takesMonthly ?? null,
    takesLumpSum: conditions.takesLumpSum ?? null,
    minMonthlyEur: conditions.minMonthlyEur ?? null,
    maxMonthlyEur: conditions.maxMonthlyEur ?? null,
    minLumpSumEur: conditions.minLumpSumEur ?? null,
    maxLumpSumEur: conditions.maxLumpSumEur ?? null,
    dirtApplies: conditions.details?.['DIRT applicable:'] !== DIRT_FREE,
    bonus:
      bonus === undefined
        ? null
        : {
            amountEur: bonus.amountEur,
            conditions: [
              `At least €${String(bonus.minMonthlyEur)} a month for ${String(bonus.minMonths)} months in a row.`,
              `At least €${bonus.minTotalEur.toLocaleString('en-IE')} saved.`,
              ...(bonus.firstTimeBuyerOnly ? ['First-time buyers only.'] : []),
              ...(bonus.requiresMortgageHere
                ? [
                    `A mortgage drawn down with the same provider within ${String(bonus.withinMonths)} months.`,
                  ]
                : []),
              ...(bonus.lessDirt ? ['Paid less DIRT.'] : []),
            ],
          },
  }
}

/** Balance bands, lowest first, the last one open-ended. */
function bandsOf(rates: DepositRates): DepositTerms['bands'] {
  if (rates.tiers !== undefined) {
    const sorted = [...rates.tiers].sort((a, b) => a.minEur - b.minEur)
    return sorted.map((tier, index) => ({
      fromEur: index === 0 ? 0 : Math.round(sorted[index - 1]?.maxEur ?? tier.minEur),
      toEur:
        index === sorted.length - 1 ? null : tier.maxEur === null ? null : Math.round(tier.maxEur),
      aerPct: tier.aerPct,
    }))
  }
  if (rates.aerPct === null) return []
  if (rates.tierCapEur !== undefined && rates.aboveTierAerPct !== undefined) {
    return [
      { fromEur: 0, toEur: rates.tierCapEur, aerPct: rates.aerPct },
      { fromEur: rates.tierCapEur, toEur: null, aerPct: rates.aboveTierAerPct },
    ]
  }
  return [{ fromEur: 0, toEur: null, aerPct: rates.aerPct }]
}

// -------------------------------------------------------------------------------------------
// Platform, guarantee, eligibility
// -------------------------------------------------------------------------------------------

function textOf(product: MarketProduct): string {
  return [
    ...Object.values(product.conditions.prose ?? {}),
    ...Object.values(product.conditions.details ?? {}),
  ].join('\n')
}

function platformOf(product: MarketProduct): boolean {
  const details = product.conditions.details ?? {}
  return (
    /raisin/i.test(details['Platform'] ?? '') ||
    /via\s+raisin/i.test(details['CCPC provider name'] ?? '') ||
    /open a free (?:online )?(?:raisin account|account with raisin)/i.test(textOf(product))
  )
}

const raisinNote = (providerName: string): string =>
  `Opened through Raisin (raisin.ie), not with ${providerName} directly: a free Raisin account comes first. The deposit is held by ${providerName}.`

function guaranteeOf(
  products: readonly MarketProduct[],
  unknowns: UnknownField[],
): DepositGuarantee {
  const head = products[0]
  if (head === undefined) throw new Error('no products')
  // Every rung's words: a ladder's shortest term is not always the row that names the scheme.
  const text = products.map(textOf).join('\n')
  const adjective = /\b([A-Za-z]+)\s+deposit\s+guarantee\s+(?:scheme|fund)/i.exec(text)?.[1]
  const country = adjective === undefined ? undefined : SCHEME_COUNTRIES[adjective.toLowerCase()]
  if (adjective !== undefined && country !== undefined) {
    const name = adjective.charAt(0).toUpperCase() + adjective.slice(1).toLowerCase()
    return {
      scheme: `${name} Deposit Guarantee Scheme`,
      country,
      // Harmonised across the EU by the Deposit Guarantee Schemes Directive.
      coverEur: 100_000,
      basis: 'stated_by_source',
    }
  }
  const recorded = RECORDED_GUARANTEES[head.provider]
  if (recorded !== undefined) return recorded
  unknowns.push({ field: 'depositGuarantee', meaning: 'which deposit guarantee scheme covers it' })
  return { scheme: null, country: null, coverEur: null, basis: 'unknown' }
}

function checksFor(
  product: MarketProduct,
  providerName: string,
  terms: ProductTerms,
  platform: boolean,
): string[] {
  const checks: string[] = []
  const name = product.providerProductName
  if (platform) checks.push('Needs a Raisin account, opened online at raisin.ie.')
  if (terms.kind === 'deposit' && terms.dirtApplies && !IRISH_PROVIDERS.has(product.provider)) {
    checks.push(
      'Tax: a bank outside Ireland may not take DIRT at source; the interest is then declared to Revenue. The figures take DIRT off at 33% either way.',
    )
  }
  if (/child|kid|junior|teen/i.test(name)) checks.push('The name suggests it is for children.')
  if (/student|third level|graduate/i.test(name)) {
    checks.push('The name suggests it is for students.')
  }
  if (/varies by cu|credit union/i.test(name) || product.provider.startsWith('credit_union')) {
    checks.push('Credit union rates and terms vary by credit union; membership is needed.')
  }
  if (product.conditions.minAge !== undefined) {
    checks.push(`Minimum age ${String(product.conditions.minAge)}.`)
  }
  if (terms.kind === 'deposit' && terms.bonus !== null) {
    checks.push(`The €${terms.bonus.amountEur.toLocaleString('en-IE')} bonus is conditional.`)
  }
  if (terms.kind === 'mortgage') {
    if (terms.highValue) checks.push('A high-value-mortgage rate: for larger loans only.')
    if (terms.ber !== null) checks.push(`The rate is for a property with BER ${terms.ber}.`)
  }
  checks.push(
    product.source === 'ccpc'
      ? `Check eligibility with ${providerName}: CCPC does not record who can open it (for example, whether an account with ${providerName} is needed first).`
      : `Check eligibility with ${providerName}: the rates and limits were read from its own page; who can open it is not recorded.`,
  )
  return checks
}
