import { describe, expect, it } from 'vitest'
import { asApplicationId, asFactId, asParticipantId, type Fact, type FactKey } from './facts.ts'
import type { Requirement } from './journey.ts'
import type { JourneyEvaluation, SatisfiedItem } from './requirements.ts'
import { questionsAvoided, reuseByFactKey, uniqueFactsCollected } from './metrics.ts'

const PRIMARY = asParticipantId('p-1')

let n = 0
const fact = (key: FactKey, value: unknown, supersededBy: string | null = null): Fact => {
  n += 1
  return {
    id: asFactId(`f-${n}`),
    key,
    subject: PRIMARY,
    value,
    source: 'customer_stated',
    verified: false,
    capturedFor: null,
    supersededBy: supersededBy ? asFactId(supersededBy) : null,
    capturedAt: '2026-09-30T10:00:00.000Z',
  }
}

const requirement = (id: string, key: FactKey): Requirement => ({
  kind: 'fact',
  id,
  fact: key,
  subject: 'primary',
  label: id,
})

const satisfied = (id: string, key: FactKey, reused: boolean): SatisfiedItem => ({
  requirement: requirement(id, key),
  fact: fact(key, 'value'),
  reused,
})

const evaluation = (items: SatisfiedItem[]): JourneyEvaluation => ({
  outstanding: [],
  satisfied: items,
  complete: true,
  waitingOn: null,
  activeBranches: [],
})

/** §53 — questions avoided through shared context. */
describe('questionsAvoided()', () => {
  it('counts a requirement satisfied without asking in that application', () => {
    const total = questionsAvoided([
      {
        applicationId: asApplicationId('app-1'),
        evaluation: evaluation([satisfied('address', 'identity.address', false)]),
      },
      {
        applicationId: asApplicationId('app-2'),
        evaluation: evaluation([satisfied('address', 'identity.address', true)]),
      },
    ])

    expect(total).toBe(1)
  })

  it('reproduces the worked example from §53: asked once, reused four times', () => {
    const applications = ['app-1', 'app-2', 'app-3', 'app-4', 'app-5'].map((id, index) => ({
      applicationId: asApplicationId(id),
      evaluation: evaluation([satisfied('address', 'identity.address', index > 0)]),
    }))

    expect(questionsAvoided(applications)).toBe(4)
  })

  it('is zero when nothing has been reused', () => {
    expect(
      questionsAvoided([
        {
          applicationId: asApplicationId('app-1'),
          evaluation: evaluation([satisfied('address', 'identity.address', false)]),
        },
      ]),
    ).toBe(0)
  })

  it('is zero for an empty case', () => {
    expect(questionsAvoided([])).toBe(0)
  })

  it('ignores requirements that are still outstanding', () => {
    expect(
      questionsAvoided([
        {
          applicationId: asApplicationId('app-1'),
          evaluation: {
            outstanding: [
              {
                requirement: requirement('income', 'income.annualBasic'),
                reason: 'missing',
                waitingOn: 'primary',
                blocking: true,
                knownFact: null,
              },
            ],
            satisfied: [],
            complete: false,
            waitingOn: 'primary',
            activeBranches: [],
          },
        },
      ]),
    ).toBe(0)
  })
})

describe('reuseByFactKey()', () => {
  it('shows which facts did the most work', () => {
    const breakdown = reuseByFactKey([
      {
        applicationId: asApplicationId('app-1'),
        evaluation: evaluation([
          satisfied('address', 'identity.address', true),
          satisfied('income', 'income.annualBasic', true),
        ]),
      },
      {
        applicationId: asApplicationId('app-2'),
        evaluation: evaluation([satisfied('address', 'identity.address', true)]),
      },
    ])

    expect(breakdown).toEqual([
      { key: 'identity.address', label: 'Home address', timesReused: 2 },
      { key: 'income.annualBasic', label: 'Annual basic salary', timesReused: 1 },
    ])
  })

  it('is empty when nothing was reused', () => {
    expect(
      reuseByFactKey([
        {
          applicationId: asApplicationId('app-1'),
          evaluation: evaluation([satisfied('address', 'identity.address', false)]),
        },
      ]),
    ).toEqual([])
  })
})

describe('uniqueFactsCollected()', () => {
  it('counts distinct key and subject pairs', () => {
    expect(
      uniqueFactsCollected([fact('identity.address', 'a'), fact('income.annualBasic', 92_000)]),
    ).toBe(2)
  })

  it('does not double-count a fact that was later corrected', () => {
    const facts = [
      fact('income.annualBasic', 80_000, 'f-superseder'),
      fact('income.annualBasic', 92_000),
    ]

    expect(uniqueFactsCollected(facts)).toBe(1)
  })
})
