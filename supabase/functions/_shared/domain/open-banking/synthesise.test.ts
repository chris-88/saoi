import { describe, expect, it } from 'vitest'
import type { FactReader } from '../journey.ts'
import {
  addDays,
  maskIban,
  monthsSpanning,
  netMonthlyPay,
  synthesiseAccounts,
} from './synthesise.ts'

/** A reader over a flat map; person keys are read for the primary, household keys as given. */
function reader(values: Record<string, unknown>): FactReader {
  return {
    has: (key) => key in values,
    get: (key) => values[key],
    number: (key) => (typeof values[key] === 'number' ? values[key] : null),
    boolean: (key) => (typeof values[key] === 'boolean' ? values[key] : null),
  }
}

const aoife = {
  'income.annualBasic': 62_000,
  'employment.employerName': 'Stripe',
  'expenditure.monthlyRent': 1_650,
  'goals.monthlySaving': 800,
  'assets.savingsBalance': 32_000,
}

const input = {
  bank: 'aib',
  bankName: 'AIB',
  facts: reader(aoife),
  today: '2026-10-22',
  seed: 'case-1',
}

describe('synthesising accounts from the facts', () => {
  it('is deterministic in the seed and differs across seeds', () => {
    const first = synthesiseAccounts(input)
    const again = synthesiseAccounts(input)
    const other = synthesiseAccounts({ ...input, seed: 'case-2' })

    expect(again).toEqual(first)
    expect(other.transactions).not.toEqual(first.transactions)
    expect(other.accounts[0]?.iban).not.toBe(first.accounts[0]?.iban)
  })

  it('pays the salary they quoted, from the employer they named, on every payday in the window', () => {
    const { transactions } = synthesiseAccounts(input)
    const pay = transactions.filter((t) => t.category === 'income')

    /*
     * Two, not three: the window opens on Saturday 25 July, so July's pay landed on the
     * Friday just before it, and October's lands on Friday the 23rd, which is tomorrow.
     * A statement pulled on this date really would show two paydays.
     */
    expect(pay.map((t) => t.bookedOn)).toEqual(['2026-08-25', '2026-09-25'])
    expect(pay.every((t) => t.description === 'Stripe')).toBe(true)
    expect(pay.every((t) => t.amount === netMonthlyPay(62_000))).toBe(true)
    expect(netMonthlyPay(62_000)).toBeLessThan(62_000 / 12)
    expect(netMonthlyPay(62_000)).toBeGreaterThan(3_000)
  })

  it('pays the rent on the first and moves the saving the day after payday', () => {
    const { transactions } = synthesiseAccounts(input)
    const rent = transactions.filter((t) => t.category === 'housing')
    const saving = transactions.filter((t) => t.category === 'savings')

    expect(rent.map((t) => t.amount)).toEqual([-1_650, -1_650, -1_650])
    expect(rent.map((t) => t.bookedOn)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
    // The day after each payday, including the July one whose payday fell the day before
    // the window opened.
    expect(saving.map((t) => t.amount)).toEqual([-800, -800, -800])
    expect(saving.map((t) => t.bookedOn)).toEqual(['2026-07-25', '2026-08-26', '2026-09-26'])
  })

  it('holds the savings they said they have, and no more', () => {
    const { accounts } = synthesiseAccounts(input)
    const savings = accounts.find((a) => a.accountType === 'savings')
    const current = accounts.find((a) => a.accountType === 'current')

    expect(savings?.balance).toBe(32_000)
    expect(savings?.displayName).toBe('Savings Account')
    expect(current?.balance).toBeGreaterThan(0)
    expect(current?.balance).toBeLessThan(2_500)
  })

  it('arrives at the balance on the row after ninety days of transactions', () => {
    const { accounts, transactions } = synthesiseAccounts(input)
    const current = accounts.find((a) => a.accountType === 'current')
    const movement = transactions
      .filter((t) => t.account === 'current')
      .reduce((sum, t) => sum + Math.round(t.amount * 100), 0)

    expect(current).toBeDefined()
    expect(Math.round((current?.openingBalance ?? 0) * 100) + movement).toBe(
      Math.round((current?.balance ?? 0) * 100),
    )
    expect(transactions.every((t) => t.account === 'current')).toBe(true)
  })

  it('covers exactly ninety days, oldest first, with the ordinary spending categorised', () => {
    const { transactions } = synthesiseAccounts(input)
    const days = transactions.map((t) => t.bookedOn)

    expect(days.every((d) => d >= '2026-07-25' && d <= '2026-10-22')).toBe(true)
    expect([...days].sort()).toEqual(days)
    for (const category of ['groceries', 'transport', 'utilities', 'subscriptions', 'eating_out']) {
      expect(transactions.some((t) => t.category === category)).toBe(true)
    }
    expect(transactions.some((t) => t.description === 'Netflix' && t.amount === -14.99)).toBe(true)
    expect(
      transactions.every(
        (t) =>
          Number.isInteger(Math.round(t.amount * 100)) &&
          t.amount === Math.round(t.amount * 100) / 100,
      ),
    ).toBe(true)
  })

  it('shows no salary when none was stated, and no savings account when none was', () => {
    const { accounts, transactions } = synthesiseAccounts({ ...input, facts: reader({}) })

    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.accountType).toBe('current')
    expect(transactions.some((t) => t.amount > 0)).toBe(false)
    expect(transactions.some((t) => t.category === 'housing')).toBe(false)
    expect(accounts[0]?.balance).toBeGreaterThan(0)
  })

  it('names the credit SALARY when no employer was named', () => {
    const { transactions } = synthesiseAccounts({
      ...input,
      facts: reader({ 'income.annualBasic': 40_000 }),
    })
    expect(transactions.filter((t) => t.amount > 0).every((t) => t.description === 'SALARY')).toBe(
      true,
    )
  })

  it('gives every account an IBAN under the code no bank holds', () => {
    const { accounts } = synthesiseAccounts(input)
    for (const account of accounts) {
      expect(account.iban).toMatch(/^IE\d{2}SAOI000000\d{8}$/)
    }
    expect(maskIban('IE29SAOI00000012345678')).toBe('IE **** 5678')
  })
})

describe('the date helpers', () => {
  it('spans months inclusively and adds days across month ends', () => {
    expect(monthsSpanning('2026-07-25', '2026-10-22')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ])
    expect(addDays('2026-10-22', -89)).toBe('2026-07-25')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
