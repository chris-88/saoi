import { describe, expect, it } from 'vitest'
import { asFactId, asParticipantId, type Fact, type FactKey } from './facts.ts'
import { journeyFor } from './journeys/index.ts'
import { describeProspect, wouldInvolve } from './prospect.ts'

const PRIMARY = asParticipantId('11111111-1111-4111-8111-111111111111')

let next = 0
const fact = (key: FactKey, value: unknown): Fact => ({
  id: asFactId(`f-${String(++next)}`),
  key,
  subject: PRIMARY,
  value,
  source: 'customer_stated',
  verified: false,
  capturedFor: null,
  supersededBy: null,
  capturedAt: '2026-10-07T09:00:00.000Z',
})

const view = (facts: readonly Fact[] = []) =>
  wouldInvolve('mortgage', { facts, primary: PRIMARY, partner: null })

describe('what applying would involve', () => {
  it('needs the whole journey when the case knows nothing', () => {
    const result = view()

    expect(result.known).toEqual([])
    expect(result.needed.length).toBeGreaterThan(0)
  })

  it('stops asking for a fact the case already holds', () => {
    const income = journeyFor('mortgage').requirements.find(
      (requirement) => requirement.kind === 'fact' && requirement.fact === 'income.annualBasic',
    )

    // Guards the test rather than the code: if the mortgage journey stops asking for income,
    // this test is asserting nothing and should be told so.
    expect(income, 'the mortgage journey no longer asks for income').toBeDefined()

    const before = view()
    const after = view([fact('income.annualBasic', 65_000)])

    expect(before.toAsk).toContain(income?.label)
    expect(after.toAsk).not.toContain(income?.label)
    expect(after.known).toContain(income?.label)
  })

  it('never puts anything in two groups at once', () => {
    const result = view([fact('income.annualBasic', 65_000)])

    // A model told only "these are outstanding" asks for a payslip in the chat, or asks again
    // for an income it was given last week.
    const groups = [
      result.toAsk,
      result.toConfirm,
      result.toUpload,
      result.toDeclare,
      result.forPartner,
    ]

    for (const [index, group] of groups.entries()) {
      for (const label of group) {
        for (const [other, rest] of groups.entries()) {
          if (other === index) continue
          expect(rest, `${label} is in two groups`).not.toContain(label)
        }
      }
    }
  })

  it('treats a fact that only needs confirming as known, not as a question', () => {
    const result = view([fact('income.annualBasic', 65_000)])

    for (const label of result.toConfirm) {
      expect(result.known).toContain(label)
      expect(result.toAsk).not.toContain(label)
    }
  })

  it('invents nothing — every split comes out of what is outstanding', () => {
    const result = view()
    const needed = new Set(result.needed)

    for (const label of [
      ...result.toAsk,
      ...result.toConfirm,
      ...result.toUpload,
      ...result.toDeclare,
      ...result.forPartner,
    ]) {
      expect(needed.has(label), `${label} is not in needed`).toBe(true)
    }
  })

  it('accounts for every outstanding item, so nothing is silently dropped', () => {
    const result = view([fact('income.annualBasic', 65_000)])
    const split = new Set([
      ...result.toAsk,
      ...result.toConfirm,
      ...result.toUpload,
      ...result.toDeclare,
      ...result.forPartner,
    ])

    for (const label of result.needed)
      expect(split.has(label), `${label} is in no group`).toBe(true)
  })

  it('is a view of the real journey, not a summary of it', () => {
    const journey = journeyFor('credit_card')
    const result = wouldInvolve('credit_card', { facts: [], primary: PRIMARY, partner: null })
    const labels = new Set(journey.requirements.map((requirement) => requirement.label))

    for (const label of result.needed) expect(labels.has(label)).toBe(true)
  })
})

describe('describing it', () => {
  it('leads with what would not have to be given again', () => {
    const lines = describeProspect(view([fact('income.annualBasic', 65_000)]), 'Mortgage')

    expect(lines[0]).toContain('Mortgage')
    expect(lines[1]).toContain('would not be asked for again')
  })

  it('counts before it lists, because nobody asked for an inventory', () => {
    const lines = describeProspect(view(), 'Mortgage').join('\n')

    expect(lines).toMatch(/\d+ things still to find out/)
    expect(lines).toContain('do not read the list out')
  })

  it('names each already-known thing once, not once per reason', () => {
    const lines = describeProspect(view([fact('income.annualBasic', 65_000)]), 'Mortgage').join(
      '\n',
    )
    const label = 'Your annual basic salary'

    expect(lines.split(label).length - 1, 'said twice').toBe(1)
  })

  it('says so plainly when nothing is outstanding', () => {
    const lines = describeProspect(
      {
        product: 'mortgage',
        known: ['Everything'],
        needed: [],
        toAsk: [],
        toConfirm: [],
        toUpload: [],
        toDeclare: [],
        forPartner: [],
      },
      'Mortgage',
    )

    expect(lines.join(' ')).toContain('could start it now')
  })

  it('never states a document list without saying it is not exhaustive', () => {
    const lines = describeProspect(view(), 'Mortgage').join('\n')

    // A list stated flatly reads as the complete set, and an underwriter asking for one more
    // thing later makes Saoirse look wrong rather than thorough.
    expect(lines).toContain('assessed individually')
    expect(lines).toContain('not exhaustive')
  })

  it('tells the model where a declaration happens, so it does not ask for one in chat', () => {
    const lines = describeProspect(
      {
        product: 'mortgage',
        known: [],
        needed: ['Declaration'],
        toAsk: [],
        toConfirm: [],
        toUpload: [],
        toDeclare: ['Declaration'],
        forPartner: [],
      },
      'Mortgage',
    )

    expect(lines.join(' ')).toContain('review card rather than in chat')
  })
})
