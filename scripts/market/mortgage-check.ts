import { buildPlanRequestSchema } from '../../supabase/functions/_shared/contracts/market-tools.ts'
import type { MarketProduct } from '../../supabase/functions/_shared/market/schema.ts'
import { normaliseMarket } from '../../supabase/functions/_shared/domain/market/normalise.ts'
import { buildPlan } from '../../supabase/functions/_shared/domain/market/plan.ts'

/**
 * A data check after each refresh (Chris, 2026-11-10, after BoI's 3.1% high-value rate was
 * missed): the lowest first-time-buyer rate each lender lists, and, for a reference purchase
 * (a first-time buyer, €46,000 saved by a date two years out, second-hand, 90% loan-to-value),
 * the rate each lender's pathway picks against its lowest eligible rate. A pick more than 0.25
 * points above it is flagged to look at: it may be right (cashback, or a longer fix), or a rate
 * may be wrongly excluded.
 */

const FLAG_POINTS = 0.25

export function mortgageCheck(products: readonly MarketProduct[], asOf: string): string[] {
  const lines: string[] = []
  const lowest = new Map<string, { rate: number; name: string }>()
  for (const product of products) {
    if (product.category !== 'mortgage' || product.rates.kind !== 'mortgage') continue
    if (!product.rates.customerTypes.includes('first_time_buyer')) continue
    const seen = lowest.get(product.provider)
    if (seen === undefined || product.rates.initialRatePct < seen.rate) {
      lowest.set(product.provider, {
        rate: product.rates.initialRatePct,
        name: product.providerProductName,
      })
    }
  }
  lines.push('lowest first-time-buyer rate per lender:')
  for (const [provider, { rate, name }] of [...lowest.entries()].sort(
    (a, b) => a[1].rate - b[1].rate,
  )) {
    lines.push(`  ${provider} ${String(rate)}% (${name})`)
  }

  const market = normaliseMarket(
    products.map((product) => ({ product, firstSeenAt: product.checkedAt, supersededAt: null })),
  )
  const [year, month] = asOf.split('-').map(Number)
  const target = `${String((year ?? 2026) + 2)}-${String(month ?? 1).padStart(2, '0')}`
  const plan = buildPlan(
    market,
    buildPlanRequestSchema.parse({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'current account', balance: 25_000, access: 'current_account' }],
        firstTimeBuyer: true,
      },
      goals: [{ id: 'home', kind: 'house_deposit', label: 'Home', targetDate: target }],
      propertyKind: 'second_hand',
    }),
    asOf,
    `${asOf}T00:00:00.000Z`,
  )
  const home = plan.home
  if (home === null) {
    lines.push('pathways: none for the reference purchase')
    return lines
  }
  lines.push(
    `pathways for the reference purchase (${String(home.price)} at ${String(home.ltvPct)}% LTV, over the first ${String(home.comparedOver.years)} years):`,
  )
  for (const pathway of home.pathways) {
    const gap = Math.round((pathway.mortgage.ratePct - pathway.lowestRatePct) * 100) / 100
    lines.push(
      `  ${gap > FLAG_POINTS ? 'CHECK   ' : ''}${pathway.lender} picks ${String(pathway.mortgage.ratePct)}% (${pathway.mortgage.name}); lowest eligible ${String(pathway.lowestRatePct)}%${gap > FLAG_POINTS ? `, ${String(gap)} points above` : ''}`,
    )
  }
  return lines
}
