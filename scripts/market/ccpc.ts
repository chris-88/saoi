import { z } from 'zod'
import {
  CCPC_ATTRIBUTION,
  type MarketCategory,
  type MarketConditions,
  type MarketProduct,
  type MarketRates,
  MORTGAGE_CUSTOMER_TYPES,
} from '../../supabase/functions/_shared/market/schema.ts'
import { providerFor } from './ccpc-providers.ts'
import { cashbackOffered } from '../../supabase/functions/_shared/market/cashback.ts'
import { decodeEntities } from './html.ts'

/**
 * The Competition and Consumer Protection Commission's comparison tables, as a market data
 * source for every provider they list.
 *
 * The tools on ccpc.ie are rendered in the browser from a JSON API at compare.ccpc.ie; this
 * calls the same endpoints with the same request bodies the tools send. Results are filtered by
 * the amount, band or term asked about, so a complete list is the union of a sweep: several
 * amounts for savings, each notice and term band for deposits, a spread of loan-to-value and
 * property values for each mortgage list, a spread of amounts and terms for loans.
 *
 * Reuse: CCPC's legal statement licenses its own content under CC-BY 4.0 and asks for prior
 * written approval for commercial use of the comparison data, which the banks supply. Chris's
 * decision (2026-11-09) is to prototype on it, attributed, and seek approval once there is
 * revenue. Every row carries `CCPC_ATTRIBUTION`.
 *
 * Gaps are recorded, not filled: what CCPC does not state and Saoi would need goes in the row's
 * `unknown`, prose goes verbatim into `conditions.prose`, and every field CCPC states goes
 * verbatim into `conditions.details`.
 */

export const CCPC_API = 'https://compare.ccpc.ie/'
export const CCPC_ORIGIN = 'https://www.ccpc.ie'

const tool = (path: string) => `${CCPC_ORIGIN}/manage-your-money/${path}`

/** The public page each kind of row is compared on: the row's `sourceUrl`. */
export const CCPC_TOOL_PAGES: Readonly<Record<MarketCategory, string>> = {
  savings: tool('saving-and-investments/compare-savings-accounts/regular-savings-comparison-tool'),
  deposit: tool('saving-and-investments/compare-savings-accounts/lump-sum-savings-comparison-tool'),
  mortgage: tool('buying-a-home/mortgage-comparison-tools'),
  loan: tool('borrowing-money/loan-calculator'),
  credit_card: tool('borrowing-money/compare-credit-cards'),
  current_account: tool('day-to-day-finances/compare-current-accounts'),
}

// ---- The API's own shapes -----------------------------------------------------------------

const field = z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).nullable() })

export const ccpcItemSchema = z.looseObject({
  Id: z.number().int(),
  ProductName: z.string().min(1),
  ProviderName: z.string().min(1),
  Website: z.string().nullable().optional(),
  AdditionalInformation: z.string().nullable().optional(),
  FootNotes: z.array(z.unknown()).nullable().optional(),
  LastEdited: z.string().nullable().optional(),
})
export type CcpcItem = z.infer<typeof ccpcItemSchema>

export const ccpcListSchema = z.array(ccpcItemSchema)

/** Every numbered field on an item, by CCPC's own label (trimmed), value as text. */
export function fieldsOf(item: CcpcItem): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(item)) {
    if (!/^\d+$/.test(key)) continue
    const parsed = field.safeParse(value)
    if (!parsed.success) continue
    out[parsed.data.Name.trim()] = text(String(parsed.data.Value ?? ''))
  }
  return out
}

/** HTML or plain text, as one tidy string. */
export function text(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(p|li|div|ul|ol|h\d)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** A loose field of an API item as text: a string or a number, anything else empty. */
export function scalar(item: CcpcItem, key: string): string {
  const value = item[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** The first number in a value such as `€18.00 **`, `€5,000`, `2.52% up to`. Null if none. */
export function numberIn(value: string | undefined): number | null {
  if (value === undefined) return null
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(value)
  if (match === null) return null
  const parsed = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** A label lookup that ignores a trailing colon and case. */
function pick(fields: Record<string, string>, ...labels: readonly string[]): string | undefined {
  const norm = (label: string) => label.replace(/:\s*$/, '').trim().toLowerCase()
  const wanted = new Set(labels.map(norm))
  for (const [label, value] of Object.entries(fields)) {
    if (wanted.has(norm(label))) return value
  }
  return undefined
}

const SAYS_NONE = /^(none|no|n\/a|na|-|no minimum|no maximum|no max\b.*|no maximum amount)$/i

/** A limit: a number, or absent when CCPC says there is none, or unknown when it says neither. */
function limit(value: string | undefined): { value?: number; unknown: boolean } {
  const parsed = numberIn(value)
  if (parsed !== null) return { value: parsed, unknown: false }
  if (value !== undefined && SAYS_NONE.test(value.trim())) return { unknown: false }
  return { unknown: true }
}

function yesNo(value: string | undefined): boolean | null {
  if (value === undefined) return null
  if (/^(yes|1|true)\b/i.test(value.trim())) return true
  if (/^(no|0|false)\b/i.test(value.trim())) return false
  return null
}

function providerUrl(website: string | null | undefined): string | null {
  if (website === null || website === undefined || website.trim() === '') return null
  const raw = website.trim().replace(/^http:\/\//i, 'https://')
  const withScheme = /^https:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    // Analytics junk on a link is not part of where the product lives.
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('_g') || key.startsWith('utm_')) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return null
  }
}

/** CCPC's record timestamps carry no offset; Postgres reads them as UTC, and so does this. */
function sourceTime(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// ---- One item to one record ---------------------------------------------------------------

export type Built = {
  readonly product: Omit<MarketProduct, 'checkedAt'>
  /** The provider name was not in the mapping, so its id was generated. */
  readonly generatedProvider: boolean
}

type Kind = 'savings' | 'deposit' | 'mortgage' | 'loan' | 'credit_card' | 'current_account'

function base(
  item: CcpcItem,
  category: Kind,
  rates: MarketRates,
  conditions: MarketConditions,
  unknown: readonly string[],
): Built {
  const provider = providerFor(item.ProviderName)
  const fields = fieldsOf(item)
  const prose: Record<string, string> = {}
  const info = text(item.AdditionalInformation ?? '')
  if (info.length > 0) prose['Additional information'] = info
  const notes = (item.FootNotes ?? []).map((note) =>
    text(typeof note === 'string' ? note : JSON.stringify(note)),
  )
  if (notes.length > 0) prose['Footnotes'] = notes.join('\n')
  const intro = pick(fields, 'Introductory offers')
  if (intro !== undefined && !SAYS_NONE.test(intro)) prose['Introductory offers'] = intro

  const details: Record<string, string> = { ...fields }
  if (provider.platform !== undefined) details['Platform'] = provider.platform
  details['CCPC provider name'] = item.ProviderName

  const url = providerUrl(item.Website)
  const updated = sourceTime(item.LastEdited)
  return {
    generatedProvider: provider.generated,
    product: {
      provider: provider.id,
      source: 'ccpc',
      productId: `${category}.c${String(item.Id)}`,
      category,
      providerProductName: item.ProductName.replace(/\s+/g, ' ').trim(),
      rates,
      conditions: {
        ...conditions,
        ...(Object.keys(prose).length === 0 ? {} : { prose }),
        details,
      },
      sourceUrl: CCPC_TOOL_PAGES[category],
      ...(url === null ? {} : { providerUrl: url }),
      sourceProductId: String(item.Id),
      ...(updated === null ? {} : { sourceUpdatedAt: updated }),
      attribution: CCPC_ATTRIBUTION,
      ...(unknown.length === 0 ? {} : { unknown: [...new Set(unknown)].sort() }),
      effectiveFrom: null,
    },
  }
}

/**
 * How long a regular saver's rate is fixed for, where CCPC's own words say so: an introductory
 * offer "for 12 months", or a product named "(Fixed)" with a minimum savings period in months
 * (EBS Family Savings: 3% for a one-year term, then "a lower rate" CCPC does not state). What
 * follows is unknown, so the engine's figures stop there rather than assume the rate holds.
 */
export function regularFixedMonths(
  name: string,
  intro: string | undefined,
  fields: Record<string, string>,
): number | null {
  const months = (text: string | undefined): number | null => {
    const match = /(\d+)\s*months?/i.exec(text ?? '') ?? /^\s*(\d+)\s*$/.exec(text ?? '')
    const value = Number(match?.[1])
    return match === null || !Number.isInteger(value) || value <= 0 || value > 120 ? null : value
  }
  if (intro !== undefined && !SAYS_NONE.test(intro) && /\bfixed\b/i.test(intro)) {
    const stated = months(intro)
    if (stated !== null) return stated
  }
  if (/\bfixed\b/i.test(name)) {
    return months(pick(fields, 'Minimum savings period (months)'))
  }
  return null
}

/** Regular savings: monthly saving by direct debit. */
export function regularSaving(item: CcpcItem): Built {
  const fields = fieldsOf(item)
  const unknown = ['conditions.minAge', 'conditions.takesLumpSum', 'rates.lumpSumAerPct']
  const aer =
    numberIn(pick(fields, 'Interest rate(AER)', 'Interest rate (AER)')) ??
    numberIn(scalar(item, 'Rate'))
  if (aer === null) throw new Error(`no AER on ${item.ProductName}`)

  const tierList = z
    .array(
      z.object({
        MinimumAmount: z.number(),
        MaximumAmount: z.number().nullable(),
        Rate: z.number(),
      }),
    )
    .safeParse(item['TierList'] ?? [])
  const tiers = tierList.success
    ? [...tierList.data]
        .sort((a, b) => a.MinimumAmount - b.MinimumAmount)
        .map((tier) => ({
          minEur: tier.MinimumAmount,
          maxEur: tier.MaximumAmount,
          aerPct: tier.Rate,
        }))
    : []

  const intro = pick(fields, 'Introductory offers')
  const hasIntro = intro !== undefined && !SAYS_NONE.test(intro)
  if (hasIntro) unknown.push('rates.thenAerPct')
  const fixedMonths = regularFixedMonths(item.ProductName, intro, fields)
  if (fixedMonths === null) unknown.push('rates.basis')
  else unknown.push('rates.thenAerPct')

  const min = limit(pick(fields, 'Minimum lodgement per month'))
  const max = limit(pick(fields, 'Maximum lodgement per month'))
  if (min.unknown) unknown.push('conditions.minMonthlyEur')
  if (max.unknown) unknown.push('conditions.maxMonthlyEur')

  return base(
    item,
    'savings',
    {
      kind: 'deposit',
      aerPct: aer,
      basis: fixedMonths === null ? null : 'fixed',
      ...(fixedMonths === null ? {} : { fixedMonths }),
      ...(tiers.length === 0 ? {} : { tiers }),
    },
    {
      takesMonthly: true,
      ...(min.value === undefined ? {} : { minMonthlyEur: min.value }),
      ...(max.value === undefined ? {} : { maxMonthlyEur: max.value }),
    },
    unknown,
  )
}

/** Lump-sum accounts: instant access, notice and fixed term. */
export function lumpSum(item: CcpcItem): Built {
  const fields = fieldsOf(item)
  const unknown = ['conditions.minAge']
  const aer = numberIn(pick(fields, 'AER')) ?? numberIn(scalar(item, 'Rate'))
  if (aer === null) throw new Error(`no AER on ${item.ProductName}`)

  const type = pick(fields, 'Rate type') ?? ''
  const basis = /fixed/i.test(type) ? 'fixed' : /variable/i.test(type) ? 'variable' : null
  if (basis === null) unknown.push('rates.basis')

  const term = numberIn(pick(fields, 'Term in months'))
  const notice = numberIn(pick(fields, 'Notice period in days'))
  const additional = yesNo(pick(fields, 'Additional lodgements'))
  if (additional === null) unknown.push('conditions.takesMonthly')
  const min = limit(pick(fields, 'Minimum lodgement'))
  const max = limit(pick(fields, 'Maximum lodgement'))
  if (min.unknown) unknown.push('conditions.minLumpSumEur')
  if (max.unknown) unknown.push('conditions.maxLumpSumEur')
  const intro = pick(fields, 'Introductory offers')
  if (intro !== undefined && !SAYS_NONE.test(intro)) unknown.push('rates.thenAerPct')

  return base(
    item,
    'deposit',
    {
      kind: 'deposit',
      aerPct: aer,
      basis,
      ...(term !== null && term > 0 ? { termMonths: term } : {}),
      ...(notice === null ? {} : { noticeDays: notice }),
    },
    {
      takesLumpSum: true,
      ...(additional === null ? {} : { takesMonthly: additional }),
      ...(min.value === undefined ? {} : { minLumpSumEur: min.value }),
      ...(max.value === undefined ? {} : { maxLumpSumEur: max.value }),
    },
    unknown,
  )
}

export type MortgageCustomerType = (typeof MORTGAGE_CUSTOMER_TYPES)[number]

export function mortgage(item: CcpcItem, customerType: MortgageCustomerType): Built {
  const fields = fieldsOf(item)
  const unknown = ['rates.aprcPct']
  const sub = scalar(item, 'SubProductType')
  const rateType = /fixed/i.test(sub) ? 'fixed' : /variable/i.test(sub) ? 'variable' : null
  if (rateType === null) unknown.push('rates.rateType')
  const initial =
    numberIn(scalar(item, 'DiscountedRate')) ?? numberIn(pick(fields, 'Initial interest rate'))
  if (initial === null) throw new Error(`no initial rate on ${item.ProductName}`)
  const years = numberIn(scalar(item, 'DiscountedTerm'))
  const ber = scalar(item, 'BER').trim()

  return base(
    item,
    'mortgage',
    {
      kind: 'mortgage',
      rateType,
      fixedYears: rateType === 'fixed' && years !== null && years > 0 ? years : null,
      initialRatePct: initial,
      followOnRatePct:
        numberIn(scalar(item, 'FollowOnRate')) ??
        numberIn(pick(fields, 'Potential follow-on interest rate')),
      fullTermRatePct:
        numberIn(scalar(item, 'FullRate')) ?? numberIn(pick(fields, 'Rate for full term')),
      ltvMinPct: numberIn(pick(fields, 'Minimum LTV')),
      ltvMaxPct: numberIn(pick(fields, 'Maximum LTV')),
      ber: ber === '' || /^(all|any|n\/a)$/i.test(ber) ? null : ber,
      cashback:
        cashbackOffered(pick(fields, 'Cashback')) ??
        cashbackOffered(pick(fields, 'Cashback description')),
      customerTypes: [customerType],
    },
    {},
    unknown,
  )
}

const LOAN_PURPOSES = [
  'Personal loans',
  'Car loans',
  'Home improvements',
  'Home energy upgrade loans (SCBI)',
  'Student loans',
  'Holiday loans',
] as const

/**
 * A loan's longest term in months. CCPC's words carry the unit ("60 months", "10 Years"), and
 * win; reading "10 Years" as a number stored ten months. Without words, the structured
 * `MaximumTerm`, which is in years (Bank of Ireland's green loan: 10, beside "120 months"). Words
 * with no unit ("7") are not guessed at: unknown.
 */
export function loanTermMonths(
  stated: string | undefined,
  structuredYears: number | null,
): { readonly months: number | null; readonly unknown: boolean } {
  if (stated === undefined || stated.trim() === '') {
    return {
      months:
        structuredYears !== null && structuredYears > 0 ? Math.round(structuredYears * 12) : null,
      unknown: structuredYears === null,
    }
  }
  const value = numberIn(stated)
  if (value === null || value <= 0) return { months: null, unknown: true }
  if (/month|mth/i.test(stated)) return { months: Math.round(value), unknown: false }
  if (/year|yr/i.test(stated)) return { months: Math.round(value * 12), unknown: false }
  return { months: null, unknown: true }
}

export function loan(item: CcpcItem): Built {
  const fields = fieldsOf(item)
  const apr = numberIn(scalar(item, 'Rate'))
  if (apr === null) throw new Error(`no rate on ${item.ProductName}`)
  const type = pick(fields, 'Rate type') ?? ''
  const term = loanTermMonths(pick(fields, 'Maximum term'), numberIn(scalar(item, 'MaximumTerm')))
  const months = term.months
  const unknown = ['rates.minAmountEur']
  if (term.unknown) unknown.push('rates.maxTermMonths')
  if (!/fixed|variable/i.test(type)) unknown.push('rates.rateType')

  return base(
    item,
    'loan',
    {
      kind: 'loan',
      aprPct: apr,
      rateType: /fixed/i.test(type) ? 'fixed' : /variable/i.test(type) ? 'variable' : null,
      maxAmountEur: numberIn(scalar(item, 'MaximumAmount')),
      maxTermMonths: months,
      purposes: LOAN_PURPOSES.filter((purpose) => pick(fields, purpose) === '1'),
    },
    {},
    unknown,
  )
}

export function creditCard(item: CcpcItem): Built {
  const fields = fieldsOf(item)
  return base(
    item,
    'credit_card',
    {
      kind: 'credit_card',
      aprPct: numberIn(pick(fields, 'APR', 'Interest rate on purchases (APR)')),
      purchaseRatePct: numberIn(
        pick(fields, 'Annual (nominal) interest rate charged on purchases'),
      ),
      cashRatePct: numberIn(
        pick(fields, 'Annual (nominal) interest rate charged on cash withdrawals'),
      ),
      balanceTransferIntroMonths: numberIn(
        pick(fields, 'Introductory period on balances transferred (in months)'),
      ),
      balanceTransferIntroPct: numberIn(pick(fields, 'Introductory APR on balances transferred')),
    },
    {},
    [],
  )
}

export function currentAccount(item: CcpcItem): Built {
  const fields = fieldsOf(item)
  return base(
    item,
    'current_account',
    {
      kind: 'current_account',
      quarterlyFeeEur: numberIn(pick(fields, 'Maintaining the account (quarterly fee)')),
      creditInterestPct: numberIn(pick(fields, 'Interest earned on credit balance')),
      overdraft: yesNo(pick(fields, 'Overdraft')),
    },
    {},
    [],
  )
}

// ---- The sweep ----------------------------------------------------------------------------

export type CcpcQuery = {
  readonly label: string
  readonly endpoint: string
  readonly body: Record<string, unknown>
  readonly build: (item: CcpcItem) => Built
}

const listing = { sortBy: '', compare: [], showCompareModal: false, detailModalId: '', page: 1 }

const NOTICE_BANDS = [
  { Id: 1, MinValue: 1, MaxValue: 21, Description: '1 - 21 days' },
  { Id: 2, MinValue: 22, MaxValue: 30, Description: '22 - 30 days' },
  { Id: 3, MinValue: 31, MaxValue: 90, Description: '31 - 90 days' },
] as const

/** Term bands as `account/get-lump-sum-term-types` serves them; read live at the start. */
export const termBandSchema = z.array(
  z.looseObject({
    Id: z.number(),
    MinValue: z.number(),
    MaxValue: z.number(),
    Description: z.string(),
  }),
)

const LUMP_AMOUNTS = [1_000, 25_000, 250_000] as const
const REGULAR_AMOUNTS = [5, 20, 100, 500, 1_000, 2_500] as const
const MORTGAGE_LISTS = [
  ['first_time_buyer', 'mortgage/get-first-time-buyers-mortgages'],
  ['mover', 'mortgage/get-home-movers-mortgages'],
  ['switcher', 'mortgage/get-switchers-mortgages'],
] as const
const PROPERTY_VALUES = [300_000, 700_000] as const
const LTV_POINTS = [45, 55, 65, 75, 85] as const
const LOAN_QUERIES = [
  [1_000, 1],
  [5_000, 1],
  [15_000, 1],
  [40_000, 1],
  [75_000, 1],
  [5_000, 5],
  [5_000, 10],
] as const

export function ccpcQueries(termBands: z.infer<typeof termBandSchema>): readonly CcpcQuery[] {
  const queries: CcpcQuery[] = []

  for (const amount of REGULAR_AMOUNTS) {
    queries.push({
      label: `regular savings, €${String(amount)} a month`,
      endpoint: 'regular-saving/get-regular-savings',
      body: { provider: 'All', amount, ...listing },
      build: regularSaving,
    })
  }

  const lump = (subType: string, extra: Record<string, unknown>, label: string) => {
    for (const amount of LUMP_AMOUNTS) {
      queries.push({
        label: `${label}, €${String(amount)}`,
        endpoint: 'account/get-lump-sum-accounts',
        body: {
          typeId: 8,
          subType,
          amount,
          provider: 'All',
          noticeType: null,
          termType: null,
          ...listing,
          ...extra,
        },
        build: lumpSum,
      })
    }
  }
  lump('Instant access', {}, 'instant access')
  for (const band of NOTICE_BANDS)
    lump('Notice account', { noticeType: band }, `notice ${band.Description}`)
  for (const band of termBands)
    lump('Fixed term', { termType: band }, `fixed term ${band.Description}`)

  for (const [customerType, endpoint] of MORTGAGE_LISTS) {
    for (const houseValue of PROPERTY_VALUES) {
      for (const ltv of LTV_POINTS) {
        const amount = Math.round((houseValue * ltv) / 100)
        queries.push({
          label: `${customerType.replaceAll('_', ' ')} mortgages, €${String(houseValue)} at ${String(ltv)}% LTV`,
          endpoint,
          body: {
            typeId: 10,
            subProductType: 'All',
            provider: 'All',
            houseValue,
            depositAmount: houseValue - amount,
            amount,
            term: 30,
            isCustomTerm: false,
            berRating: '',
            feature: '',
            ...listing,
          },
          build: (item) => mortgage(item, customerType),
        })
      }
    }
  }

  for (const [amount, term] of LOAN_QUERIES) {
    queries.push({
      label: `loans, €${String(amount)} over ${String(term)} years`,
      endpoint: 'loan/get-loans',
      body: { typeId: 5, provider: 'All', amount, term, purpose: '', ...listing },
      build: loan,
    })
  }

  queries.push({
    label: 'credit cards',
    endpoint: 'credit-card/get-credit-cards',
    body: { typeId: 3, provider: 'All', feature: '', ...listing },
    build: creditCard,
  })
  queries.push({
    label: 'current accounts',
    endpoint: 'account/get-current-accounts',
    body: { typeId: 1, provider: 'All', feature: '', ...listing },
    build: currentAccount,
  })

  return queries
}

/**
 * Folds one built record into the sweep's result. The same CCPC product turns up in several
 * queries (every amount it accepts, every mortgage list it is in); it is one record, and a
 * mortgage collects the customer types it is offered to.
 */
export function merge(into: Map<string, Built>, built: Built): void {
  const key = `${built.product.provider}/${built.product.productId}`
  const held = into.get(key)
  if (held === undefined) {
    into.set(key, built)
    return
  }
  const a = held.product.rates
  const b = built.product.rates
  if (a.kind === 'mortgage' && b.kind === 'mortgage') {
    const customerTypes = MORTGAGE_CUSTOMER_TYPES.filter(
      (type) => a.customerTypes.includes(type) || b.customerTypes.includes(type),
    )
    into.set(key, { ...held, product: { ...held.product, rates: { ...a, customerTypes } } })
  }
}
