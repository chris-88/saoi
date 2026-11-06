import { describe, expect, it } from 'vitest'
import type { FactReader } from '../journey.ts'
import { accountEvidence } from './evidence.ts'
import { netMonthlyPay, synthesiseAccounts } from './synthesise.ts'
import { summariseAccounts } from './summarise.ts'

function reader(values: Record<string, unknown>): FactReader {
  return {
    has: (key) => key in values,
    get: (key) => values[key],
    number: (key) => (typeof values[key] === 'number' ? values[key] : null),
    boolean: (key) => (typeof values[key] === 'boolean' ? values[key] : null),
  }
}

const today = '2026-10-22'
const synthetic = synthesiseAccounts({
  bank: 'ptsb',
  bankName: 'PTSB',
  facts: reader({
    'income.annualBasic': 55_000,
    'employment.employerName': 'Kerry Group',
    'expenditure.monthlyRent': 1_400,
    'goals.monthlySaving': 500,
    'assets.savingsBalance': 12_500,
  }),
  today,
  seed: 'case-9',
})

describe('summarising linked accounts for the overview card', () => {
  const summary = summariseAccounts(synthetic.accounts, synthetic.transactions, today)

  it('detects the salary as the steady monthly credit, with the employer and the last date', () => {
    expect(summary.salary).toEqual({
      amount: netMonthlyPay(55_000),
      employer: 'Kerry Group',
      lastOn: '2026-09-25',
    })
  })

  it('lists the steady outgoings with their cadence, largest first, five at most', () => {
    expect(summary.regular.length).toBeLessThanOrEqual(5)
    expect(summary.regular[0]).toEqual({ label: 'Rent', amount: 1_400, cadence: 'monthly' })
    expect(summary.regular[1]).toEqual({
      label: 'Transfer to savings',
      amount: 500,
      cadence: 'monthly',
    })
    expect(summary.regular.some((item) => item.label === 'Netflix' && item.amount === 14.99)).toBe(
      true,
    )
    for (let i = 1; i < summary.regular.length; i++) {
      expect(summary.regular[i - 1]?.amount ?? 0).toBeGreaterThanOrEqual(
        summary.regular[i]?.amount ?? 0,
      )
    }
  })

  it('sums this calendar month only', () => {
    const october = synthetic.transactions.filter((t) => t.bookedOn.startsWith('2026-10'))
    const moneyIn =
      october.filter((t) => t.amount > 0).reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100
    const moneyOut =
      october.filter((t) => t.amount < 0).reduce((s, t) => s + Math.round(-t.amount * 100), 0) / 100

    expect(summary.month).toEqual({ moneyIn, moneyOut })
    // Payday has not come yet this month, so nothing is in.
    expect(summary.month.moneyIn).toBe(0)
    expect(summary.month.moneyOut).toBeGreaterThan(1_400)
  })

  it('reports savings held as the savings balances', () => {
    expect(summary.savingsHeld).toBe(12_500)
  })

  it('finds nothing regular on an empty statement', () => {
    expect(summariseAccounts([], [], today)).toEqual({
      month: { moneyIn: 0, moneyOut: 0 },
      salary: null,
      regular: [],
      savingsHeld: 0,
    })
  })
})

describe('evidence an assessment can take from the accounts', () => {
  it('reads the salary, the rent, the savings and the depth of history', () => {
    expect(accountEvidence(synthetic.accounts, synthetic.transactions, today)).toEqual({
      salaryObserved: {
        monthly: netMonthlyPay(55_000),
        annualised: Math.round(netMonthlyPay(55_000) * 12 * 100) / 100,
        employer: 'Kerry Group',
        // Two paydays fall inside a window that opens on 25 July and closes on 22 October.
        months: 2,
      },
      rentObserved: { monthly: 1_400 },
      savingsObserved: 12_500,
      daysOfHistory: 90,
    })
  })

  it('does not infer a salary from one credit, and reads nothing from nothing', () => {
    const one = [{ bookedOn: '2026-10-01', amount: 3_000, description: 'ACME', category: 'income' }]
    expect(accountEvidence([], one, today).salaryObserved).toBeNull()
    expect(accountEvidence([], one, today).daysOfHistory).toBe(22)
    expect(accountEvidence([], [], today)).toEqual({
      salaryObserved: null,
      rentObserved: null,
      savingsObserved: 0,
      daysOfHistory: 0,
    })
  })

  it('does not take a varying debit for rent', () => {
    const shops = [
      { bookedOn: '2026-08-01', amount: -900, description: 'Rent', category: 'housing' },
      { bookedOn: '2026-09-01', amount: -1_400, description: 'Rent', category: 'housing' },
    ]
    expect(accountEvidence([], shops, today).rentObserved).toBeNull()
  })
})
