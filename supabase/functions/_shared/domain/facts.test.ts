import { describe, expect, it } from 'vitest'
import { factCatalogue } from './facts.ts'
import { ALL_JOURNEYS } from './journeys/index.ts'

describe('where the salary is paid', () => {
  it('is a person-level fact, because two applicants can bank differently', () => {
    expect(factCatalogue['banking.salaryPaidTo'].subject).toBe('person')
  })

  it('can be taken from the conversation — it is an ordinary banking question', () => {
    expect(factCatalogue['banking.salaryPaidTo'].extractable).toBe(true)
    expect(factCatalogue['banking.salaryPaidTo'].sensitivity).toBe('standard')
  })

  it('names no bank, because the domain does not know whose it is running in', () => {
    const values = factCatalogue['banking.salaryPaidTo'].schema
    for (const value of ['this_bank', 'another_bank', 'not_working']) {
      expect(values.safeParse(value).success, value).toBe(true)
    }
    expect(values.safeParse('demo').success).toBe(false)
  })
})

describe("what the customer says about their partner's income", () => {
  /**
   * "I earn 150k and she earns 100k", said before the second applicant has joined. There is
   * no partner to write `income.annualBasic` against, so the figure used to be kept nowhere
   * while the plan called affordability understood on one salary.
   */
  it('belongs to the household, because the partner may not exist yet', () => {
    expect(factCatalogue['income.partnerAnnualStated'].subject).toBe('household')
  })

  it('can be taken from the conversation, and is ordinary banking data', () => {
    expect(factCatalogue['income.partnerAnnualStated'].extractable).toBe(true)
    expect(factCatalogue['income.partnerAnnualStated'].sensitivity).toBe('standard')
  })

  it('is hearsay, so it is never reused', () => {
    expect(factCatalogue['income.partnerAnnualStated'].reuse).toBe('never')
  })

  it('says on its face whose word it rests on', () => {
    expect(factCatalogue['income.partnerAnnualStated'].label).toMatch(/as the customer described/i)
  })

  it('takes a positive whole number of euro', () => {
    const { schema } = factCatalogue['income.partnerAnnualStated']
    expect(schema.safeParse(100_000).success).toBe(true)
    expect(schema.safeParse(0).success).toBe(false)
    expect(schema.safeParse('100k').success).toBe(false)
  })

  it('satisfies no journey: the partner states their own income when they join', () => {
    const everyRequirement = ALL_JOURNEYS.flatMap((journey) => [
      ...journey.requirements,
      ...journey.branches.flatMap((branch) => branch.requirements),
    ])
    const hearsay = everyRequirement.filter(
      (requirement) =>
        requirement.kind === 'fact' && requirement.fact === 'income.partnerAnnualStated',
    )
    expect(hearsay).toEqual([])
  })
})

describe('the year they graduated', () => {
  it('belongs to the person, because two applicants can have finished years apart', () => {
    expect(factCatalogue['education.graduatedYear'].subject).toBe('person')
  })

  it('is ordinary information, taken in conversation and reused without being re-asked', () => {
    expect(factCatalogue['education.graduatedYear'].extractable).toBe(true)
    expect(factCatalogue['education.graduatedYear'].sensitivity).toBe('standard')
    expect(factCatalogue['education.graduatedYear'].reuse).toBe('auto')
  })

  it('takes a plausible whole year and nothing else', () => {
    const { schema } = factCatalogue['education.graduatedYear']
    for (const year of [1950, 2024, 2100]) {
      expect(schema.safeParse(year).success, String(year)).toBe(true)
    }
    for (const value of [1949, 2101, 2024.5, '2024']) {
      expect(schema.safeParse(value).success, String(value)).toBe(false)
    }
  })

  it('is labelled in plain words', () => {
    expect(factCatalogue['education.graduatedYear'].label).toBe('Year they graduated')
  })
})

describe('whether they already hold a payment account in Ireland', () => {
  it('belongs to the person, because two applicants can have arrived from different places', () => {
    expect(factCatalogue['banking.holdsIrishPaymentAccount'].subject).toBe('person')
  })

  it('is a yes or a no', () => {
    const { schema } = factCatalogue['banking.holdsIrishPaymentAccount']
    expect(schema.safeParse(true).success).toBe(true)
    expect(schema.safeParse(false).success).toBe(true)
    expect(schema.safeParse('no').success).toBe(false)
  })

  it('is taken in conversation and reused silently', () => {
    expect(factCatalogue['banking.holdsIrishPaymentAccount'].extractable).toBe(true)
    expect(factCatalogue['banking.holdsIrishPaymentAccount'].sensitivity).toBe('standard')
    expect(factCatalogue['banking.holdsIrishPaymentAccount'].reuse).toBe('auto')
  })

  it('says on its face what it is about', () => {
    expect(factCatalogue['banking.holdsIrishPaymentAccount'].label).toBe(
      'Already holds a payment account in Ireland',
    )
  })
})

describe('employment status', () => {
  it('admits a student, which the goal clusters and the current account rules both read', () => {
    expect(factCatalogue['employment.status'].schema.safeParse('student').success).toBe(true)
  })
})

/**
 * A date the way a person writes it. Three refusals across two cases were spelling, not
 * meaning, and each cost a model round.
 */
describe('normaliseDate', () => {
  it('reads day-first dates, month-and-year, and month names', async () => {
    const { normaliseDate, parseFactValue } = await import('./facts.ts')
    expect(normaliseDate('01/01/1988')).toBe('1988-01-01')
    expect(normaliseDate('5.3.1990')).toBe('1990-03-05')
    expect(normaliseDate('11/2026')).toBe('2026-11')
    expect(normaliseDate('November 2026')).toBe('2026-11')
    expect(normaliseDate('Nov 2026')).toBe('2026-11')
    expect(normaliseDate('3rd June 2027')).toBe('2027-06-03')
    expect(normaliseDate('end of next year')).toBeNull()

    expect(parseFactValue('identity.dateOfBirth', '01/01/1988')).toEqual({
      ok: true,
      value: '1988-01-01',
    })
    expect(parseFactValue('mortgage.currentRateEndsAt', 'November 2026')).toEqual({
      ok: true,
      value: '2026-11',
    })
    expect(parseFactValue('goals.targetDate', 'end of next year').ok).toBe(false)
    // Already valid input is untouched.
    expect(parseFactValue('identity.dateOfBirth', '1988-01-01')).toEqual({
      ok: true,
      value: '1988-01-01',
    })
  })
})
