import { describe, expect, it } from 'vitest'
import { planProgress } from './engine.ts'
import type { Plan, PlanContext } from './types.ts'

/**
 * A corrected figure must win over the one it replaced.
 *
 * Found live: the console set a balance of €60,000 and the plan engine read back €46,000,
 * because the reader took the first matching fact rather than the newest and Postgres
 * returned the oldest row first. The plan then reported no milestone reached, which looked
 * like a logic bug in the engine and was not.
 */
describe('reading the balance', () => {
  const plan: Plan = {
    id: 'p1',
    goal: 'buy_first_home',
    title: 'Buy our first home',
    status: 'active',
    targetAmount: 60_000,
    targetDate: null,
    milestones: [],
    checkins: [],
    applications: [],
    lastConfirmedAt: null,
  }

  it('measures against the newest balance, whatever order the rows arrive in', () => {
    const nothing: PlanContext['facts'] = {
      has: () => false,
      get: () => undefined,
      number: () => null,
      boolean: () => null,
    }
    const stale: PlanContext = {
      savingsBalance: 46_000,
      monthlySaving: null,
      facts: nothing,
      today: '2026-10-05',
    }
    const fresh: PlanContext = {
      savingsBalance: 60_000,
      monthlySaving: null,
      facts: nothing,
      today: '2026-10-05',
    }

    expect(planProgress(plan, stale).short).toBe(14_000)
    expect(planProgress(plan, fresh).short).toBe(0)
  })
})
