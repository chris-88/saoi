import { describe, expect, it } from 'vitest'
import { asParticipantId, factCatalogue, type FactKey, type FactSubject } from './facts.ts'
import { countReusedFacts, describeReused, formatFactValue, type ReuseEvent } from './reuse.ts'

const fact = (key: string, value: unknown, source = 'bank_held') =>
  ({ key, value, source, supersededBy: null }) as never

describe('what the customer was never asked', () => {
  /** The canonical case starting a mortgage and a joint account: three bank-held facts, reused. */
  it('turns the events into one row per fact, naming every application it served', () => {
    const events: ReuseEvent[] = [
      { key: 'income.annualBasic', source: 'bank_held', applicationName: 'Mortgage' },
      { key: 'identity.address', source: 'bank_held', applicationName: 'Mortgage' },
      { key: 'income.annualBasic', source: 'bank_held', applicationName: 'Joint account' },
      { key: 'identity.address', source: 'bank_held', applicationName: 'Joint account' },
      { key: 'housing.firstTimeBuyer', source: 'customer_stated', applicationName: 'Mortgage' },
    ]
    const facts = [
      fact('income.annualBasic', 92_000),
      fact('identity.address', '14 Seapoint Terrace, Dublin 8'),
      fact('housing.firstTimeBuyer', true, 'customer_stated'),
    ]

    const rows = describeReused(events, facts)

    expect(rows.map((row) => row.key)).toEqual([
      'income.annualBasic',
      'identity.address',
      'housing.firstTimeBuyer',
    ])
    expect(rows[0]).toMatchObject({
      label: factCatalogue['income.annualBasic'].label,
      value: '€92,000',
      provenance: 'the bank already had it',
      usedFor: ['Mortgage', 'Joint account'],
    })
    expect(rows[2]).toMatchObject({
      value: 'Yes',
      provenance: 'you told me earlier',
      usedFor: ['Mortgage'],
    })
  })

  /** The value comes from the facts table now, not from the event. */
  it('reads the live value, and the live provenance', () => {
    const rows = describeReused(
      [{ key: 'income.annualBasic', source: 'customer_stated', applicationName: 'Mortgage' }],
      [fact('income.annualBasic', 95_000, 'document_verified')],
    )
    expect(rows[0]).toMatchObject({ value: '€95,000', source: 'document_verified' })
  })

  it('leaves out an event with no fact behind it, and one with no key', () => {
    const rows = describeReused(
      [
        { key: null, source: null, applicationName: 'Mortgage' },
        { key: 'income.annualBasic', source: 'bank_held', applicationName: 'Mortgage' },
        { key: 'not.a.key', source: 'bank_held', applicationName: 'Mortgage' },
      ],
      [],
    )
    expect(rows).toEqual([])
  })
})

describe('printing a value', () => {
  it('shows money as money and a count as a count', () => {
    expect(formatFactValue('income.annualBasic', 92_000)).toBe('€92,000')
    expect(formatFactValue('assets.savingsBalance', 32_000)).toBe('€32,000')
    expect(formatFactValue('household.dependantCount', 1)).toBe('1')
  })

  /** A phone mirrored on a big screen does not need to show the room a PPS number. */
  it('masks a PPS number to its last two characters', () => {
    expect(formatFactValue('identity.ppsn', '9000417T')).toBe('••••••7T')
  })

  it('says yes and no rather than true and false', () => {
    expect(formatFactValue('housing.firstTimeBuyer', true)).toBe('Yes')
    expect(formatFactValue('lifeEvent.newChild', false)).toBe('No')
  })
})

describe('counting what was carried over', () => {
  const PRIMARY = asParticipantId('11111111-1111-4111-8111-111111111111')
  const PARTNER = asParticipantId('22222222-2222-4222-8222-222222222222')

  const carried = (key: FactKey, subject: FactSubject) => ({ reused: true, fact: { key, subject } })

  /** Three savings accounts started together, each reusing the same name and address: two things, not six. */
  it('counts a fact once however many applications it served', () => {
    const perApplication = [
      carried('identity.fullName', PRIMARY),
      carried('identity.address', PRIMARY),
    ]
    expect(countReusedFacts([...perApplication, ...perApplication, ...perApplication])).toBe(2)
  })

  it('keeps the primary and the partner apart', () => {
    expect(
      countReusedFacts([
        carried('income.annualBasic', PRIMARY),
        carried('income.annualBasic', PARTNER),
      ]),
    ).toBe(2)
  })

  it('ignores what was asked for fresh, and what was never a fact', () => {
    expect(
      countReusedFacts([
        { reused: false, fact: { key: 'income.annualBasic', subject: PRIMARY } },
        { reused: false, fact: null },
      ]),
    ).toBe(0)
  })
})

describe('a document the linked accounts covered (open banking, simulated)', () => {
  it('is one row per requirement, named from the event, with the bank it was seen at', () => {
    const rows = describeReused(
      [
        { key: 'income.annualBasic', source: 'bank_held', applicationName: 'Mortgage' },
        {
          key: null,
          source: 'account_data',
          applicationName: 'Mortgage',
          requirementId: 'payslip',
          label: 'Two recent payslips',
          bank: 'AIB',
        },
        {
          key: null,
          source: 'account_data',
          applicationName: 'Personal loan',
          requirementId: 'payslip',
          label: 'Two recent payslips',
          bank: 'AIB',
        },
      ],
      [fact('income.annualBasic', 92_000)],
    )

    expect(rows.map((row) => row.key)).toEqual(['income.annualBasic', 'document:payslip'])
    expect(rows[1]).toMatchObject({
      label: 'Two recent payslips',
      source: 'account_data',
      provenance: 'seen in your linked AIB account',
      usedFor: ['Mortgage', 'Personal loan'],
    })
  })

  it('says only that it was seen in a linked account when no bank is named', () => {
    const rows = describeReused(
      [
        {
          key: null,
          source: 'account_data',
          applicationName: 'Mortgage',
          requirementId: 'statement',
          label: 'Statements',
        },
      ],
      [],
    )
    expect(rows[0]?.provenance).toBe('seen in your linked account')
  })
})
