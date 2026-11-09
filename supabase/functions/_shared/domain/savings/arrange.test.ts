import { describe, expect, it } from 'vitest'
import { arrange, type SavingsOption, type SavingsSituation } from './arrange.ts'

/**
 * The Demo Bank numbers, as the knowledge base holds them.
 *
 * Copied rather than imported: `_shared/domain` never reaches into a tenant (Invariant 11),
 * and a test that asserts on €2,000 and 2.15% should fail loudly when somebody edits those,
 * not quietly follow them.
 */
const fixedTerm: SavingsOption = {
  id: 'savings.advantage_fixed',
  name: 'Advantage Fixed Term Deposit Account',
  annualRate: null,
  terms: [
    { months: 6, annualRate: 0.0151 },
    { months: 12, annualRate: 0.0215 },
    { months: 18, annualRate: 0.0224 },
  ],
  takesLumpSum: true,
  takesMonthly: false,
  minLumpSum: 5000,
  watch: ['A single lodgement, with only 25% reachable before the term ends.'],
}

const mortgageSaver: SavingsOption = {
  id: 'savings.mortgagesaver',
  name: 'MortgageSaver Account',
  annualRate: 0.02,
  takesLumpSum: true,
  takesMonthly: true,
  minMonthly: 200,
  maxMonthly: 2500,
  maxLumpSum: 20000,
  tierCap: 15000,
  aboveTierRate: 0.005,
  lumpSumRate: 0.005,
  bonus: {
    amount: 2000,
    requiresMortgageHere: true,
    minMonthly: 200,
    minMonths: 6,
    minTotal: 5000,
    withinMonths: 30,
  },
  watch: ['The bonus needs a Demo Bank mortgage drawn down within 30 months.'],
}

const superSaver: SavingsOption = {
  id: 'savings.supersaver',
  name: 'SuperSaver Account',
  annualRate: 0.03,
  takesLumpSum: false,
  takesMonthly: true,
  minMonthly: 5,
  maxMonthly: 2500,
  watch: ['The 3% is fixed for twelve months, then it drops to the standard variable rate.'],
}

const instant: SavingsOption = {
  id: 'savings.instant_access',
  name: 'Instant Access',
  annualRate: 0.001,
  takesLumpSum: true,
  takesMonthly: true,
  watch: [],
}

const CATALOGUE = [fixedTerm, mortgageSaver, superSaver, instant]

/** Case c77e613f, which is where all of this came from. */
const dublin: SavingsSituation = {
  lumpSum: 32000,
  monthly: 2500,
  firstTimeBuyer: true,
  mortgageWithThisBank: true,
  monthsToTarget: 8,
}

const found = (id: string, result: ReturnType<typeof arrange>) =>
  result?.allocations.find((allocation) => allocation.productId === id)

describe('arranging a customer’s saving across the catalogue', () => {
  /**
   * The shape a banker would reach for, and the one the customer of c77e613f worked out for
   * themselves while Saoirse was offering them a choice of two.
   */
  it('splits the lump sum and the monthly saving across three accounts', () => {
    const result = arrange(dublin, CATALOGUE)

    expect(result?.allocations.map((allocation) => allocation.productId)).toEqual([
      'savings.advantage_fixed',
      'savings.mortgagesaver',
      'savings.supersaver',
    ])
  })

  /**
   * Exactly the minimum into MortgageSaver, never more.
   *
   * Above €200 the bonus pays nothing extra and the rate is a point worse than SuperSaver's,
   * so every euro above the threshold is a euro earning less for no reason. This is the whole
   * argument for arranging rather than choosing.
   */
  it('puts the bonus minimum into MortgageSaver and no more', () => {
    const result = arrange(dublin, CATALOGUE)

    expect(found('savings.mortgagesaver', result)).toMatchObject({
      amount: 200,
      cadence: 'monthly',
    })
    expect(found('savings.supersaver', result)).toMatchObject({
      amount: 2300,
      cadence: 'monthly',
    })
  })

  /**
   * The finding that changes the answer.
   *
   * They need the deposit in eight months. A 12-month term pays 2.15% and ends four months
   * after they have to hand it over, and an 18-month one is worse again — so the six-month
   * term at 1.51% is the only one that fits, and the better rate is not available to them at
   * any price. A model reading a rate table picks the big number.
   */
  it('refuses a term that outlives the goal, however well it pays', () => {
    const result = arrange(dublin, CATALOGUE)

    expect(found('savings.advantage_fixed', result)).toMatchObject({
      amount: 32000,
      cadence: 'once',
      termMonths: 6,
    })
  })

  it('takes the longer term when there is time for it', () => {
    const result = arrange({ ...dublin, monthsToTarget: 24 }, CATALOGUE)
    expect(found('savings.advantage_fixed', result)?.termMonths).toBe(18)
  })

  /** No date at all means no basis for locking money away, so the date is asked for first. */
  it('asks when they need the money before leaving the fixed term out', () => {
    const result = arrange({ ...dublin, monthsToTarget: null }, CATALOGUE)
    expect(found('savings.advantage_fixed', result)).toBeUndefined()
    expect(result?.needs.map((need) => need.key)).toEqual(['goals.targetDate'])
  })

  it('does not ask for a date when there is no lump sum to lock away', () => {
    const result = arrange({ ...dublin, lumpSum: null, monthsToTarget: null }, CATALOGUE)
    expect(result?.needs ?? []).toEqual([])
  })
})

describe('when the bonus is not actually available', () => {
  it('skips MortgageSaver when the mortgage is going elsewhere', () => {
    const result = arrange({ ...dublin, mortgageWithThisBank: false }, CATALOGUE)

    expect(found('savings.mortgagesaver', result)).toBeUndefined()
    // The whole monthly amount now goes where it earns most.
    expect(found('savings.supersaver', result)?.amount).toBe(2500)
  })

  /**
   * Unknown is not the same as no, and it is not the same as yes either.
   *
   * The bonus turns on a Demo Bank mortgage being drawn down. Arranging €200 a month
   * around a condition nobody has confirmed would be the engine assuming the answer. The
   * question is cheap and the answer moves €2,000, so the arrangement says it needs it rather
   * than quietly going ahead without: on a live case it went ahead with a note on the card,
   * nobody asked, and the customer raised the bonus themselves two turns later.
   */
  it('says it needs to know where the mortgage is going before it is shown', () => {
    const result = arrange({ ...dublin, mortgageWithThisBank: null }, CATALOGUE)

    expect(found('savings.mortgagesaver', result)).toBeUndefined()
    expect(result?.needs.map((need) => need.key)).toEqual(['mortgage.withThisBank'])
    expect(result?.notes.some((note) => /mortgage/i.test(note))).toBe(true)
  })

  /** "I want to buy a house next year" does not say first home, and unknown is not no. */
  it('asks whether it is a first home before leaving the bonus out', () => {
    const result = arrange(
      { ...dublin, firstTimeBuyer: null, mortgageWithThisBank: null },
      CATALOGUE,
    )

    expect(found('savings.mortgagesaver', result)).toBeUndefined()
    expect(result?.needs.map((need) => need.key)).toEqual(['housing.firstTimeBuyer'])
  })

  it('needs nothing once the question is answered either way', () => {
    expect(arrange(dublin, CATALOGUE)?.needs).toEqual([])
    expect(arrange({ ...dublin, mortgageWithThisBank: false }, CATALOGUE)?.needs).toEqual([])
    expect(
      arrange({ ...dublin, firstTimeBuyer: false, mortgageWithThisBank: null }, CATALOGUE)?.needs,
    ).toEqual([])
  })

  it('skips it for somebody who is not a first-time buyer', () => {
    const result = arrange({ ...dublin, firstTimeBuyer: false }, CATALOGUE)
    expect(found('savings.mortgagesaver', result)).toBeUndefined()
  })

  it('skips it when they cannot afford the monthly minimum', () => {
    const result = arrange({ ...dublin, monthly: 150 }, CATALOGUE)
    expect(found('savings.mortgagesaver', result)).toBeUndefined()
  })
})

describe('the limits the products actually carry', () => {
  it('respects a minimum lodgement', () => {
    const result = arrange({ ...dublin, lumpSum: 3000 }, CATALOGUE)
    expect(found('savings.advantage_fixed', result)).toBeUndefined()
  })

  it('caps a monthly amount and says what is left over', () => {
    const result = arrange({ ...dublin, monthly: 4000, mortgageWithThisBank: false }, CATALOGUE)

    expect(found('savings.supersaver', result)?.amount).toBe(2500)
    expect(result?.unallocated.monthly).toBe(1500)
  })

  it('never offers a regular saver a lump sum it does not take', () => {
    const result = arrange({ ...dublin, monthly: null }, CATALOGUE)
    expect(found('savings.supersaver', result)).toBeUndefined()
  })
})

describe('a lump sum earns the lump-sum rate', () => {
  /**
   * MortgageSaver's 2% is for monthly direct debits. A lump sum lodged in branch earns 0.5% on
   * every euro, even under the €15,000 tier. Pricing it at the headline ranked MortgageSaver
   * above a 1% notice account it loses to, and overstated what the arrangement earns.
   */
  const notice: SavingsOption = {
    id: 'savings.notice_31_day',
    name: '31-Day Notice Account',
    annualRate: 0.01,
    takesLumpSum: true,
    takesMonthly: false,
    minLumpSum: 5000,
    watch: [],
  }
  const noTerm = { ...dublin, lumpSum: 10000, monthsToTarget: 3 }

  it('prices a lump sum under the tier at the lump-sum rate, not the headline', () => {
    const result = arrange(noTerm, [mortgageSaver, superSaver, instant])
    const lump = result?.allocations.find(
      (allocation) =>
        allocation.productId === 'savings.mortgagesaver' && allocation.cadence === 'once',
    )

    expect(lump?.amount).toBe(10000)
    expect(lump?.annualRate).toBe(0.005)
    // And the monthly bonus money still earns the headline.
    expect(
      result?.allocations.find(
        (allocation) =>
          allocation.productId === 'savings.mortgagesaver' && allocation.cadence === 'monthly',
      )?.annualRate,
    ).toBe(0.02)
  })

  it('ranks a 1% notice account above MortgageSaver for the lump sum', () => {
    const result = arrange(noTerm, [mortgageSaver, superSaver, instant, notice])
    const lumpHome = result?.allocations.find((allocation) => allocation.cadence === 'once')

    expect(lumpHome?.productId).toBe('savings.notice_31_day')
  })

  it('falls back to the tier where no lump-sum rate is stated', () => {
    const { lumpSumRate: _none, ...tierOnly } = mortgageSaver
    const result = arrange(noTerm, [tierOnly, superSaver, instant])

    expect(
      result?.allocations.find((allocation) => allocation.cadence === 'once')?.annualRate,
    ).toBe(0.02)
  })
})

describe('what the arrangement is worth', () => {
  /**
   * Interest and bonus are reported separately and never added together.
   *
   * One is arithmetic on a published rate and the other is conditional on a mortgage being
   * drawn down within 30 months. A single headline figure would quietly promise the second.
   */
  it('keeps the conditional money out of the interest figure', () => {
    const result = arrange(dublin, CATALOGUE)

    expect(result?.bonus?.amount).toBe(2000)
    expect(result?.bonus?.conditions.length).toBeGreaterThan(0)
    // 32,000 at 1.51% plus the two monthly streams: nowhere near the bonus.
    expect(result?.firstYearInterest).toBeGreaterThan(0)
    expect(result?.firstYearInterest).toBeLessThan(1000)
  })

  it('carries each product’s own caution', () => {
    const result = arrange(dublin, CATALOGUE)
    expect(found('savings.supersaver', result)?.watch[0]).toMatch(/twelve months/)
  })
})

describe('when there is nothing to arrange', () => {
  /** One account is a recommendation, not an arrangement, and `show_comparison` already does it. */
  it('returns nothing when only one thing fits', () => {
    expect(arrange({ ...dublin, lumpSum: null, mortgageWithThisBank: false }, CATALOGUE)).toBeNull()
  })

  it('returns nothing when there is no money', () => {
    expect(arrange({ ...dublin, lumpSum: null, monthly: null }, CATALOGUE)).toBeNull()
  })

  it('returns nothing when the catalogue is empty', () => {
    expect(arrange(dublin, [])).toBeNull()
  })
})
