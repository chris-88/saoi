import type { MarketPlan } from './market-plan.ts'

/**
 * A worked example of a `MarketPlan`, from the MCP design's own scenario: €25,000 in a current
 * account, €800 a month to save, a house deposit in two years, and a car loan at 9%.
 *
 * Used by the contract's tests, the route tests and `scripts/plan-handoff/save-sample.ts`, and a
 * reference for whoever builds `saoi_build_plan`. The products are real rows from
 * `market_products` as of 9 November 2026; the projections are illustrative, worked by hand to
 * the nearest euro, and are not what the engine will produce.
 */
export function exampleMarketPlan(at: Date = new Date('2026-11-09T12:30:00Z')): MarketPlan {
  const checked = '2026-11-09T12:14:36.808Z'
  const ccpc = 'Source: Competition and Consumer Protection Commission, www.ccpc.ie'
  return {
    version: 1,
    title: 'House deposit by November 2028',
    situation: {
      summary:
        'Has €25,000 sitting in a current account earning nothing and can put €800 a month ' +
        'aside. Wants a €35,000 house deposit within two years. Has a car loan of €9,000 at 9% ' +
        'APR, €280 a month with three years left.',
      income: { netMonthly: 3_900 },
      outgoings: { rentMonthly: 1_650, otherMonthly: 900 },
      monthlySaving: 800,
      savings: [{ label: 'Current account', balance: 25_000, provider: 'AIB', aerPct: 0 }],
      debts: [
        {
          id: 'car-loan',
          label: 'Car loan',
          kind: 'car_finance',
          balance: 9_000,
          ratePct: 9,
          monthlyRepayment: 280,
          monthsRemaining: 36,
        },
      ],
    },
    goals: [
      {
        id: 'deposit',
        kind: 'house_deposit',
        label: 'House deposit',
        targetAmount: 35_000,
        targetDate: '2028-11',
        priority: 1,
      },
      {
        id: 'rainy-day',
        kind: 'emergency_fund',
        label: 'Rainy-day money',
        targetAmount: 5_000,
        priority: 2,
      },
    ],
    recommendation: {
      products: [
        {
          role: 'regular_saver',
          goalIds: ['deposit'],
          provider: 'boi',
          providerName: 'Bank of Ireland',
          source: 'bank',
          category: 'savings',
          productId: 'savings.supersaver',
          productName: 'SuperSaver Account',
          monthlyAmount: 500,
          ratePct: 3,
          projected: { horizonMonths: 24, balance: 12_189, netInterest: 189 },
          why: 'The highest fixed regular-saver rate for the first €500 of the monthly €800.',
          unknowns: [],
          checks: ['Paid by direct debit from a Bank of Ireland current account'],
          checkedAt: checked,
        },
        {
          role: 'regular_saver',
          goalIds: ['deposit'],
          provider: 'aib',
          providerName: 'AIB',
          source: 'ccpc',
          category: 'savings',
          productId: 'savings.c396',
          productName: 'Online Saver',
          monthlyAmount: 300,
          ratePct: 3,
          projected: { horizonMonths: 24, balance: 7_351, netInterest: 151 },
          why: 'The same rate for the remaining €300 a month, at a second bank.',
          unknowns: ['Monthly maximum', 'Rate after the first year'],
          checks: ['Check eligibility with AIB'],
          checkedAt: checked,
          attribution: ccpc,
          url: 'https://personal.aib.ie/our-products/savings-and-deposits/online-saver',
        },
        {
          role: 'lump_sum',
          goalIds: ['deposit'],
          provider: 'bankinter',
          providerName: 'Bankinter',
          source: 'ccpc',
          category: 'deposit',
          productId: 'deposit.c8899',
          productName: 'Deposit Plus 12 Month Fixed Term Account 25% Access',
          amount: 15_000,
          ratePct: 3.3,
          projected: { horizonMonths: 12, balance: 15_332, netInterest: 332 },
          why: 'The best 12-month rate for the lump sum, with a quarter of it reachable early.',
          unknowns: ['What it pays after 12 months'],
          checks: ['Opened through the Raisin platform; covered by the Spanish deposit guarantee'],
          checkedAt: checked,
          attribution: ccpc,
        },
        {
          role: 'emergency_fund',
          goalIds: ['rainy-day'],
          provider: 'moco',
          providerName: 'MoCo',
          source: 'ccpc',
          category: 'savings',
          productId: 'savings.c8574',
          productName: 'MoCo EasySaver',
          amount: 5_000,
          ratePct: 2.1,
          projected: { horizonMonths: 24, balance: 5_142, netInterest: 142 },
          why: 'Instant access at the best easy-access rate, for money that must stay reachable.',
          unknowns: [],
          checks: ['Check eligibility with MoCo'],
          checkedAt: checked,
          attribution: ccpc,
          url: 'https://www.moco.ie/',
        },
      ],
      totals: { monthly: 800, lumpSum: 20_000, netInterest: 814 },
    },
    debts: [
      {
        debtId: 'car-loan',
        action: 'overpay',
        why: 'At 9% it costs more than any savings account pays, so €5,000 of the €25,000 goes to it now.',
        costIfKept: 1_276,
        costWithStep: 551,
      },
    ],
    ranking: {
      objective: 'highest_net_return',
      basis: 'Ranked by interest after DIRT on €800 a month and €20,000 placed, over 24 months.',
    },
    assumptions: [
      'DIRT at 33% on all interest.',
      'Rates stay as published on 9 November 2026 unless the product fixes them.',
      'Where a rate after a fixed period is unknown, the projection stops at the end of it.',
    ],
    createdAt: at.toISOString(),
    dataCheckedAt: checked,
  }
}
