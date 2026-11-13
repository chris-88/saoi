import { describe, expect, it } from 'vitest'
import { exampleMarketPlan } from '@shared/contracts/market-plan.example.ts'
import { marketPlanSchema, type MarketPlan } from '@shared/contracts/market-plan.ts'
import { buildPlanRequestSchema } from '@shared/contracts/market-tools.ts'
import type { LoadedMessage } from '@shared/db/loaded-case.ts'
import {
  arrivalMessage,
  arrivedWith,
  savedPlanDigestLines,
  type ClaimedPlan,
} from '@shared/db/saved-plans.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { buildPlan } from '@shared/domain/market/plan.ts'
import { applyPlanEdit } from '@shared/domain/market/plan-edit.ts'
import {
  ARRIVAL_ANSWER_INSTRUCTION,
  ARRIVAL_OPENED_NOTE,
  conversationSoFar,
  returnInstruction,
  returnsAfterPlanEdit,
} from './context.ts'

/**
 * The first turn after a claim (2026-11-12, "3. Arrival"): the claim wrote Saoirse's first
 * message, the card and the question, and the customer's next message is the answer.
 */

const claimed: ClaimedPlan = {
  id: '99999999-9999-4999-8999-999999999999',
  plan: marketPlanSchema.parse({
    ...exampleMarketPlan(),
    arrival: {
      keysOn: '2027-09',
      readyLine: 'September 2027',
      readyNote: 'Before interest',
      factParts: ['€40,000 deposit', '+ €4,000 stamp duty', '+ €3,000 legal and survey'],
      progress: { savedEur: 32_000, neededEur: 47_000, monthlySavingEur: 1_500 },
      tiles: [],
      assumptions: ['First-time buyer'],
      hookQuestion: {
        key: 'tax_paid',
        question: 'How much Income Tax and DIRT have you both paid over the last four years?',
        why: 'It decides whether Help to Buy covers the €35,000.',
      },
    },
  }),
}
const opening = arrivalMessage(claimed).content

const message = (
  role: LoadedMessage['role'],
  content: string,
  cards: string[] = [],
): LoadedMessage => ({ role, content, cards, createdAt: '2026-11-12T09:00:00Z', timing: null })

const arrival = message('assistant', opening, ['saved_plan'])

describe('the turn after the arrival', () => {
  it('reads the arrival as Saoirse’s first line, and the customer’s message as the answer', () => {
    const { history, answeringArrival } = conversationSoFar({
      messages: [arrival],
      claimedPlans: [claimed],
      customerMessage: 'About €60,000 between us.',
      signIn: null,
    })
    expect(answeringArrival).toBe(true)
    expect(history).toEqual([
      { role: 'user', content: ARRIVAL_OPENED_NOTE },
      { role: 'assistant', content: opening },
      {
        role: 'user',
        content: `About €60,000 between us.\n\n(${ARRIVAL_ANSWER_INSTRUCTION})`,
      },
    ])
    expect(ARRIVAL_ANSWER_INSTRUCTION).toMatch(/Do not welcome them/)
    expect(ARRIVAL_ANSWER_INSTRUCTION).toMatch(/do not ask another question/)
    expect(ARRIVAL_ANSWER_INSTRUCTION).toMatch(/plan card again/)
  })

  it('is an ordinary turn once the question has been answered', () => {
    const { history, answeringArrival } = conversationSoFar({
      messages: [
        arrival,
        message('customer', 'About €60,000 between us.'),
        message('assistant', 'That covers the €35,000.'),
      ],
      claimedPlans: [claimed],
      customerMessage: 'And the First Home Scheme?',
      signIn: null,
    })
    expect(answeringArrival).toBe(false)
    expect(history[0]).toEqual({ role: 'user', content: ARRIVAL_OPENED_NOTE })
    expect(history.at(-1)).toEqual({ role: 'user', content: 'And the First Home Scheme?' })
  })

  it('leaves a conversation that did not open on a plan as it was', () => {
    const { history, answeringArrival } = conversationSoFar({
      messages: [message('customer', 'Hi'), message('assistant', 'Hello.')],
      claimedPlans: [claimed],
      customerMessage: 'Rates?',
      signIn: 'Sign-in aside.',
    })
    expect(answeringArrival).toBe(false)
    expect(history).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: 'Rates?\n\n(Sign-in aside.)' },
    ])
  })

  it('tells the digest the card and the question were shown, naming the question', () => {
    const lines = savedPlanDigestLines(claimed, true)
    const shown = lines.find((line) => line.startsWith('Already shown'))
    expect(shown).toContain(`"${opening}"`)
    expect(shown).toMatch(/Do not show the card again, welcome them or repeat that line/)
    expect(savedPlanDigestLines(claimed).some((line) => line.startsWith('Already shown'))).toBe(
      false,
    )
  })
})

/**
 * After a plan edit in the profile (2026-11-12, "6. The saving months"): the app has shown the
 * edit's reading as Saoirse's line, then runs a return turn that builds on it.
 */
describe('the return turn after a plan edit', () => {
  const reading =
    'Moving the keys to March 2028 means €4,751 less saved by then at this pace; the 18-month deposits no longer fit, and deposits of up to one year still do.'
  const edited = {
    type: 'plan_edited',
    payload: { reading, effects: { nowFit: [], noLongerFit: ['18-month deposits'] } },
  }

  it('builds on the reading already shown: no greeting, not the same words, no status card', () => {
    const instruction = returnInstruction([edited])
    expect(instruction).toContain(`The app has already shown them this line as yours: "${reading}"`)
    expect(instruction).toContain('Do not greet them or welcome them back')
    expect(instruction).toContain('do not say that line again in the same words')
    expect(instruction).toContain('do not call show_status')
    expect(instruction).toContain('which now fit and which no longer do, with their figures')
    expect(instruction).toContain('never call the change or an option better or worse')
    expect(instruction).not.toContain('Then name the other things')
  })

  it('is text only: no show_products or other card unless they ask', () => {
    const instruction = returnInstruction([edited])
    expect(instruction).toContain(
      'This reply is text only: do not call show_products or any other tool that shows a card',
    )
    expect(instruction).not.toMatch(/show_products with fits_date/)
  })

  it('is told apart from an ordinary return and from a customer’s message', () => {
    expect(returnsAfterPlanEdit('return', [edited])).toBe(true)
    expect(returnsAfterPlanEdit('return', [{ type: 'application_approved' }, edited])).toBe(true)
    expect(returnsAfterPlanEdit('return', [{ type: 'application_approved' }])).toBe(false)
    expect(returnsAfterPlanEdit('message', [edited])).toBe(false)
  })

  it('still names anything else that happened while they were away', () => {
    expect(returnInstruction([{ type: 'application_approved', payload: {} }, edited])).toContain(
      'Then name the other things under "Changed since they were last here"',
    )
  })

  it('leaves an ordinary return as it was', () => {
    const instruction = returnInstruction([{ type: 'application_approved', payload: {} }])
    expect(instruction).toContain('Then call show_status')
    expect(instruction).not.toContain('changed their plan')
    expect(returnInstruction([{ type: 'application_approved', payload: {} }], {})).toBe(instruction)
  })

  it('in a market conversation names what changed and asks nothing, with no status card', () => {
    const instruction = returnInstruction([{ type: 'plan_milestone_reached', payload: {} }], {
      market: true,
    })
    expect(instruction).toContain('"Changed since they were last here"')
    expect(instruction).toContain('Ask nothing after it.')
    expect(instruction).not.toContain('show_status')
    expect(instruction).not.toContain('what they want to deal with first')
    // A plan edit's return is its own, as it was.
    expect(returnInstruction([edited], { market: true })).toBe(returnInstruction([edited]))
  })
})

describe('the digest after a plan edit', () => {
  const market = normaliseMarket(MARKET_FIXTURE)
  const base: MarketPlan = buildPlan(
    market,
    buildPlanRequestSchema.parse({
      situation: {
        income: { annualGross: 110_000 },
        monthlySaving: 1_500,
        savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
        firstTimeBuyer: true,
      },
      goals: [{ id: 'home', kind: 'house_deposit', label: 'Buying a home', targetDate: '2028-06' }],
      homePrice: 400_000,
      propertyKind: 'new_build',
    }),
    '2026-11-12',
    '2026-11-12T09:00:00.000Z',
  ).plan
  const before: ClaimedPlan = { id: 'plan-1', plan: base }
  const arrival = arrivalMessage(before)

  it('states the rebuilt plan and the change, and still knows the arrival', () => {
    const result = applyPlanEdit(
      market,
      base,
      { targetDate: '2028-03' },
      '2026-11-20',
      '2026-11-20T10:00:00.000Z',
    )
    if (result === null) throw new Error('no edit')
    const after: ClaimedPlan = { id: 'plan-1', plan: result.plan }
    const messages = [message('assistant', arrival.content, ['saved_plan'])]
    expect(arrivedWith(after, messages)).toBe(true)

    const lines = savedPlanDigestLines(after, true)
    expect(lines[0]).toBe('Title: Buying a home by March 2028')
    expect(lines).toContain(
      'Changed by them in the app since: the date from June 2028 to March 2028 (20 Nov 2026). Every figure below is the plan rebuilt on these; where the situation line says otherwise, these win.',
    )
    expect(lines).toContain('Goals: Buying a home (by March 2028)')
    // The first line it opened with, word for word, as the transcript has it.
    expect(lines.some((line) => line.includes(`word for word: "${arrival.content}"`))).toBe(true)
  })
})
