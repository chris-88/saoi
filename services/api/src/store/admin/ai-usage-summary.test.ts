import { describe, expect, it } from 'vitest'
import {
  type CallRow,
  type PlanOutcome,
  callSeries,
  countCalls,
  cursorOf,
  funnelByHost,
  gateMissingTally,
  median,
  otherUserAgents,
  parseCursor,
  toolTable,
} from './ai-usage-summary.ts'

let n = 0
const call = (over: Partial<CallRow> = {}): CallRow => {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    calledAt: '2026-11-13T10:00:00.000Z',
    host: 'claude',
    name: 'saoi_money_check',
    outcome: 'ok',
    ms: 100,
    card: false,
    sessionKey: null,
    userAgent: null,
    gateMissing: [],
    planSaved: false,
    linkOpenedAt: null,
    savedPlanId: null,
    ...over,
  }
}

const PLAN = (id: string) => `10000000-0000-4000-8000-${id.padStart(12, '0')}`

describe('the AI usage funnel', () => {
  // Claude: four calls. One card; three plans held; two links opened (one swept since, known
  // only from the call); two claimed; one of them signed in and chose a product. ChatGPT: one
  // call whose plan was claimed into a probe case, which is not counted.
  const rows: CallRow[] = [
    call({ sessionKey: 's1', card: true, planSaved: true, savedPlanId: PLAN('1') }),
    call({ sessionKey: 's1', planSaved: true, savedPlanId: PLAN('2') }),
    call({ sessionKey: 's2', planSaved: true, linkOpenedAt: '2026-11-13T11:00:00Z' }),
    call({ sessionKey: 's2', name: 'saoi_home_calculator', outcome: 'gated' }),
    call({ host: 'chatgpt', sessionKey: 's3', planSaved: true, savedPlanId: PLAN('3') }),
  ]
  const plans = new Map<string, PlanOutcome>([
    [PLAN('1'), { opened: true, claimed: true, signedIn: true, chosen: true }],
    [PLAN('2'), { opened: false, claimed: true, signedIn: false, chosen: false }],
    // Claimed into a probe case: the store reports it as not claimed.
    [PLAN('3'), { opened: true, claimed: false, signedIn: false, chosen: false }],
  ])

  it('counts each call through the steps it reached, sessions once', () => {
    expect(countCalls(rows, plans)).toEqual({
      calls: 5,
      sessions: 3,
      cardsShown: 1,
      plansSaved: 4,
      // PLAN 1 and 3 opened, and the swept one known from the call.
      linksOpened: 3,
      claimed: 2,
      signedIn: 1,
      chosen: 1,
    })
  })

  it('splits the funnel by assistant, in the host map’s order, steps in order', () => {
    const funnel = funnelByHost(rows, plans)
    expect(funnel.map((entry) => entry.host)).toEqual(['claude', 'chatgpt'])
    expect(funnel[0]?.steps.map((step) => [step.step, step.count])).toEqual([
      ['calls', 4],
      ['cardsShown', 1],
      ['plansSaved', 3],
      ['linksOpened', 2],
      ['claimed', 2],
      ['signedIn', 1],
      ['chosen', 1],
    ])
    expect(funnel[1]?.steps.map((step) => step.count)).toEqual([1, 0, 1, 1, 0, 0, 0])
  })

  it('never counts a sign-in or a choice without the claim', () => {
    const odd = new Map<string, PlanOutcome>([
      [PLAN('1'), { opened: true, claimed: false, signedIn: true, chosen: true }],
    ])
    const counts = countCalls([call({ savedPlanId: PLAN('1') })], odd)
    expect(counts).toMatchObject({ plansSaved: 1, claimed: 0, signedIn: 0, chosen: 0 })
  })

  it('is all zero with no calls', () => {
    expect(countCalls([], new Map())).toMatchObject({ calls: 0, sessions: 0, chosen: 0 })
    expect(funnelByHost([], new Map())).toEqual([])
  })
})

describe('calls a day', () => {
  it('fills every day of the window for each assistant that called', () => {
    const series = callSeries(
      [
        call({ calledAt: '2026-11-12T09:00:00Z' }),
        call({ calledAt: '2026-11-12T23:00:00Z' }),
        call({ host: 'gemini', calledAt: '2026-11-13T01:00:00Z' }),
      ],
      new Date('2026-11-11T15:00:00Z'),
      new Date('2026-11-13T15:00:00Z'),
    )
    expect(series).toEqual([
      { day: '2026-11-11', host: 'claude', calls: 0 },
      { day: '2026-11-11', host: 'gemini', calls: 0 },
      { day: '2026-11-12', host: 'claude', calls: 2 },
      { day: '2026-11-12', host: 'gemini', calls: 0 },
      { day: '2026-11-13', host: 'claude', calls: 0 },
      { day: '2026-11-13', host: 'gemini', calls: 1 },
    ])
  })
})

describe('the tools table', () => {
  it('counts calls, errors and gated per tool with the median time, most called first', () => {
    const table = toolTable([
      call({ name: 'saoi_home_calculator', outcome: 'gated', ms: 300 }),
      call({ name: 'saoi_home_calculator', ms: 100 }),
      call({ name: 'saoi_home_calculator', outcome: 'error', ms: 200 }),
      call({ name: 'saoi_product', ms: 50 }),
    ])
    expect(table).toEqual([
      { name: 'saoi_home_calculator', calls: 3, errors: 1, gated: 1, medianMs: 200 },
      { name: 'saoi_product', calls: 1, errors: 0, gated: 0, medianMs: 50 },
    ])
  })

  it('takes the median of an even count as the mean of the middle two', () => {
    expect(median([10, 40, 20, 30])).toBe(25)
    expect(median([])).toBeNull()
  })
})

describe('what the gate held back and the unknown user agents', () => {
  it('tallies the missing figures, most often first', () => {
    expect(
      gateMissingTally([
        call({ gateMissing: ['income', 'monthlySaving'] }),
        call({ gateMissing: ['income'] }),
      ]),
    ).toEqual([
      { figure: 'income', count: 2 },
      { figure: 'monthlySaving', count: 1 },
    ])
  })

  it('lists the raw user agents behind other only', () => {
    expect(
      otherUserAgents([
        call({ host: 'other', userAgent: 'node' }),
        call({ host: 'other', userAgent: 'node' }),
        call({ host: 'other' }),
        call({ host: 'claude', userAgent: 'Claude-User' }),
      ]),
    ).toEqual([
      { userAgent: 'node', count: 2 },
      { userAgent: '(none sent)', count: 1 },
    ])
  })
})

describe('the recent-calls cursor', () => {
  it('round-trips and refuses anything it did not make', () => {
    const at = { calledAt: '2026-11-13T10:00:00.123456+00:00', id: PLAN('9') }
    expect(parseCursor(cursorOf(at))).toEqual(at)
    expect(parseCursor('bad')).toBeNull()
    expect(parseCursor(Buffer.from('2026-11-13|nope').toString('base64url'))).toBeNull()
  })
})
