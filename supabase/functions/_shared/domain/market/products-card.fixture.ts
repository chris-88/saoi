import type { Holding } from '../../contracts/holdings.ts'
import type { MarketPlan } from '../../contracts/market-plan.ts'
import { exampleMarketPlan } from '../../contracts/market-plan.example.ts'

/**
 * The first-home case the products card is tested on: a claimed home plan (€400,000 second-hand,
 * €110,000 joint income, keys July 2028, sorted by five-year cost) and what they hold now, a
 * Bank of Ireland savings account at 0.5% and an AIB current account. Shared by the domain test
 * and the turn tool's tests.
 */
export const PRODUCTS_AS_OF = '2026-11-12'

export function productsPlan(): MarketPlan {
  const base = exampleMarketPlan()
  return {
    ...base,
    title: 'First home by July 2028',
    situation: {
      ...base.situation,
      income: { annualGross: 110_000, netMonthly: 6_200 },
      monthlySaving: 1_000,
      savings: [
        { label: 'BoI savings', balance: 20_000, provider: 'Bank of Ireland', aerPct: 0.5 },
        { label: 'Current account', balance: 5_000, provider: 'AIB' },
      ],
      debts: [],
    },
    goals: [
      {
        id: 'deposit',
        kind: 'house_deposit',
        label: 'House deposit',
        targetAmount: 47_000,
        targetDate: '2028-07',
        priority: 1,
      },
    ],
    combination: { products: [] },
    debts: [],
    comparison: {
      kind: 'home',
      headline: 'At these figures, the deposit and buying costs are in place around July 2028.',
      priceEur: 400_000,
      neededAtKeysEur: 47_000,
      keysOn: '2028-07',
      sortBy: 'five_year_cost',
      sortedBy: '12 options that fit, sorted by cost over the first 5 years, lowest first.',
      filters: [],
      options: [],
      routes: [],
    },
    arrival: {
      keysOn: '2028-07',
      readyLine: 'July 2028',
      readyNote: 'Before interest',
      factParts: ['€40,000 deposit', '€4,000 stamp duty', '€3,000 legal and survey'],
      progress: { savedEur: 25_000, neededEur: 47_000, monthlySavingEur: 1_000 },
      tiles: [],
      assumptions: ['First-time buyer, assumed', 'Second-hand', 'Rent not given'],
      hookQuestion: null,
    },
  }
}

const holding = (over: Partial<Holding>): Holding => ({
  id: '9f8b0c7e-0000-4000-8000-000000000001',
  kind: 'savings',
  label: 'BoI savings',
  provider: 'Bank of Ireland',
  productId: null,
  balance: 20_000,
  ratePct: 0.5,
  monthlyAmountEur: null,
  fixedUntil: null,
  notedOn: '2026-11-12',
  source: 'plan',
  reminderId: null,
  createdAt: '2026-11-12T09:00:00.000Z',
  updatedAt: '2026-11-12T09:00:00.000Z',
  ...over,
})

export function productsHoldings(): Holding[] {
  return [
    holding({}),
    holding({
      id: '9f8b0c7e-0000-4000-8000-000000000002',
      kind: 'current',
      label: 'Current account',
      provider: 'AIB',
      balance: 5_000,
      ratePct: null,
    }),
  ]
}
