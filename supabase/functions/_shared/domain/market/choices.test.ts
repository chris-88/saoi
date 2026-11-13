import { describe, expect, it } from 'vitest'
import { productComparisonCardSchema, type MarketProductsCard } from '../../contracts/cards.ts'
import { buildPlanRequestSchema } from '../../contracts/market-tools.ts'
import {
  marketPlanSchema,
  type MarketPlan,
  type PlanChoiceSlot,
  type StoredPlanChoice,
} from '../../contracts/market-plan.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { describeEvent, isNarratable } from '../narration.ts'
import {
  allChosen,
  allChosenLine,
  choicesDigestLines,
  choicesOf,
  markChosenColumns,
  markChosenRows,
  mortgageOptionRowId,
  nextOpenSlot,
  resolveChoice,
  slotQuestion,
  slotsOf,
  type ChoiceResult,
} from './choices.ts'
import { compareProducts } from './compare.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'
import { applyPlanEdit } from './plan-edit.ts'
import { caseFigures, productsCard } from './products-card.ts'

/**
 * The customer's choices for the plan (Chris, 2026-11-13: "the goal is to get the customer to
 * pick products from the product lists we're presenting"). On the experience's worked example:
 * €110,000 between two, €32,000 saved, €1,500 a month, a €400,000 new build by June 2028.
 */

const MARKET = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-13'
const AT = '2026-11-13T10:00:00.000Z'
const BUNQ = 'bunq:savings.bunq_savings'
const SUPERSAVER = 'boi:savings.supersaver'
const BOI_FIXED = 'boi:savings.advantage_fixed'

const PLAN: MarketPlan = buildPlan(
  MARKET,
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
  '2026-11-12',
  '2026-11-12T09:00:00.000Z',
).plan
const FIGURES = caseFigures({ plan: PLAN, holdings: [], fact: () => undefined })
const MORTGAGE = PLAN.comparison?.options[0]?.rowId ?? ''

const resolve = (slot: PlanChoiceSlot, rowId: string, plan = PLAN, shown = [] as never[]) =>
  resolveChoice({ market: MARKET, figures: FIGURES, plan, slot, rowId, asOf: AS_OF, shown })

function chosen(result: ChoiceResult): Extract<ChoiceResult, { kind: 'choice' }> {
  if (result.kind !== 'choice') throw new Error(`expected a choice, got ${JSON.stringify(result)}`)
  return result
}

const stored = (result: ChoiceResult): StoredPlanChoice => {
  const { choice, end } = chosen(result)
  return { ...choice, chosenAt: AT, ...(end === null ? {} : { endsOn: end.on }) }
}

const withChoices = (...choices: StoredPlanChoice[]): MarketPlan => ({
  ...PLAN,
  choices: Object.fromEntries(choices.map((choice) => [choice.slot, choice])),
})

describe('a mortgage option’s row id', () => {
  it('is the lender’s market product id, the one a mortgage products card’s row carries', () => {
    expect(MORTGAGE).toBe('aib:mortgage.c2039')
    const card = productsCard(MARKET, FIGURES, { arrangement: 'mortgage_by_sort' }, AS_OF)
    if (card.kind !== 'card') throw new Error('no card')
    expect(card.card.rows.map((row) => row.id)).toContain(MORTGAGE)
  })

  it('is made stable from the lender, product and kind for a plan saved before it', () => {
    const option = PLAN.comparison?.options[0]
    if (option === undefined) throw new Error('no option')
    const { rowId: _dropped, ...older } = option
    expect(mortgageOptionRowId(older)).toBe(
      'mortgage:aib.higher_value_4_year_fixed_rate_ltv_greater_than_80.4_year_fixed',
    )
    expect(mortgageOptionRowId(older)).toBe(mortgageOptionRowId({ ...older }))
  })
})

describe('resolveChoice: the row rebuilt from the market by its id', () => {
  it('rebuilds bunq for the lump sum as the products card shows it, with its bonus’s end', () => {
    const result = chosen(resolve('lump_sum', BUNQ))
    expect(result.choice).toEqual({
      slot: 'lump_sum',
      rowId: BUNQ,
      lead: 'bunq Savings Account',
      providerId: 'bunq',
      kind: 'instant access',
      value: '3.11% to 1 Jan',
      figure: 'keys Sep 2027, €409',
      watches: [
        { provider: 'bunq', source: 'bank', productId: 'savings.bunq_savings', ratePct: 3.11 },
      ],
    })
    // The bonus gives way at the next reset: a reminder before 1 January.
    expect(result.end).toEqual({
      on: '2027-01-01',
      reminder: {
        kind: 'other',
        label: 'bunq Savings Account: bonus rate ends',
        dueOn: '2027-01-01',
        productId: BUNQ,
      },
    })
  })

  it('reads the row off the card the customer was shown first', () => {
    const result = chosen(
      resolve('lump_sum', BUNQ, PLAN, [{ arrangement: 'by_access' }] as never[]),
    )
    expect(result.choice.figure).toMatch(/^€[\d,]+ by Sep 2027$/)
  })

  it('takes a regular saver for the monthly saving, and a fixed term never', () => {
    expect(chosen(resolve('monthly_saving', SUPERSAVER)).choice).toMatchObject({
      lead: 'Bank of Ireland SuperSaver Account',
      kind: 'regular saver',
    })
    expect(resolve('monthly_saving', BOI_FIXED)).toEqual({
      kind: 'refused',
      code: 'wrong_slot',
      reason:
        'Bank of Ireland Advantage Fixed Term Deposit Account takes a lump sum only, so it cannot take the €1,500 a month.',
    })
  })

  it('gives a fixed term chosen for the lump sum a reminder when it matures', () => {
    const result = chosen(resolve('lump_sum', BOI_FIXED))
    expect(result.choice.kind).toBe('6-month fixed')
    expect(result.end?.reminder).toMatchObject({ kind: 'deposit_matures', dueOn: '2027-05-13' })
  })

  it('rebuilds the mortgage from the plan’s own comparison option, as its products row reads', () => {
    const result = chosen(resolve('mortgage', MORTGAGE))
    expect(result.choice).toMatchObject({
      slot: 'mortgage',
      rowId: MORTGAGE,
      lead: 'AIB Higher Value 4 Year Fixed Rate, LTV Greater than 80%',
      providerId: 'aib',
      kind: '4-year fixed at 3.25%',
      value: '€1,567/mo',
      figure: '€58,612 over 5 years',
    })
    // Its fixed period counted from the keys month.
    expect(result.end?.reminder).toMatchObject({ kind: 'fixed_rate_ends', dueOn: '2031-09-01' })
    expect(result.end?.reminder.label.length).toBeLessThanOrEqual(120)
  })

  it('finds an older plan’s option by its made-up id', () => {
    const older: MarketPlan = {
      ...PLAN,
      comparison: PLAN.comparison && {
        ...PLAN.comparison,
        options: PLAN.comparison.options.map(({ rowId: _dropped, ...option }) => option),
      },
    }
    const id = mortgageOptionRowId(older.comparison?.options[1] ?? never())
    expect(chosen(resolve('mortgage', id, older)).choice.lead).toBe('Avant Money 4 year fixed >80%')
  })

  it('refuses a product for a part that does not take it, in a sentence of fact for the sheet', () => {
    const refused = (slot: PlanChoiceSlot, rowId: string) => {
      const result = resolve(slot, rowId)
      if (result.kind !== 'refused') throw new Error(`expected a refusal for ${rowId}`)
      expect(adviceWordsIn(result.reason), result.reason).toEqual([])
      return [result.code, result.reason]
    }
    expect(refused('lump_sum', MORTGAGE)).toEqual([
      'wrong_slot',
      'AIB Higher Value 4 Year Fixed Rate, LTV Greater than 80% is a mortgage, so it cannot hold the €32,000.',
    ])
    expect(refused('monthly_saving', MORTGAGE)).toEqual([
      'wrong_slot',
      'AIB Higher Value 4 Year Fixed Rate, LTV Greater than 80% is a mortgage, so it cannot take the €1,500 a month.',
    ])
    expect(refused('mortgage', BUNQ)).toEqual([
      'wrong_slot',
      'bunq Savings Account is a savings account, not a mortgage, so it cannot be the mortgage.',
    ])
    // A regular saver takes the monthly saving only.
    expect(refused('lump_sum', SUPERSAVER)).toEqual([
      'wrong_slot',
      'Bank of Ireland SuperSaver Account takes monthly payments only, so it cannot hold the €32,000.',
    ])
    expect(refused('monthly_saving', BOI_FIXED)[0]).toBe('wrong_slot')
  })

  it('refuses an id on no card the case can show and not in the plan’s comparison', () => {
    const reason =
      'That product is not on any card shown in this conversation or in the plan’s comparison.'
    expect(resolve('lump_sum', 'nope:savings.nothing')).toEqual({
      kind: 'refused',
      code: 'unknown_row',
      reason,
    })
    expect(resolve('mortgage', 'mortgage:nobody.nothing.variable')).toEqual({
      kind: 'refused',
      code: 'unknown_row',
      reason,
    })
  })

  it('takes their own account for the lump sum, as the card sets it beside the market', () => {
    const result = chosen(resolve('lump_sum', 'held:1'))
    expect(result.choice.lead).toMatch(/^Your /)
    expect(result.end).toBeNull()
  })
})

function never(): never {
  throw new Error('missing')
}

describe('the parts, the next one and its question', () => {
  it('has the three parts on a home plan with savings and a monthly saving', () => {
    expect(slotsOf(PLAN)).toEqual(['lump_sum', 'monthly_saving', 'mortgage'])
    expect(nextOpenSlot(PLAN)).toBe('lump_sum')
    expect(choicesOf(PLAN)).toEqual({ lump_sum: null, monthly_saving: null, mortgage: null })
  })

  it('asks each in their figures and names no product', () => {
    expect(slotQuestion('lump_sum', PLAN)).toBe('Which account is the one for your €32,000?')
    expect(slotQuestion('monthly_saving', PLAN)).toBe(
      'Which account is the one for your €1,500 a month?',
    )
    expect(slotQuestion('mortgage', PLAN)).toBe('Which mortgage is the one for your €400,000 home?')
  })

  it('leaves out a part the plan does not have', () => {
    const noHome: MarketPlan = { ...PLAN, comparison: undefined }
    expect(slotsOf(noHome)).toEqual(['lump_sum', 'monthly_saving'])
  })
})

describe('the digest’s choices', () => {
  const bunq = stored(resolve('lump_sum', BUNQ))

  it('says what is chosen, what is open, and the next part’s question', () => {
    const plan = withChoices(bunq)
    expect(choicesDigestLines(plan)).toEqual([
      'Choices, theirs, made on the cards (never made for them): lump sum: bunq Savings Account (keys Sep 2027, €409); monthly saving: open; mortgage: open.',
      'Next open part: the monthly saving. Its deciding question, in their figures: "Which account is the one for your €1,500 a month?"',
    ])
    expect(nextOpenSlot(plan)).toBe('monthly_saving')
    expect(choicesOf(plan).lump_sum).toEqual({
      slot: 'lump_sum',
      rowId: BUNQ,
      lead: 'bunq Savings Account',
      providerId: 'bunq',
      kind: 'instant access',
      value: '3.11% to 1 Jan',
      figure: 'keys Sep 2027, €409',
      chosenAt: AT,
      endsOn: '2027-01-01',
    })
  })

  it('says once what the plan now does when every part is chosen, and asks nothing', () => {
    const plan = withChoices(
      bunq,
      stored(resolve('monthly_saving', SUPERSAVER)),
      stored(resolve('mortgage', MORTGAGE)),
    )
    expect(allChosen(plan)).toBe(true)
    expect(nextOpenSlot(plan)).toBeNull()
    const line = allChosenLine(plan)
    expect(line).toBe(
      'Every part of the plan is chosen: bunq Savings Account for the lump sum, Bank of Ireland SuperSaver Account for the monthly saving and AIB Higher Value 4 Year Fixed Rate, LTV Greater than 80% for the mortgage. The plan now follows them: a reminder 90, 60, 30 and 7 days before the end of bunq Savings Account on 1 January 2027, the end of Bank of Ireland SuperSaver Account on 13 November 2027 and the end of AIB Higher Value 4 Year Fixed Rate, LTV Greater than 80% on 1 September 2031, and on the day; an alert when a rate on any of them changes or one is no longer offered; and, when you come back, what changed since.',
    )
    const lines = choicesDigestLines(plan)
    expect(lines[1]).toContain('Every part is chosen.')
    expect(lines[1]).toContain('put no product question to them')
    for (const text of [...lines, line]) expect(adviceWordsIn(text), text).toEqual([])
  })

  it('holds every question and line to the line Saoi holds', () => {
    for (const slot of ['lump_sum', 'monthly_saving', 'mortgage'] as const) {
      expect(adviceWordsIn(slotQuestion(slot, PLAN))).toEqual([])
    }
    expect(adviceWordsIn(choicesDigestLines(PLAN).join('\n'))).toEqual([])
  })

  it('round-trips through the plan document', () => {
    const plan = withChoices(bunq, stored(resolve('mortgage', MORTGAGE)))
    expect(marketPlanSchema.parse(plan).choices).toEqual(plan.choices)
  })
})

describe('marking the cards', () => {
  const plan = withChoices(stored(resolve('lump_sum', BUNQ)))

  it('marks the row that is a choice on a products card, and no other', () => {
    const result = productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, AS_OF)
    if (result.kind !== 'card') throw new Error('no card')
    const card: MarketProductsCard = markChosenRows(result.card, plan.choices)
    expect(card.rows.filter((row) => row.chosen !== undefined)).toEqual([
      expect.objectContaining({ id: BUNQ, chosen: 'lump_sum' }),
    ])
    expect(markChosenRows(result.card, undefined)).toBe(result.card)
  })

  it('marks the column that is a choice on a comparison', () => {
    const result = compareProducts(MARKET, FIGURES, [SUPERSAVER, BUNQ], AS_OF)
    if (result.kind !== 'card') throw new Error('no card')
    const card = productComparisonCardSchema.parse(markChosenColumns(result.card, plan.choices))
    expect(card.columns.map((column) => column.chosen)).toEqual([undefined, 'lump_sum'])
  })
})

describe('an edit to a figure', () => {
  it('keeps the choices: they are the customer’s', () => {
    const plan = withChoices(stored(resolve('lump_sum', BUNQ)))
    const edited = applyPlanEdit(MARKET, plan, { monthlySaving: 1_800 }, AS_OF, AT)
    expect(edited?.plan.choices).toEqual(plan.choices)
  })
})

describe('the events, in words', () => {
  it('narrates a choice made, replaced and taken off, as facts in their name', () => {
    expect(isNarratable('product_chosen')).toBe(true)
    expect(isNarratable('product_choice_removed')).toBe(true)
    const lines = [
      describeEvent({
        type: 'product_chosen',
        payload: { slot: 'lump_sum', rowId: BUNQ, lead: 'bunq Savings Account' },
      }),
      describeEvent({
        type: 'product_chosen',
        payload: {
          slot: 'lump_sum',
          rowId: BOI_FIXED,
          lead: 'Bank of Ireland Advantage Fixed Term Deposit Account',
          replaced: BUNQ,
          replacedLead: 'bunq Savings Account',
        },
      }),
      describeEvent({
        type: 'product_choice_removed',
        payload: { slot: 'mortgage', rowId: MORTGAGE, lead: 'AIB 4-year fixed' },
      }),
    ]
    expect(lines).toEqual([
      'You chose bunq Savings Account for the lump sum.',
      'You chose Bank of Ireland Advantage Fixed Term Deposit Account for the lump sum, in place of bunq Savings Account.',
      'You took AIB 4-year fixed off the plan as the choice for the mortgage; it is open again.',
    ])
    for (const line of lines) expect(adviceWordsIn(line ?? '')).toEqual([])
  })
})
