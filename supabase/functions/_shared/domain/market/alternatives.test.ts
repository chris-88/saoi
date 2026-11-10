import { describe, expect, it } from 'vitest'
import {
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  moneyCheckRequestSchema,
} from '../../contracts/market-tools.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { moneyCheck } from './money-check.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'

/**
 * Test 5 (2026-11-09): the host called saoi_build_plan once per scenario, and each call drew its
 * own card. One call now carries the alternatives.
 */

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-09'
const CREATED = '2026-11-09T22:42:00.000Z'
const loan = { id: 'car-loan', kind: 'car_finance', label: 'car loan', balance: 9_000, ratePct: 9 }
const body = {
  situation: {
    monthlySaving: 800,
    savings: [{ label: 'current account', balance: 25_000 }],
    debts: [loan],
  },
  goals: [{ id: 'deposit', kind: 'house_deposit', label: 'House deposit', targetDate: '2028-11' }],
  emergencyBufferEur: 5_000,
}
const plan = (extra: Record<string, unknown>) =>
  buildPlan(market, buildPlanRequestSchema.parse({ ...body, ...extra }), AS_OF, CREATED)

describe('alternatives in one call', () => {
  const alternatives = [
    {
      name: 'Keep €6,000 aside, keep the loan',
      emergencyBufferEur: 6_000,
      debtPlans: [{ debtId: 'car-loan', plan: 'keep' }],
    },
    { name: '€1,000 a month', monthlySaving: 1_000 },
  ]
  const result = plan({ alternatives })

  it('works each out as its own plan would, and compares its net figure with the main plan', () => {
    expect(result.alternatives).toHaveLength(2)
    const [keep, more] = result.alternatives
    const alone = plan({
      emergencyBufferEur: 6_000,
      situation: { ...body.situation, debts: [{ ...loan, plan: 'keep' }] },
    })
    expect(keep?.position).toEqual(alone.position)
    expect(keep?.differenceEur).toBeCloseTo(alone.position.total - result.position.total, 2)
    expect(keep?.changes).toEqual(['the car loan kept', 'a €6,000 emergency buffer'])
    expect(more?.differenceEur).toBeGreaterThan(4_000)
    expect(keep?.line).toMatch(
      /^Option “Keep €6,000 aside, keep the loan” \(the car loan kept, a €6,000 emergency buffer\): €[\d,.]+ towards the house deposit at November 2028, €[\d,.]+ (more|less) than the plan above \(€[\d,.]+ held in all, €[\d,.]+ of it as a buffer\)\.$/,
    )
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
  })

  it('leaves the main plan as it would be without them, and adds one line each before the close', () => {
    const without = plan({})
    expect(without.alternatives).toEqual([])
    expect(result.plan).toEqual(without.plan)
    expect(result.position).toEqual(without.position)
    expect(result.presentation.slice(0, -1)).toEqual([
      ...without.presentation.slice(0, -1),
      ...result.alternatives.map((alternative) => alternative.line),
    ])
    expect(result.presentation.at(-1)).toBe(without.presentation.at(-1))
  })

  it('carries through the money check, which gives the same alternatives', () => {
    const checked = moneyCheck(
      market,
      moneyCheckRequestSchema.parse({ ...body, alternatives }),
      AS_OF,
      CREATED,
    )
    expect(checked.plan?.alternatives).toEqual(result.alternatives)
    expect(checked.presentation.join('\n')).toContain(result.alternatives[0]?.line ?? 'missing')
  })

  it('takes at most three, and never tells the host to call again to compare', () => {
    expect(() =>
      buildPlanRequestSchema.parse({
        ...body,
        alternatives: [1, 2, 3, 4].map((n) => ({ name: `Option ${String(n)}` })),
      }),
    ).toThrow()
    const text = [...result.whatIf.lines, result.next].join(' ')
    expect(text).not.toMatch(/call (saoi_build_plan )?again with/)
    expect(result.next).toMatch(/pass them as `alternatives` in one saoi_build_plan call/)
  })

  it('makes clearing and keeping comparable: each option equals the matching scenario', () => {
    const both = plan({
      alternatives: [
        { name: 'Cleared', debtPlans: [{ debtId: 'car-loan', plan: 'clear' }] },
        { name: 'Kept', debtPlans: [{ debtId: 'car-loan', plan: 'keep' }] },
      ],
    })
    const scenario = both.debtScenarios[0]
    expect(both.alternatives[0]?.position.total).toBeCloseTo(scenario?.cleared.netPosition ?? 0, 1)
    expect(both.alternatives[1]?.position.total).toBeCloseTo(scenario?.kept.netPosition ?? 0, 1)
    const line =
      both.presentation.find((text) => text.startsWith('car loan, cleared or kept')) ?? ''
    expect(line).toMatch(/of interest paid if it is kept/)
    expect(line).toMatch(/€409\.71 a month repayment saved once it is cleared/)
  })

  it('puts no imperative at the start of any presentation line', () => {
    const lines = plan({
      alternatives: [{ name: 'Keep the loan', debtPlans: [{ debtId: 'car-loan', plan: 'keep' }] }],
    }).presentation
    for (const line of lines) {
      expect(line).not.toMatch(
        /^(Clear|Pay|Don’t|Don't|Do not|Lock|Move|Put|Set up|Open|Ask|Save|Keep|Switch|Get|Use|Take)\b/,
      )
    }
  })

  it('states Help to Buy as a sourced fact when the goal is a house', () => {
    const line = plan({}).presentation.find((text) => text.startsWith('Help to Buy')) ?? ''
    expect(line).toMatch(/€35,000 \(applications from 2026-10-07\)/)
    expect(line).toMatch(/Source: Revenue, https:\/\/www\.revenue\.ie\/.*checked 2026-11-09/)
  })

  it('compares a buffer by what goes towards the goal, not the unchanged total', () => {
    const withBuffer = plan({
      emergencyBufferEur: 0,
      alternatives: [{ name: 'With a buffer', emergencyBufferEur: 5_000 }],
    })
    const option = withBuffer.alternatives[0]
    expect(option?.towardsGoalDifferenceEur).toBeLessThan(-4_900)
    expect(option?.line).toMatch(/€[\d,.]+ less than the plan above/)
  })

  it('never suggests a buffer the customer did not raise', () => {
    const plain = plan({ emergencyBufferEur: undefined })
    const text = [
      ...plain.presentation,
      ...plain.whatIf.lines,
      plain.next,
      ...plain.questions,
    ].join(' ')
    expect(plain.position.buffer).toBe(0)
    expect(text).not.toMatch(/buffer/i)
  })
})
