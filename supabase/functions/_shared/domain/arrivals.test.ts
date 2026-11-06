import { describe, expect, it } from 'vitest'
import {
  JOURNEY_STEPS,
  STALLS,
  cameBack,
  countJourney,
  countStalls,
  summariseFeedback,
  type Arrival,
} from './arrivals.ts'

const arrival = (over: Partial<Arrival> = {}): Arrival => ({
  eventTypes: new Set(),
  customerMessages: 0,
  cameBack: false,
  ...over,
})

describe('the journey after arriving', () => {
  it('names every step in the order a visit happens', () => {
    expect(JOURNEY_STEPS.map((step) => step.label)).toEqual([
      'Arrived',
      'Said something',
      'Kept a plan',
      'Started an application',
      'Submitted',
      'Signed in',
      'Came back',
      'Gave feedback',
    ])
  })

  it('counts every arrival at the first step and nobody further when nothing happened', () => {
    const counts = countJourney([arrival(), arrival(), arrival()])
    expect(counts[0]).toEqual({ step: 'arrived', label: 'Arrived', count: 3 })
    expect(counts.slice(1).every((step) => step.count === 0)).toBe(true)
  })

  it('counts a case once per step however many times it did the thing', () => {
    const busy = arrival({
      customerMessages: 12,
      eventTypes: new Set(['plan_created', 'application_created', 'application_created']),
    })
    const quiet = arrival({ customerMessages: 1 })
    const by = Object.fromEntries(countJourney([busy, quiet]).map((s) => [s.step, s.count]))
    expect(by).toEqual({
      arrived: 2,
      spoke: 2,
      kept_plan: 1,
      started_application: 1,
      submitted: 0,
      signed_in: 0,
      came_back: 0,
      gave_feedback: 0,
    })
  })

  it('reads submission, sign-in and feedback from their events', () => {
    const counts = countJourney([
      arrival({
        eventTypes: new Set(['application_submitted', 'customer_signed_in', 'feedback_given']),
        cameBack: true,
      }),
    ])
    const by = Object.fromEntries(counts.map((s) => [s.step, s.count]))
    expect(by['submitted']).toBe(1)
    expect(by['signed_in']).toBe(1)
    expect(by['came_back']).toBe(1)
    expect(by['gave_feedback']).toBe(1)
  })
})

describe('coming back', () => {
  it('is a message written after the first notification went', () => {
    expect(
      cameBack(['2026-10-22T10:00:00Z'], ['2026-10-22T09:00:00Z', '2026-10-22T11:00:00Z']),
    ).toBe(true)
  })

  it('is not a message written before it', () => {
    expect(cameBack(['2026-10-22T10:00:00Z'], ['2026-10-22T09:59:59Z'])).toBe(false)
  })

  it('needs a notification to come back from', () => {
    expect(cameBack([], ['2026-10-22T11:00:00Z'])).toBe(false)
  })
})

describe('stalls', () => {
  it('counts each detector in its fixed order, zeros included', () => {
    const counts = countStalls(['request_blocked', 'customer_repeated', 'request_blocked'])
    expect(counts.map((s) => s.type)).toEqual(STALLS.map((s) => s.type))
    expect(counts.find((s) => s.type === 'request_blocked')?.count).toBe(2)
    expect(counts.find((s) => s.type === 'customer_repeated')?.count).toBe(1)
    expect(counts.find((s) => s.type === 'card_promised_not_shown')?.count).toBe(0)
  })
})

describe('feedback summary', () => {
  it('keeps the thumbs and the ratings apart', () => {
    expect(
      summariseFeedback([
        { kind: 'turn', rating: 1 },
        { kind: 'turn', rating: 1 },
        { kind: 'turn', rating: -1 },
        { kind: 'session', rating: 4 },
        { kind: 'session', rating: 3 },
      ]),
    ).toEqual({ thumbsUp: 2, thumbsDown: 1, ratings: 2, averageRating: 3.5 })
  })

  it('rounds the average to one decimal', () => {
    expect(
      summariseFeedback([
        { kind: 'session', rating: 5 },
        { kind: 'session', rating: 4 },
        { kind: 'session', rating: 4 },
      ]).averageRating,
    ).toBe(4.3)
  })

  it('has no average when nobody has rated', () => {
    expect(summariseFeedback([{ kind: 'turn', rating: 1 }])).toEqual({
      thumbsUp: 1,
      thumbsDown: 0,
      ratings: 0,
      averageRating: null,
    })
  })
})
