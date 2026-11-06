import { describe, expect, it } from 'vitest'
import { suitableCurrentAccount } from './current-accounts.ts'
import { demoKnowledgeBase } from './knowledge-base.ts'
import type { FactReader } from '../../domain/journey.ts'
import type { KnowledgeProduct } from './kb-types.ts'

/** 2026-10-18, as the turn would pass it. UTC so the day does not move with the machine. */
const TODAY = new Date(Date.UTC(2026, 9, 18))

const products = demoKnowledgeBase.products

/** A reader over a plain object, so a test can state the case in one literal. */
function readerOf(facts: Record<string, unknown>): FactReader {
  return {
    has: (key) => facts[key] !== undefined,
    get: (key) => facts[key],
    number: (key) => (typeof facts[key] === 'number' ? facts[key] : null),
    boolean: (key) => (typeof facts[key] === 'boolean' ? facts[key] : null),
  }
}

const pick = (facts: Record<string, unknown>, catalogue: readonly KnowledgeProduct[] = products) =>
  suitableCurrentAccount(readerOf(facts), TODAY, catalogue)

const without = (...ids: readonly string[]): readonly KnowledgeProduct[] =>
  products.filter((product) => !ids.includes(product.id))

/**
 * Five accounts, one of which has a fee. Which one somebody gets is the pack's own eligibility,
 * decided from facts, so the model cannot hand a graduate the account that costs money.
 */
describe('which current account, against the real catalogue', () => {
  const cases: readonly {
    readonly name: string
    readonly facts: Record<string, unknown>
    readonly expected: string
  }[] = [
    { name: 'nothing known', facts: {}, expected: 'current.personal' },
    {
      name: '68 years old',
      facts: { 'identity.dateOfBirth': '1958-03-02' },
      expected: 'current.golden_years',
    },
    {
      name: '66 today',
      facts: { 'identity.dateOfBirth': '1960-10-18' },
      expected: 'current.golden_years',
    },
    {
      name: '66 tomorrow',
      facts: { 'identity.dateOfBirth': '1960-10-19' },
      expected: 'current.personal',
    },
    {
      name: 'a student',
      facts: { 'employment.status': 'student' },
      expected: 'current.third_level',
    },
    {
      name: 'graduated last year',
      facts: { 'education.graduatedYear': 2025 },
      expected: 'current.graduate',
    },
    {
      name: 'graduated this year',
      facts: { 'education.graduatedYear': 2026 },
      expected: 'current.graduate',
    },
    {
      name: 'graduated three years ago',
      facts: { 'education.graduatedYear': 2023 },
      expected: 'current.graduate',
    },
    {
      name: 'graduated four years ago',
      facts: { 'education.graduatedYear': 2022 },
      expected: 'current.personal',
    },
    {
      name: 'graduating next year',
      facts: { 'education.graduatedYear': 2027 },
      expected: 'current.personal',
    },
    {
      name: 'no Irish account and not working',
      facts: { 'banking.holdsIrishPaymentAccount': false, 'employment.status': 'not_working' },
      expected: 'current.basic',
    },
    {
      name: 'no Irish account and retired, age unknown',
      facts: { 'banking.holdsIrishPaymentAccount': false, 'employment.status': 'retired' },
      expected: 'current.basic',
    },
    {
      name: 'no Irish account but in work',
      facts: {
        'banking.holdsIrishPaymentAccount': false,
        'employment.status': 'employed_full_time',
      },
      expected: 'current.personal',
    },
    {
      name: 'no Irish account, employment unknown',
      facts: { 'banking.holdsIrishPaymentAccount': false },
      expected: 'current.personal',
    },
    {
      name: 'has an Irish account and not working',
      facts: { 'banking.holdsIrishPaymentAccount': true, 'employment.status': 'not_working' },
      expected: 'current.personal',
    },
    {
      name: 'a 68-year-old student: age is decided first',
      facts: { 'identity.dateOfBirth': '1958-03-02', 'employment.status': 'student' },
      expected: 'current.golden_years',
    },
    {
      name: 'a student who also graduated recently: still a student',
      facts: { 'employment.status': 'student', 'education.graduatedYear': 2025 },
      expected: 'current.third_level',
    },
    {
      name: 'a recent graduate with no Irish account and no job yet: graduate before basic',
      facts: {
        'education.graduatedYear': 2026,
        'banking.holdsIrishPaymentAccount': false,
        'employment.status': 'not_working',
      },
      expected: 'current.graduate',
    },
  ]

  for (const { name, facts, expected } of cases) {
    it(`picks ${expected} for ${name}`, () => {
      const result = pick(facts)
      expect(result?.catalogueId).toBe(expected)
      expect(result?.name).toBe(products.find((product) => product.id === expected)?.name)
    })
  }

  it('lists every other current account as the ones not to offer', () => {
    expect(pick({ 'education.graduatedYear': 2025 })?.insteadOf).toEqual([
      'current.golden_years',
      'current.third_level',
      'current.basic',
      'current.personal',
    ])
  })

  it('ignores a date of birth that is not one', () => {
    expect(pick({ 'identity.dateOfBirth': 'sometime in 1958' })?.catalogueId).toBe(
      'current.personal',
    )
  })
})

describe('what it says, which is the pack and never a figure of its own', () => {
  it('cites the fee and the eligibility lines for the default', () => {
    const because = pick({})?.because ?? ''

    expect(because).toMatch(/€6 monthly maintenance fee/)
    expect(because).toMatch(/18\+/)
    expect(because).toMatch(/ROI resident or moving to ROI within 45 days/)
  })

  it('says what would change the default, one clause per fact not held', () => {
    const because = pick({})?.because ?? ''

    expect(because).toMatch(
      /66 or over, the Golden Years Current Account has no monthly maintenance fee/,
    )
    expect(because).toMatch(/full-time student, the Third Level Current Account/)
    expect(because).toMatch(/graduated in the last 3 years, the Graduate Current Account/)
    expect(because).toMatch(
      /first payment account in Ireland and they are not in work, the Basic Bank Account/,
    )
  })

  it('drops a hint once the fact that would raise it is held and rules it out', () => {
    const because =
      pick({
        'identity.dateOfBirth': '1990-01-01',
        'employment.status': 'employed_full_time',
        'education.graduatedYear': 2015,
      })?.because ?? ''

    expect(because).not.toMatch(/Golden Years/)
    expect(because).not.toMatch(/Third Level/)
    expect(because).not.toMatch(/Graduate Current Account/)
    // In work, so the Basic account is out whatever the answer about an Irish account.
    expect(because).not.toMatch(/Basic Bank Account/)
  })

  it('explains the graduate account in the pack’s words, fee-free period included', () => {
    const because = pick({ 'education.graduatedYear': 2025 })?.because ?? ''

    expect(because).toMatch(/graduated a year ago/)
    expect(because).toMatch(/Graduated in past 3 years/)
    expect(because).toMatch(
      /no monthly maintenance fee for the qualifying period \(2 years per public page\)/,
    )
  })

  it('carries the pack’s caution with the basic account', () => {
    const because =
      pick({ 'banking.holdsIrishPaymentAccount': false, 'employment.status': 'not_working' })
        ?.because ?? ''

    expect(because).toMatch(/Must not already hold a payment account in ROI/)
    expect(because).toMatch(/Do not position purely as a cheaper Personal Current Account/)
  })

  it('reads the fee from the catalogue it is given, not from memory', () => {
    const edited = products.map((product) =>
      product.id === 'current.personal'
        ? {
            ...product,
            pricing_and_rates: { ...product.pricing_and_rates, maintenance_fee_eur_month: 7 },
          }
        : product,
    )

    expect(pick({}, edited)?.because).toMatch(/€7 monthly maintenance fee/)
    expect(pick({}, edited)?.because).not.toMatch(/€6/)
  })
})

describe('an edited catalogue', () => {
  it('never picks an account a presenter has switched off, and falls to the next rule', () => {
    const result = pick({ 'education.graduatedYear': 2025 }, without('current.graduate'))

    expect(result?.catalogueId).toBe('current.personal')
    expect(result?.insteadOf).not.toContain('current.graduate')
  })

  it('offers whatever is left when the default itself is off, and says so', () => {
    const result = pick(
      {},
      without('current.personal', 'current.basic', 'current.third_level', 'current.graduate'),
    )

    expect(result?.catalogueId).toBe('current.golden_years')
    expect(result?.because).toMatch(/not in this catalogue/)
    expect(result?.insteadOf).toEqual([])
  })

  it('has nothing to pick when the catalogue holds no current account', () => {
    const savingsOnly = products.filter((product) => product.id.startsWith('savings.'))

    expect(pick({}, savingsOnly)).toBeNull()
  })
})
