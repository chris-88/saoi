import { describe, expect, it } from 'vitest'
import { insightsFor, type InsightInput } from './insights.ts'

const input = (over: Partial<InsightInput> = {}): InsightInput => ({
  conversations: 10,
  goals: 0,
  applications: 0,
  blocked: 0,
  outcomes: [],
  topGoals: [],
  funnel: [],
  ...over,
})

const ids = (over: Partial<InsightInput> = {}): string[] =>
  insightsFor(input(over)).map((insight) => insight.id)

describe('insights', () => {
  it('says nothing about an empty window', () => {
    expect(insightsFor(input({ conversations: 0, goals: 5, blocked: 3 }))).toEqual([])
  })

  it('reports what was turned away, and that it never reached a model', () => {
    const [first] = insightsFor(input({ blocked: 2 }))
    expect(first?.id).toBe('blocked')
    expect(first?.tone).toBe('watch')
    expect(first?.text).toContain('reached a model')
  })

  it('counts discovery as every outcome past browsing', () => {
    const [insight] = insightsFor(
      input({
        conversations: 10,
        outcomes: [
          { outcome: 'explored', count: 3 },
          { outcome: 'planned', count: 1 },
          { outcome: 'applied', count: 1 },
          { outcome: 'browsing', count: 5 },
        ],
      }),
    )

    expect(insight?.text).toContain('50%')
  })

  it('flags discovery without conversion, which is the gap worth seeing', () => {
    expect(ids({ goals: 7 })).toContain('no_applications')
    expect(ids({ goals: 7, applications: 2 })).not.toContain('no_applications')
  })

  it('does not claim a funnel drop when nothing has been submitted', () => {
    // Zero submitted is "none have got there", which `no_applications` already says.
    expect(
      ids({
        funnel: [
          { stage: 'started', count: 4 },
          { stage: 'submitted', count: 0 },
        ],
      }),
    ).not.toContain('funnel_drop')

    expect(
      ids({
        funnel: [
          { stage: 'started', count: 4 },
          { stage: 'submitted', count: 1 },
        ],
      }),
    ).toContain('funnel_drop')
  })

  it('only calls out breadth when there is genuinely more than one goal each', () => {
    expect(ids({ conversations: 10, goals: 19 })).not.toContain('breadth')
    expect(ids({ conversations: 10, goals: 20 })).toContain('breadth')
  })

  it('does not call a goal the most common when it happened once', () => {
    expect(ids({ goals: 1, topGoals: [{ name: 'Buy a car', count: 1 }] })).not.toContain('top_goal')
    expect(ids({ goals: 3, topGoals: [{ name: 'Buy a car', count: 2 }] })).toContain('top_goal')
  })

  it('never returns more than four', () => {
    const everything = insightsFor(
      input({
        conversations: 10,
        goals: 40,
        applications: 0,
        blocked: 5,
        outcomes: [{ outcome: 'explored', count: 8 }],
        topGoals: [{ name: 'Buy a first home', count: 6 }],
        funnel: [
          { stage: 'started', count: 4 },
          { stage: 'submitted', count: 1 },
        ],
      }),
    )

    expect(everything.length).toBeLessThanOrEqual(4)
  })

  it('puts what needs watching above what is merely true', () => {
    const result = insightsFor(input({ goals: 9, blocked: 1, topGoals: [{ name: 'X', count: 4 }] }))
    expect(result[0]?.id).toBe('blocked')
  })
})
