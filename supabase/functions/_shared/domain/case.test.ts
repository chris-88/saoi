import { describe, expect, it } from 'vitest'
import { caseOutcome, caseStatus, type CaseOutcomeInput, type CaseStatusInput } from './case.ts'

const status = (over: Partial<CaseStatusInput> = {}): CaseStatusInput => ({
  everBlocked: false,
  applications: [],
  checkinDue: false,
  customerMessages: 3,
  ...over,
})

const outcome = (over: Partial<CaseOutcomeInput> = {}): CaseOutcomeInput => ({
  everBlocked: false,
  applications: [],
  plans: 0,
  goalsIdentified: 0,
  customerMessages: 3,
  ...over,
})

describe('case status', () => {
  it('reports blocked above everything else somebody could look at', () => {
    expect(
      caseStatus(status({ everBlocked: true, applications: [{ state: 'info_required' }] })),
    ).toBe('blocked')
  })

  it('wants review when an application is waiting on somebody', () => {
    expect(caseStatus(status({ applications: [{ state: 'waiting_partner' }] }))).toBe(
      'needs_review',
    )
    expect(caseStatus(status({ applications: [{ state: 'info_required' }] }))).toBe('needs_review')
  })

  it('wants review when a promised check-in has come due', () => {
    expect(caseStatus(status({ checkinDue: true }))).toBe('needs_review')
  })

  it('is completed only when every application is settled', () => {
    expect(caseStatus(status({ applications: [{ state: 'completed' }] }))).toBe('completed')
    expect(
      caseStatus(status({ applications: [{ state: 'completed' }, { state: 'in_progress' }] })),
    ).toBe('in_progress')
  })

  it('separates a case nobody spoke in from one in progress', () => {
    expect(caseStatus(status({ customerMessages: 0 }))).toBe('new')
    expect(caseStatus(status({ customerMessages: 1 }))).toBe('in_progress')
  })
})

describe('case outcome', () => {
  it('has none for a case nobody spoke in', () => {
    expect(caseOutcome(outcome({ customerMessages: 0 }))).toBeNull()
    // Even if something else happened to it, which it should not have.
    expect(caseOutcome(outcome({ customerMessages: 0, plans: 1 }))).toBeNull()
  })

  it('reports being turned away separately from how far it got', () => {
    expect(caseOutcome(outcome({ everBlocked: true, plans: 2 }))).toBe('blocked')
  })

  it('reports the furthest point reached', () => {
    const everything = { applications: [{ state: 'submitted' }], plans: 1, goalsIdentified: 4 }
    expect(caseOutcome(outcome(everything))).toBe('applied')
    expect(caseOutcome(outcome({ plans: 1, goalsIdentified: 4 }))).toBe('planned')
    expect(caseOutcome(outcome({ goalsIdentified: 4 }))).toBe('explored')
    expect(caseOutcome(outcome())).toBe('browsing')
  })

  it('does not count an application that never left the building', () => {
    expect(caseOutcome(outcome({ applications: [{ state: 'in_progress' }] }))).toBe('browsing')
    expect(caseOutcome(outcome({ applications: [{ state: 'ready' }] }))).toBe('browsing')
    expect(caseOutcome(outcome({ applications: [{ state: 'paused' }] }))).toBe('browsing')
  })

  it('counts every state the bank has actually seen as applied', () => {
    for (const state of [
      'submitted',
      'under_review',
      'info_required',
      'approved',
      'declined',
      'completed',
    ]) {
      expect(caseOutcome(outcome({ applications: [{ state }] })), state).toBe('applied')
    }
  })

  it('disagrees with status where they measure different things', () => {
    // Still being worked on, and has already produced something. Both are true.
    const input = { applications: [{ state: 'submitted' }], customerMessages: 5 }
    expect(caseStatus(status(input))).toBe('in_progress')
    expect(caseOutcome(outcome(input))).toBe('applied')
  })
})
