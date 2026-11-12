import {
  PLAN_ACCESS_KINDS,
  PLAN_HOME_SORTS,
  PLAN_PROPERTY_KINDS,
  PLAN_PRODUCT_CATEGORIES,
  PLAN_PRODUCT_SOURCES,
  PLAN_ROUTE_IDS,
  PLAN_ROUTE_STATUSES,
  marketPlanSchema,
  upgradeStoredPlan,
} from './market-plan.ts'
import { exampleMarketPlan } from './market-plan.example.ts'
import { claimPlanBodySchema } from './session.ts'
import {
  ACCESS_KINDS,
  DEBT_PLAN_CHOICES,
  HOME_ROUTE_IDS,
  HOME_ROUTE_STATUSES,
  HOME_SORTS,
  PROPERTY_KINDS,
} from './market-tools.ts'
import { MARKET_CATEGORIES, MARKET_SOURCES } from '../market/schema.ts'
import { describe, expect, it } from 'vitest'
import { awaitsCustomer, CARD_TYPES, cardSchema } from './cards.ts'
import { ERROR_CODES, fail, ok, statusFor } from './common.ts'
import { parseStreamEvent, streamEventSchema, toSseFrame, withdraw } from './stream.ts'
import { saoirseTurnRequestSchema } from './saoirse-turn.ts'

describe('the result envelope', () => {
  it('discriminates success from failure', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } })
    expect(fail('bad_request', 'nope').ok).toBe(false)
  })

  it('maps every error code to a status, exhaustively', () => {
    for (const code of ERROR_CODES) {
      const status = statusFor(code)
      expect(status, code).toBeGreaterThanOrEqual(400)
      expect(status, code).toBeLessThan(600)
    }
  })

  it('answers a paused demo with 503, not an error the customer reads as a fault', () => {
    expect(statusFor('demo_paused')).toBe(503)
  })
})

describe('stream events', () => {
  it('round-trips through an SSE frame', () => {
    const event = { type: 'text_delta', text: 'Hello' } as const
    const frame = toSseFrame(event)

    expect(frame.startsWith('data: ')).toBe(true)
    expect(frame.endsWith('\n\n')).toBe(true)
    expect(parseStreamEvent(frame.slice(6).trim())).toEqual(event)
  })

  it('returns null rather than throwing on a malformed frame', () => {
    expect(parseStreamEvent('not json')).toBeNull()
    expect(parseStreamEvent('{"type":"nonsense"}')).toBeNull()
    expect(parseStreamEvent('{}')).toBeNull()
  })

  it('covers exactly the event types every consumer switches on', () => {
    const types = streamEventSchema.options.map((option) => option.shape.type.value)
    expect([...types].sort()).toEqual(['card', 'done', 'error', 'retract', 'status', 'text_delta'])
  })

  it('carries a retract as a count of characters, never a zero', () => {
    expect(parseStreamEvent('{"type":"retract","length":14}')).toEqual({
      type: 'retract',
      length: 14,
    })
    expect(parseStreamEvent('{"type":"retract","length":0}')).toBeNull()
    expect(parseStreamEvent('{"type":"retract","length":1.5}')).toBeNull()
  })

  /**
   * The function trims what it persists and the browser trims what it shows with this one
   * function, so the record and the screen cannot disagree about where the withdrawal ended.
   */
  it('withdraws from the end, and never past the start', () => {
    expect(withdraw('Right.\n\nI will put it up.', '\n\nI will put it up.'.length)).toBe('Right.')
    expect(withdraw('Hello', 50)).toBe('')
    expect(withdraw('Hello', 0)).toBe('Hello')
  })
})

describe('cards', () => {
  it('covers every card type the tools can ask for', () => {
    const types = cardSchema.options.map((option) => option.shape.type.value)
    expect([...types].sort()).toEqual([...CARD_TYPES].sort())
  })

  it('carries the state label alongside the state, so colour is never the only signal', () => {
    const parsed = cardSchema.safeParse({
      type: 'status',
      applications: [
        {
          id: '3f8b0c7e-0000-4000-8000-000000000001',
          product: 'mortgage',
          displayName: 'Mortgage',
          state: 'under_review',
          stateLabel: 'Being assessed',
          outstandingCount: 0,
          waitingOn: null,
          steps: [{ label: 'Proof of address', done: true, waitingOnPartner: false }],
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a state the machine does not have', () => {
    const parsed = cardSchema.safeParse({
      type: 'status',
      applications: [
        {
          id: '3f8b0c7e-0000-4000-8000-000000000001',
          product: 'mortgage',
          displayName: 'Mortgage',
          state: 'nearly_done',
          stateLabel: 'Nearly done',
          outstandingCount: 0,
          waitingOn: null,
          steps: [{ label: 'Proof of address', done: true, waitingOnPartner: false }],
        },
      ],
    })
    expect(parsed.success).toBe(false)
  })

  it('carries the opened account as something to read, never something to tap', () => {
    const parsed = cardSchema.safeParse({
      type: 'account_opened',
      applicationId: '3f8b0c7e-0000-4000-8000-000000000001',
      displayName: 'Current account',
      iban: 'IE29 SAOI 0000 0000 0000 01',
      bic: 'SAOIIE2D',
      cardTo: '14 Example Road, Dublin 8',
      next: [
        'Give your employer this IBAN for your salary',
        'Your debit card is on its way, and online banking and the app are ready',
      ],
    })
    expect(parsed.success).toBe(true)
    expect(awaitsCustomer('account_opened')).toBe(false)
  })

  it('refuses an opened account with nothing to do next, or with too much', () => {
    const welcome = {
      type: 'account_opened',
      applicationId: '3f8b0c7e-0000-4000-8000-000000000001',
      displayName: 'Current account',
      iban: 'IE29 SAOI 0000 0000 0000 01',
      bic: 'SAOIIE2D',
      cardTo: null,
    }
    expect(cardSchema.safeParse({ ...welcome, next: [] }).success).toBe(false)
    expect(cardSchema.safeParse({ ...welcome, next: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(
      false,
    )
    expect(cardSchema.safeParse({ ...welcome, next: ['a'] }).success).toBe(true)
  })
})

describe('the saoirse-turn request', () => {
  it('defaults the trigger to a customer message', () => {
    const parsed = saoirseTurnRequestSchema.parse({
      caseId: '3f8b0c7e-0000-4000-8000-000000000001',
    })
    expect(parsed.trigger).toBe('message')
  })

  it('refuses a message longer than the gate would accept', () => {
    const parsed = saoirseTurnRequestSchema.safeParse({
      caseId: '3f8b0c7e-0000-4000-8000-000000000001',
      message: 'a'.repeat(5_000),
    })
    expect(parsed.success).toBe(false)
  })

  it('allows a turn with no message, for the opening and for a return', () => {
    for (const trigger of ['opening', 'return'] as const) {
      const parsed = saoirseTurnRequestSchema.safeParse({
        caseId: '3f8b0c7e-0000-4000-8000-000000000001',
        trigger,
      })
      expect(parsed.success, trigger).toBe(true)
    }
  })
})

describe('the market plan (market-plan.ts)', () => {
  it('accepts the worked example', () => {
    expect(marketPlanSchema.safeParse(exampleMarketPlan()).success).toBe(true)
  })

  it('keeps its source and category lists equal to the market schema it repeats', () => {
    expect([...PLAN_PRODUCT_SOURCES]).toEqual([...MARKET_SOURCES])
    expect([...PLAN_PRODUCT_CATEGORIES]).toEqual([...MARKET_CATEGORIES])
  })

  it('keeps its route lists equal to the home calculator’s it repeats', () => {
    expect([...PLAN_ROUTE_IDS]).toEqual([...HOME_ROUTE_IDS])
    expect([...PLAN_ROUTE_STATUSES]).toEqual([...HOME_ROUTE_STATUSES])
  })

  it('keeps the build inputs’ lists equal to the build-plan request’s it repeats', () => {
    expect([...PLAN_ACCESS_KINDS]).toEqual([...ACCESS_KINDS])
    expect([...PLAN_PROPERTY_KINDS]).toEqual([...PROPERTY_KINDS])
    expect([...PLAN_HOME_SORTS]).toEqual([...HOME_SORTS])
    expect([...DEBT_PLAN_CHOICES].sort()).toEqual(['clear', 'compare', 'keep'])
  })

  it('strips fields it does not know rather than refusing the plan', () => {
    const parsed = marketPlanSchema.parse({ ...exampleMarketPlan(), engineVersion: '2.1' })
    expect('engineVersion' in parsed).toBe(false)
  })

  it('refuses a version it does not read', () => {
    expect(marketPlanSchema.safeParse({ ...exampleMarketPlan(), version: 2 }).success).toBe(false)
  })

  it('refuses a product pointing at a goal the plan does not have', () => {
    const plan = exampleMarketPlan()
    const first = plan.combination.products[0]
    if (first === undefined) throw new Error('no product')
    const broken = {
      ...plan,
      combination: { products: [{ ...first, goalIds: ['pension'] }] },
    }
    const result = marketPlanSchema.safeParse(broken)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('no goal with id pension')
  })

  it('refuses a payoff step for a debt the situation does not list', () => {
    const plan = exampleMarketPlan()
    const result = marketPlanSchema.safeParse({
      ...plan,
      debts: [{ debtId: 'mortgage', action: 'overpay', why: 'Because.' }],
    })
    expect(result.success).toBe(false)
  })

  it('refuses a plan with no goals, and a link that is not https', () => {
    expect(marketPlanSchema.safeParse({ ...exampleMarketPlan(), goals: [] }).success).toBe(false)
    const plan = exampleMarketPlan()
    const first = plan.combination.products[0]
    if (first === undefined) throw new Error('no product')
    expect(
      marketPlanSchema.safeParse({
        ...plan,
        combination: { products: [{ ...first, url: 'javascript:alert(1)' }] },
      }).success,
    ).toBe(false)
  })

  it('reads a claim token only in the shape the route issues', () => {
    expect(claimPlanBodySchema.safeParse({ token: 'A'.repeat(22) }).success).toBe(true)
    expect(claimPlanBodySchema.safeParse({ token: 'A'.repeat(21) }).success).toBe(false)
    expect(claimPlanBodySchema.safeParse({ token: `${'A'.repeat(21)}/` }).success).toBe(false)
  })
})

describe('a plan stored before 2026-11-10', () => {
  it('reads `recommendation` as `combination`, and leaves a current plan as it is', () => {
    const { combination, ...rest } = exampleMarketPlan()
    const old = { ...rest, recommendation: combination }
    expect(marketPlanSchema.safeParse(old).success).toBe(false)
    const upgraded = marketPlanSchema.parse(upgradeStoredPlan(old))
    expect(upgraded.combination).toEqual(combination)
    const current = exampleMarketPlan()
    expect(upgradeStoredPlan(current)).toBe(current)
  })
})
