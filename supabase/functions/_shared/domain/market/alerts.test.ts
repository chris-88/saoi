import { describe, expect, it } from 'vitest'
import { adviceWordsIn } from '../../market/disclosures.ts'
import {
  type ClaimedPlanRef,
  type ProductChange,
  daysUntil,
  dueReminders,
  headlineRate,
  rateChangeAlerts,
  reminderAlert,
  shortDate,
} from './alerts.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'

const CASE_A = '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11'
const CASE_B = '1b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c12'

const supersaver = {
  provider: 'boi',
  source: 'bank' as const,
  productId: 'savings.supersaver',
  providerName: 'Bank of Ireland',
  productName: 'SuperSaver',
  ratePct: 3,
}

const plans: ClaimedPlanRef[] = [
  { caseId: CASE_A, builtAt: '2026-11-01T10:00:00Z', products: [supersaver] },
  {
    caseId: CASE_B,
    builtAt: '2026-11-01T10:00:00Z',
    products: [{ ...supersaver, ratePct: undefined }],
  },
]

const change = (over: Partial<ProductChange> = {}): ProductChange => ({
  provider: 'boi',
  source: 'bank',
  productId: 'savings.supersaver',
  previousVersionId: 41,
  currentVersionId: 57,
  previousRate: 3,
  currentRate: 2.75,
  effectiveFrom: '2026-11-10',
  changedAt: '2026-11-11T07:00:00Z',
  sourceUrl: 'https://personalbanking.bankofireland.com/savings',
  checkedAt: '2026-11-11T07:00:00Z',
  withdrawn: false,
  ...over,
})

/** Pick and instruction words: none may appear in an alert. */
const NUDGE = /\b(switch|should|better|best|recommend\w*|move|open|consider)\b/i

describe('rate change alerts', () => {
  it('raises one alert per case for a rate that moved, with the date, source and plan rate', () => {
    const alerts = rateChangeAlerts(plans, [change()])
    expect(alerts).toHaveLength(2)
    expect(alerts[0]).toMatchObject({
      caseId: CASE_A,
      kind: 'rate_change',
      productId: 'savings.supersaver',
      productVersion: 57,
      title: 'A rate in your plan changed',
      body: 'Bank of Ireland SuperSaver: 3.00% to 2.75% from 10 Nov 2026 (bank’s site, read 11 Nov). Your plan counted 3.00%.',
    })
    expect(alerts[1]?.body).toBe(
      'Bank of Ireland SuperSaver: 3.00% to 2.75% from 10 Nov 2026 (bank’s site, read 11 Nov). Your plan did not state a rate for it.',
    )
  })

  it('says when a product is no longer offered', () => {
    const [alert] = rateChangeAlerts(plans.slice(0, 1), [
      change({ currentVersionId: null, currentRate: null, withdrawn: true }),
    ])
    expect(alert).toMatchObject({
      kind: 'product_withdrawn',
      productVersion: 41,
      body: 'Bank of Ireland SuperSaver is no longer offered as of 11 Nov 2026 (bank’s site, read 11 Nov); your plan counted 3.00%.',
    })
  })

  it('raises nothing when only the wording moved, the change predates the plan, or the source differs', () => {
    expect(rateChangeAlerts(plans, [change({ currentRate: 3 })])).toEqual([])
    expect(rateChangeAlerts(plans, [change({ changedAt: '2026-10-01T00:00:00Z' })])).toEqual([])
    expect(rateChangeAlerts(plans, [change({ source: 'ccpc' })])).toEqual([])
  })

  it('raises one alert for a version even when the plan lists the product twice', () => {
    const twice: ClaimedPlanRef[] = [
      { ...plans[0]!, products: [supersaver, { ...supersaver, ratePct: 2.9 }] },
    ]
    expect(rateChangeAlerts(twice, [change()])).toHaveLength(1)
  })

  it('reads the headline rate of every kind', () => {
    expect(
      headlineRate({
        kind: 'deposit',
        aerPct: null,
        basis: 'fixed',
        terms: [
          { months: 12, aerPct: 2 },
          { months: 24, aerPct: 2.5 },
        ],
      }),
    ).toBe(2.5)
    expect(headlineRate({ kind: 'deposit', aerPct: 3, basis: 'variable' })).toBe(3)
  })
})

describe('reminders', () => {
  const reminder = (dueOn: string) => ({
    id: '9f8b0c7e-0000-4000-8000-000000000001',
    caseId: CASE_A,
    kind: 'fixed_rate_ends' as const,
    label: 'AIB fixed rate',
    dueOn,
  })
  const never = () => false

  it('counts days between dates', () => {
    expect(daysUntil('2026-12-31', '2027-03-01')).toBe(60)
    expect(shortDate('2027-03-01')).toBe('1 Mar 2027')
  })

  it('is due at each stage once, and at the latest stage reached', () => {
    const today = '2026-12-31'
    expect(dueReminders([reminder('2027-03-31')], today, never)).toMatchObject([
      { stage: 90, daysLeft: 90 },
    ])
    expect(dueReminders([reminder('2027-03-01')], today, never)).toMatchObject([
      { stage: 60, daysLeft: 60 },
    ])
    expect(dueReminders([reminder('2027-01-20')], today, never)).toMatchObject([
      { stage: 30, daysLeft: 20 },
    ])
    expect(dueReminders([reminder('2026-12-31')], today, never)).toMatchObject([
      { stage: 0, daysLeft: 0 },
    ])
    expect(dueReminders([reminder('2027-03-01')], today, (_, stage) => stage === 60)).toEqual([])
    expect(dueReminders([reminder('2026-12-30')], today, never)).toEqual([])
    expect(dueReminders([reminder('2027-06-30')], today, never)).toEqual([])
  })

  it('puts the date and today’s market beside it, with no loan figure', () => {
    const market = normaliseMarket(MARKET_FIXTURE)
    const fixed = reminderAlert(reminder('2027-03-01'), 60, 60, market)
    expect(fixed.title).toBe('Your fixed rate ends in 60 days')
    expect(fixed.body).toMatch(
      /^On 1 Mar 2027, as you told Saoirse\. Today \d+ lenders list fixed mortgage rates from \d+\.\d{2}% to \d+\.\d{2}%\.$/,
    )
    const deposit = reminderAlert(
      { ...reminder('2027-03-01'), kind: 'deposit_matures' },
      60,
      60,
      market,
    )
    expect(deposit.title).toBe('Your deposit matures in 60 days')
    expect(deposit.body).toMatch(
      /^On 1 Mar 2027, as you told Saoirse\. Today \d+ fixed-term deposit accounts are listed, with rates up to \d+\.\d{2}%\.$/,
    )
    const other = reminderAlert(
      { ...reminder('2027-03-01'), kind: 'other', label: 'Car insurance' },
      0,
      0,
      null,
    )
    expect(other).toMatchObject({
      title: 'Car insurance: today',
      body: 'On 1 Mar 2027, as you told Saoirse.',
    })
  })
})

describe('every alert is a fact', () => {
  it('has no pick or instruction words in any title or body', () => {
    const market = normaliseMarket(MARKET_FIXTURE)
    const all = [
      ...rateChangeAlerts(plans, [change(), change({ productId: 'x', withdrawn: true })]),
      ...rateChangeAlerts(plans, [
        change({ currentVersionId: null, currentRate: null, withdrawn: true }),
      ]),
      ...(['fixed_rate_ends', 'deposit_matures', 'other'] as const).map((kind) =>
        reminderAlert(
          { id: 'r', caseId: CASE_A, kind, label: 'Car insurance', dueOn: '2027-03-01' },
          7,
          7,
          market,
        ),
      ),
    ]
    expect(all.length).toBeGreaterThan(4)
    for (const alert of all) {
      const text = `${alert.title} ${alert.body}`
      expect(text, text).not.toMatch(NUDGE)
      expect(adviceWordsIn(text)).toEqual([])
    }
  })
})
