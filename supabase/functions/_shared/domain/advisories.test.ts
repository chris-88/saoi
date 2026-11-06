import { describe, expect, it } from 'vitest'
import { asApplicationId } from './facts.ts'
import type { Product } from './journey.ts'
import type { Application, ApplicationState } from './state-machine.ts'
import { evaluateAdvisories } from './advisories.ts'

const app = (product: Product, state: ApplicationState): Application => ({
  id: asApplicationId(`app-${product}`),
  product,
  state,
  resumeTo: null,
})

/**
 * §6 Stage 8 — the loan-versus-mortgage advisory. Deterministic, not model judgement
 * (CLAUDE.md > Advisories).
 */
describe('loan_vs_mortgage', () => {
  it('fires when a personal loan is progressing alongside an active mortgage', () => {
    const advisories = evaluateAdvisories([
      app('mortgage', 'in_progress'),
      app('personal_loan', 'in_progress'),
    ])

    expect(advisories).toHaveLength(1)
    expect(advisories[0]?.id).toBe('loan_vs_mortgage')
    expect(advisories[0]?.appliesTo).toBe(asApplicationId('app-personal_loan'))
    expect(advisories[0]?.actions).toEqual(['pause', 'continue'])
  })

  it('still fires when the mortgage is already with the bank', () => {
    for (const state of ['submitted', 'under_review', 'info_required'] as const) {
      const advisories = evaluateAdvisories([app('mortgage', state), app('personal_loan', 'ready')])
      expect(advisories, `mortgage ${state}`).toHaveLength(1)
    }
  })

  it('does not fire once the loan is paused', () => {
    expect(
      evaluateAdvisories([app('mortgage', 'in_progress'), app('personal_loan', 'paused')]),
    ).toEqual([])
  })

  it('does not fire once the loan has been submitted: the moment to advise has passed', () => {
    for (const state of ['submitted', 'under_review', 'approved', 'declined'] as const) {
      expect(
        evaluateAdvisories([app('mortgage', 'in_progress'), app('personal_loan', state)]),
        `loan ${state}`,
      ).toEqual([])
    }
  })

  it('does not fire without a mortgage', () => {
    expect(evaluateAdvisories([app('personal_loan', 'in_progress')])).toEqual([])
  })

  it('does not fire when the mortgage is finished or was never started', () => {
    for (const state of ['not_started', 'declined', 'completed', 'paused'] as const) {
      expect(
        evaluateAdvisories([app('mortgage', state), app('personal_loan', 'in_progress')]),
        `mortgage ${state}`,
      ).toEqual([])
    }
  })

  it('carries the explanation as fixed content, not something for the model to invent', () => {
    const advisory = evaluateAdvisories([
      app('mortgage', 'in_progress'),
      app('personal_loan', 'in_progress'),
    ])[0]

    expect(advisory?.explanation).toMatch(/mortgage/i)
    expect(advisory?.explanation.length).toBeGreaterThan(40)
  })
})
