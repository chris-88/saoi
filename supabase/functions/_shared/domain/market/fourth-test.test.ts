import { describe, expect, it } from 'vitest'
import { marketPlanSchema } from '../../contracts/market-plan.ts'
import {
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  moneyCheckRequestSchema,
  type Situation,
} from '../../contracts/market-tools.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { withHeldRates } from './held-rates.ts'
import { moneyCheck } from './money-check.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'

/**
 * The fourth Claude test (2026-11-09), from the phone: "€25,000 sitting in my current account
 * doing nothing", €800 a month, a house deposit in about two years, a car loan with about €9,000
 * left at 9%. The host passed the loan's balance and rate only, and a €5,000 buffer.
 */

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-09'
const CREATED = '2026-11-09T16:38:00.000Z'

const loan = { id: 'car-loan', kind: 'car_finance', label: 'car loan', balance: 9_000, ratePct: 9 }
const asked = {
  summary:
    'About €25,000 in a current account doing nothing, €800 a month, a deposit in two years.',
  monthlySaving: 800,
  savings: [{ label: 'current account', balance: 25_000 }],
  debts: [loan],
}
const home = {
  id: 'deposit',
  kind: 'house_deposit',
  label: 'House deposit',
  targetDate: '2028-11',
  priority: 1,
}
const plan = (body: Record<string, unknown>) =>
  buildPlan(market, buildPlanRequestSchema.parse(body), AS_OF, CREATED)
const check = (body: Record<string, unknown>) =>
  moneyCheck(market, moneyCheckRequestSchema.parse(body), AS_OF, CREATED)

describe('money held in a current account earns 0%, which is known', () => {
  it('reads a current account from its access, or from its label when access is absent', () => {
    const situation: Situation = {
      savings: [
        { label: 'current account', balance: 25_000 },
        { label: 'Main account', balance: 1_000, access: 'current_account' },
        { label: 'Savings account', balance: 5_000, access: 'instant' },
        { label: 'Current account', balance: 2_000, aerPct: 0.1 },
      ],
      debts: [],
    }
    const { situation: resolved, basis, short } = withHeldRates(market, situation)
    expect(resolved.savings.map((item) => item.aerPct)).toEqual([0, 0, undefined, 0.1])
    expect(basis).toHaveLength(2)
    expect(basis[0]).toMatch(/every current account in CCPC’s table .* states 0%/)
    expect(short).toMatch(/counted as earning 0%/)
  })

  it('uses the provider’s own CCPC row when the provider is given', () => {
    const { basis } = withHeldRates(market, {
      savings: [{ label: 'current account', balance: 10_000, provider: 'Bank of Ireland' }],
      debts: [],
    })
    expect(basis[0]).toMatch(
      /the credit interest CCPC’s current-account table states for Bank of Ireland/,
    )
  })

  it('counts the gain in the plan’s money found, and keeps savings accounts without a rate unknown', () => {
    const result = plan({ situation: asked, goals: [home], emergencyBufferEur: 5_000 })
    expect(result.moneyFound.annualEur).toBeGreaterThan(300)
    expect(result.moneyFound.headline).toMatch(/^Money found: about €[\d,]+ a year after DIRT/)
    expect(result.moneyFound.headline).not.toMatch(/No money found/)
    expect(result.moneyFound.basis).toMatch(/current account: counted as earning 0%/)

    const unknown = plan({
      situation: { ...asked, savings: [{ label: 'Savings account', balance: 25_000 }] },
      goals: [home],
      emergencyBufferEur: 5_000,
    })
    // The savings account's rate is unknown, so none of its money counts as found; the car loan
    // (modelled on an assumed even repayment) is the only part.
    expect(unknown.moneyFound.parts.map((part) => part.kind)).toEqual(['debt_interest'])
  })
})

describe('the net position says what it includes', () => {
  it('counts the buffer, names the parts, and says no debts were given when none were', () => {
    const result = plan({
      situation: { ...asked, savings: [{ label: 'current account', balance: 16_000 }], debts: [] },
      goals: [home],
      emergencyBufferEur: 5_000,
    })
    const { position } = result
    expect(position.debtsGiven).toBe(false)
    expect(position.buffer).toBeGreaterThan(5_000)
    expect(position.total).toBeCloseTo(position.towardsGoal + position.buffer, 1)
    expect(position.line).toMatch(
      /^€[\d,]+ in all at November 2028: €[\d,]+ towards the house deposit and €[\d,]+ emergency buffer \(no debts given\)\.$/,
    )
    expect(position.line).not.toMatch(/net/)
    // A home goal leads with the pathways; the old order follows them.
    const lead = result.presentation.indexOf(result.moneyFound.headline)
    expect(result.presentation[lead + 1]).toBe(position.line)
    // The plan document carries it, and the app's card shows the assumptions in order.
    expect(result.plan.position?.line).toBe(position.line)
    expect(result.plan.assumptions[0]).toBe(position.line)
    expect(() => marketPlanSchema.parse(result.plan)).not.toThrow()
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
  })

  it('includes the buffer in every net position, so the scenarios add up to the position', () => {
    const result = plan({
      situation: { ...asked, debts: [{ ...loan, monthsRemaining: 36 }] },
      goals: [home],
      emergencyBufferEur: 5_000,
    })
    const scenario = result.debtScenarios[0]
    expect(scenario?.chosen).toBe('cleared')
    expect(scenario?.cleared.netPosition).toBeCloseTo(result.position.total, 1)
    expect(result.liquidity.instantNetPosition).toBeCloseTo(result.position.total, 1)
    expect(result.position.line).toMatch(
      /with nothing still owed on the debts given \(the car loan cleared from savings in this plan\)/,
    )
  })
})

describe('keeping a debt is modelled by keeping it', () => {
  it('keeps it in the net position with `plan: "keep"`, and gives clearing as the what-if', () => {
    const result = plan({
      situation: { ...asked, debts: [{ ...loan, monthsRemaining: 36, plan: 'keep' }] },
      goals: [home],
      emergencyBufferEur: 6_000,
    })
    expect(result.debtScenarios[0]?.chosen).toBe('kept')
    expect(result.plan.debts[0]?.action).toBe('keep_paying')
    expect(result.position.owed).toBeGreaterThan(0)
    expect(result.position.line).toMatch(
      /net at November 2028, everything held less what is still owed/,
    )
    expect(result.position.line).toMatch(/less €[\d,]+ still owed on the car loan\.$/)
    expect(result.whatIf.lines.join(' ')).toMatch(
      /What if the car loan were cleared from the lump sum instead \(an alternative with its plan: "clear"\)/,
    )
    // The choice is an input, not part of the plan document.
    expect(JSON.stringify(result.plan.situation.debts)).not.toMatch(/"plan"/)
  })

  it('clears it with `plan: "clear"` even when the comparison would keep it', () => {
    const result = plan({
      situation: {
        ...asked,
        debts: [{ ...loan, ratePct: 0.5, monthsRemaining: 36, plan: 'clear' }],
      },
      goals: [home],
    })
    expect(result.debtScenarios[0]?.chosen).toBe('cleared')
    expect(result.plan.debts[0]?.action).toBe('pay_off_first')
  })

  it('with no repayment given, assumes an even repayment over the horizon and compares clearing with keeping', () => {
    const result = plan({ situation: asked, goals: [home], emergencyBufferEur: 5_000 })
    expect(result.assumedRepayments).toEqual([
      expect.objectContaining({ debtId: 'car-loan', balance: 9_000, months: 24 }),
    ])
    const assumed = result.assumedRepayments[0]
    // €9,000 at 9% APR repaid evenly over 24 months.
    expect(assumed?.monthlyRepayment).toBeGreaterThan(405)
    expect(assumed?.monthlyRepayment).toBeLessThan(415)
    expect(assumed?.note).toMatch(
      /^Assumed: the car loan’s €9,000 repaid evenly over 24 months .* with the actual repayment the figure is exact\.$/,
    )
    // Stated where it shows: the presentation (right after the position), the assumptions, `next`.
    const lead = result.presentation.indexOf(result.moneyFound.headline)
    expect(result.presentation[lead + 2]).toBe(assumed?.note)
    expect(result.plan.assumptions).toContain(assumed?.note)
    expect(result.next).toMatch(/assume an even repayment over 24 months/)
    expect(result.questions[0]).toMatch(/actual monthly repayment, or the months left/)
    // Both ways worked out, and the saving counted in money found.
    const scenario = result.debtScenarios[0]
    expect(scenario?.chosen).toBe('cleared')
    expect(scenario?.kept.debtAtHorizon).toBe(0)
    expect(result.position.owedIsCeiling).toBe(false)
    const part = result.moneyFound.parts.find((item) => item.kind === 'debt_interest')
    expect(part?.annualEur).toBe(
      Math.round(((scenario?.cleared.netPosition ?? 0) - (scenario?.kept.netPosition ?? 0)) / 2),
    )
    expect(result.moneyFound.headline).toMatch(/car loan cleared in this plan/)
    expect(result.presentation.join(' ')).toMatch(/repaid by then/)
    // What the customer said is kept as said: the plan's situation has no repayment invented.
    expect(result.plan.situation.debts[0]?.monthsRemaining).toBeUndefined()

    const cleared = plan({
      situation: { ...asked, debts: [{ ...loan, plan: 'clear' }] },
      goals: [home],
      emergencyBufferEur: 5_000,
    })
    expect(cleared.position.owed).toBe(0)
    expect(cleared.plan.debts[0]?.action).toBe('pay_off_first')
    expect(cleared.plan.combination.totals?.lumpSum).toBe(16_000)
  })

  it('with the repayment given, assumes nothing and works it out as before', () => {
    const given = plan({
      situation: { ...asked, debts: [{ ...loan, monthsRemaining: 36 }] },
      goals: [home],
      emergencyBufferEur: 5_000,
    })
    expect(given.assumedRepayments).toEqual([])
    expect(given.presentation.join(' ')).not.toMatch(/Assumed: the car loan/)
    expect(given.next).not.toMatch(/even repayment/)
    expect(given.questions.join(' ')).not.toMatch(/monthly repayment/)
    const scenario = given.debtScenarios[0]
    // 36 months left: still owed at month 24 if kept.
    expect(scenario?.kept.debtAtHorizon).toBeGreaterThan(3_000)
    const byRepayment = plan({
      situation: { ...asked, debts: [{ ...loan, monthlyRepayment: 286.19 }] },
      goals: [home],
      emergencyBufferEur: 5_000,
    })
    expect(byRepayment.assumedRepayments).toEqual([])
  })

  it('gives the money check the same figures as build_plan', () => {
    const body = { situation: asked, goals: [home], emergencyBufferEur: 5_000 }
    const direct = plan(body)
    const checked = check(body).plan
    expect(checked?.assumedRepayments).toEqual(direct.assumedRepayments)
    expect(checked?.debtScenarios).toEqual(direct.debtScenarios)
    expect(checked?.moneyFound).toEqual(direct.moneyFound)
    expect(check(body).presentation.join(' ')).toMatch(/Assumed: the car loan’s €9,000/)
  }, 20_000)

  it('never words a what-if like a scenario', () => {
    const result = plan({
      situation: { ...asked, debts: [{ ...loan, monthsRemaining: 36 }] },
      goals: [home],
      emergencyBufferEur: 5_000,
      minLockGainEur: 0,
      minLockGainPctPerYear: 0,
    })
    for (const line of result.whatIf.lines.filter((text) =>
      /€[\d,]+.*(in all|net|owed)/.test(text),
    )) {
      expect(line).toMatch(/^What if /)
    }
    const scenarioLine = result.presentation.find((line) =>
      line.startsWith('car loan, cleared or kept'),
    )
    expect(scenarioLine).toMatch(/The split below is worked out with it cleared\.$/)
  })
})

describe('either entry point gives the same answer', () => {
  it('build_plan carries the questions, and money_check presents the same for the same input', () => {
    const body = { situation: asked, goals: [home], emergencyBufferEur: 5_000 }
    const built = plan(body)
    const checked = check(body)
    expect(built.questions.length).toBeGreaterThan(0)
    expect(built.presentation.at(-1)).toMatch(/^Answer this one and the plan gets sharper: /)
    expect(checked.presentation).toEqual(built.presentation)
    expect(checked.questions).toEqual(built.questions)
    expect(checked.plan?.moneyFound.headline).toBe(built.moneyFound.headline)
  })
})
