import { describe, expect, it } from 'vitest'
import { marketPlanSchema, type MarketPlan } from '../../contracts/market-plan.ts'
import { buildPlanRequestSchema } from '../../contracts/market-tools.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { arrivalOpening } from './arrival.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'
import {
  applyPlanEdit,
  casePlanOf,
  editableOf,
  rebuildRequest,
  remindersToMove,
  termWords,
} from './plan-edit.ts'

/**
 * A plan edited in the profile (2026-11-12, "6. The saving months": "An edit lands in the
 * chat"), on the experience's worked example: a couple on €110,000 with €32,000 saved and €1,500
 * a month, a €400,000 new build, keys by June 2028.
 */

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-12'
const CREATED = '2026-11-12T09:00:00.000Z'
const EDITED = '2026-11-20T10:00:00.000Z'
const SLOW = { timeout: 60_000 }

const PLAN: MarketPlan = buildPlan(
  market,
  buildPlanRequestSchema.parse({
    situation: {
      income: { annualGross: 110_000 },
      monthlySaving: 1_500,
      savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
      firstTimeBuyer: true,
    },
    goals: [{ id: 'home', kind: 'house_deposit', label: 'Buying a home', targetDate: '2028-06' }],
    homePrice: 400_000,
    propertyKind: 'new_build',
    buyingTogether: true,
    homePreferences: { sortBy: 'monthly_repayment' },
  }),
  AS_OF,
  CREATED,
).plan

/** Every reading is facts: no advice words, never "better", never a pick. */
const factual = (reading: string) => {
  expect(adviceWordsIn(reading)).toEqual([])
  expect(reading).not.toMatch(/\b(better|best|worse|should|switch|recommend\w*|ideal)\b/i)
}

describe('what the profile can change', () => {
  it('reads the plan’s own inputs', () => {
    expect(PLAN.inputs).toMatchObject({
      homePrice: 400_000,
      propertyKind: 'new_build',
      firstTimeBuyer: true,
      buyingTogether: true,
      homePreferences: { sortBy: 'monthly_repayment' },
      savings: [{ access: 'instant' }],
    })
    expect(editableOf(PLAN)).toEqual({
      targetDate: '2028-06',
      homePrice: 400_000,
      monthlySaving: 1_500,
      propertyKind: 'new_build',
      firstTimeBuyer: true,
      buyingTogether: true,
    })
  })

  it('reads a plan saved before it kept its inputs from the chips and the comparison', () => {
    const { inputs: _inputs, ...older } = PLAN
    expect(editableOf(older)).toEqual({
      targetDate: '2028-06',
      homePrice: 400_000,
      monthlySaving: 1_500,
      propertyKind: 'new_build',
      firstTimeBuyer: true,
      buyingTogether: null,
    })
    // The sort the customer chose is kept from the comparison.
    expect(rebuildRequest(older, {}).homePreferences).toEqual({ sortBy: 'monthly_repayment' })
  })

  it('rebuilds on the same inputs with only the edit changed, the price held', () => {
    const request = rebuildRequest(PLAN, { monthlySaving: 1_800 })
    expect(request.situation.monthlySaving).toBe(1_800)
    expect(request.goals[0]?.targetDate).toBe('2028-06')
    expect(request.homePrice).toBe(400_000)
    expect(request.propertyKind).toBe('new_build')
    expect(request.situation.firstTimeBuyer).toBe(true)
    expect(request.homePreferences).toEqual({ sortBy: 'monthly_repayment' })
    expect(request.situation.savings[0]?.access).toBe('instant')
    expect(rebuildRequest(PLAN, { targetDate: '2028-03' }).goals[0]?.targetDate).toBe('2028-03')
  })
})

describe('an edit', () => {
  it('moving the keys earlier: less saved by then, the longer terms no longer fit', SLOW, () => {
    const result = applyPlanEdit(market, PLAN, { targetDate: '2028-03' }, AS_OF, EDITED)
    expect(result).not.toBeNull()
    if (result === null) return
    expect(result.reading).toMatch(
      /^Moving the keys to March 2028 means €[\d,]+ less saved by then at this pace; the 18-month deposits no longer fit, and deposits of up to one year still do\.$/,
    )
    factual(result.reading)
    expect(result.changes).toEqual([{ field: 'targetDate', from: '2028-06', to: '2028-03' }])
    expect(result.effects.noLongerFit).toEqual(['18-month deposits'])
    expect(result.effects.nowFit).toEqual([])
    expect(result.effects.savedByGoalDate.to?.at).toBe('2028-03')
    // The plan is rebuilt on the new date; what it was made from is kept.
    expect(result.plan.goals[0]?.targetDate).toBe('2028-03')
    expect(result.plan.title).toBe('Buying a home by March 2028')
    expect(result.plan.createdAt).toBe(PLAN.createdAt)
    expect(result.plan.edits).toEqual([
      { at: EDITED, field: 'targetDate', from: '2028-06', to: '2028-03' },
    ])
    expect(result.plan.openedWith).toBe(arrivalOpening(PLAN.arrival))
    expect(result.plan.inputs).toEqual(PLAN.inputs)
    expect(marketPlanSchema.safeParse(result.plan).success).toBe(true)
  })

  it('moving the keys so close that no term ends by then', SLOW, () => {
    const result = applyPlanEdit(market, PLAN, { targetDate: '2027-03' }, AS_OF, EDITED)
    expect(result?.reading).toMatch(
      /^Moving the keys to March 2027 means €[\d,]+ less saved by then at this pace, six months short of the money for the keys, which is there in September 2027; the six-month, one-year and 18-month deposits no longer fit, and instant-access accounts do\.$/,
    )
    factual(result?.reading ?? '')
  })

  /*
   * The live run after PR #74: the keys moved to a month before the money for them is held, and
   * the reading did not say so. The plan's keys month at this pace is September 2027.
   */
  it('moving the keys before the money for them is held states the gap', SLOW, () => {
    expect(PLAN.arrival?.keysOn?.slice(0, 7)).toBe('2027-09')
    const result = applyPlanEdit(market, PLAN, { targetDate: '2027-06' }, AS_OF, EDITED)
    expect(result?.effects.keysOn).toEqual({ from: '2027-09', to: '2027-09' })
    expect(result?.reading).toMatch(
      /^Moving the keys to June 2027 means €[\d,]+ less saved by then at this pace, three months short of the money for the keys, which is there in September 2027; the one-year and 18-month deposits no longer fit, and deposits of up to six months still do\.$/,
    )
    factual(result?.reading ?? '')
  })

  it('moving the keys to the month the money is held says nothing extra', SLOW, () => {
    const result = applyPlanEdit(market, PLAN, { targetDate: '2027-09' }, AS_OF, EDITED)
    expect(result?.reading).toMatch(
      /^Moving the keys to September 2027 means €[\d,]+ less saved by then at this pace; the one-year and 18-month deposits no longer fit, and deposits of up to six months still do\.$/,
    )
    expect(result?.reading).not.toMatch(/short of/)
  })

  it(
    'lowering the saving so the money for the keys comes after the date states the gap',
    SLOW,
    () => {
      const result = applyPlanEdit(market, PLAN, { monthlySaving: 500 }, AS_OF, EDITED)
      expect(result?.effects.keysOn).toEqual({ from: '2027-09', to: '2029-05' })
      expect(result?.reading).toMatch(
        /^Lowering the monthly saving to €500 means €[\d,]+ less saved by June 2028, eleven months short of the money for the keys, which is there in May 2029\.$/,
      )
      factual(result?.reading ?? '')
    },
  )

  it(
    'lowering the saving so the money comes in the date’s own month says nothing extra',
    SLOW,
    () => {
      const result = applyPlanEdit(market, PLAN, { monthlySaving: 800 }, AS_OF, EDITED)
      expect(result?.reading).toMatch(
        /^Lowering the monthly saving to €800 means €[\d,]+ less saved by June 2028 and the keys month moves from September 2027 to June 2028\.$/,
      )
    },
  )

  it('moving the keys later: more saved by then, longer terms now fit', SLOW, () => {
    const result = applyPlanEdit(market, PLAN, { targetDate: '2029-06' }, AS_OF, EDITED)
    expect(result?.reading).toMatch(
      /^Moving the keys to June 2029 means €[\d,]+ more saved by then at this pace; two-year deposits now fit\.$/,
    )
    expect(result?.effects.nowFit).toEqual(['two-year deposits'])
  })

  it('raising the monthly saving: more saved by the date, the keys month earlier', SLOW, () => {
    const result = applyPlanEdit(market, PLAN, { monthlySaving: 2_000 }, AS_OF, EDITED)
    expect(result?.reading).toMatch(
      /^Raising the monthly saving to €2,000 means €[\d,]+ more saved by June 2028 and the keys month moves from [A-Z][a-z]+ \d{4} to [A-Z][a-z]+ \d{4}\.$/,
    )
    factual(result?.reading ?? '')
    expect(result?.plan.situation.monthlySaving).toBe(2_000)
    const before = PLAN.comparison?.options.map((option) => option.keysOn)
    const after = result?.plan.comparison?.options.map((option) => option.keysOn)
    // The comparison re-ran on the new figures: the keys months moved.
    expect(after).not.toEqual(before)
    expect(result?.plan.arrival?.progress?.monthlySavingEur).toBe(2_000)
  })

  it('a higher price: more needed at the keys and a comparison on the new price', SLOW, () => {
    const result = applyPlanEdit(market, PLAN, { homePrice: 450_000 }, AS_OF, EDITED)
    expect(result?.reading).toMatch(
      /^Raising the price to €450,000 means €5,500 more needed at the keys \(€52,500 in all\)/,
    )
    expect(result?.effects.neededAtKeysEur).toEqual({ from: 47_000, to: 52_500 })
    expect(result?.plan.comparison?.priceEur).toBe(450_000)
    expect(result?.plan.inputs?.homePrice).toBe(450_000)
  })

  it('the kind of home, first-time status and buying together each rebuild the plan', SLOW, () => {
    const kind = applyPlanEdit(market, PLAN, { propertyKind: 'second_hand' }, AS_OF, EDITED)
    expect(kind?.plan.inputs?.propertyKind).toBe('second_hand')
    expect(kind?.plan.arrival?.assumptions).toContain('Second-hand')
    expect(kind?.reading).toMatch(/^Making it a second-hand home /)
    factual(kind?.reading ?? '')

    const bought = applyPlanEdit(market, PLAN, { firstTimeBuyer: false }, AS_OF, EDITED)
    expect(bought?.plan.inputs?.firstTimeBuyer).toBe(false)
    expect(bought?.reading).toMatch(/^Counting you as having bought before /)
    factual(bought?.reading ?? '')

    const alone = applyPlanEdit(market, PLAN, { buyingTogether: false }, AS_OF, EDITED)
    expect(alone?.plan.inputs?.buyingTogether).toBe(false)
    expect(alone?.reading).toBe(
      'Buying on your own leaves the keys month at September 2027 and the money needed at the keys at €47,000.',
    )
  })

  it('changes nothing when every value is what the plan holds', () => {
    expect(applyPlanEdit(market, PLAN, { monthlySaving: 1_500 }, AS_OF, EDITED)).toBeNull()
  })

  it('keeps the first opening line across edits', SLOW, () => {
    const once = applyPlanEdit(market, PLAN, { monthlySaving: 1_800 }, AS_OF, EDITED)
    if (once === null) throw new Error('no edit')
    const twice = applyPlanEdit(market, once.plan, { monthlySaving: 1_900 }, AS_OF, EDITED)
    expect(twice?.plan.openedWith).toBe(arrivalOpening(PLAN.arrival))
    expect(twice?.plan.edits?.map((edit) => edit.to)).toEqual([1_800, 1_900])
  })
})

describe('the profile’s view', () => {
  it('names the keys month, what is needed and the first three options in their order', () => {
    const view = casePlanOf({ id: 'plan-1', plan: PLAN }, null)
    expect(view.summary).toEqual({
      keysOn: '2027-09',
      neededAtKeysEur: 47_000,
      savedEur: 32_000,
      progressLine: null,
    })
    expect(view.watched).toHaveLength(3)
    expect(view.watched[0]).toEqual({
      // The lender's market product id: a mortgage products card's row carries the same.
      rowId: PLAN.comparison?.options[0]?.rowId,
      lead: PLAN.comparison?.options[0]?.lender,
      kind: PLAN.comparison?.options[0]?.kind,
      value: expect.stringMatching(/^\d+(\.\d+)?%$/) as unknown,
      figure: expect.stringMatching(/^€[\d,]+\/mo$/) as unknown,
    })
    expect(view.watched[0]?.rowId).toMatch(/^[a-z0-9_]+:mortgage\./)
    expect(view.choices).toEqual({ lump_sum: null, monthly_saving: null, mortgage: null })
    expect(view.updatedAt).toBe(CREATED)
  })
})

describe('reminders that move with the plan’s dates', () => {
  const reminder = (id: string, dueOn: string, kind: 'other' | 'deposit_matures' = 'other') => ({
    id,
    kind,
    label: 'Keys',
    dueOn,
    productId: null,
  })

  it('moves a date reminder in the old month to the same day of the new one', () => {
    expect(
      remindersToMove({
        reminders: [
          reminder('a', '2028-06-15'),
          reminder('b', '2028-05-31'),
          reminder('c', '2028-06-01', 'deposit_matures'),
          reminder('d', '2028-06-20'),
        ],
        heldBy: new Set(['d']),
        moves: [
          { from: '2028-06', to: '2028-03' },
          { from: '2028-05', to: '2028-04' },
        ],
        today: AS_OF,
      }),
    ).toEqual([
      {
        id: 'a',
        kind: 'other',
        label: 'Keys',
        productId: null,
        from: '2028-06-15',
        to: '2028-03-15',
      },
      // The 31st of May to the 30th of April.
      {
        id: 'b',
        kind: 'other',
        label: 'Keys',
        productId: null,
        from: '2028-05-31',
        to: '2028-04-30',
      },
    ])
  })

  it('leaves a reminder alone when the date would pass or did not move', () => {
    expect(
      remindersToMove({
        reminders: [reminder('a', '2028-06-15')],
        heldBy: new Set(),
        moves: [
          { from: '2028-06', to: '2026-10' },
          { from: null, to: '2028-01' },
        ],
        today: AS_OF,
      }),
    ).toEqual([])
  })
})

describe('words', () => {
  it('names terms as the spec does', () => {
    expect(termWords(6)).toBe('six-month')
    expect(termWords(12)).toBe('one-year')
    expect(termWords(18)).toBe('18-month')
    expect(termWords(24)).toBe('two-year')
  })
})
