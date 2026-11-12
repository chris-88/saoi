import { describe, expect, it } from 'vitest'
import { exampleMarketPlan } from '@shared/contracts/market-plan.example.ts'
import { marketPlanSchema } from '@shared/contracts/market-plan.ts'
import type { LoadedMessage } from '@shared/db/loaded-case.ts'
import { arrivalMessage, savedPlanDigestLines, type ClaimedPlan } from '@shared/db/saved-plans.ts'
import { ARRIVAL_ANSWER_INSTRUCTION, ARRIVAL_OPENED_NOTE, conversationSoFar } from './context.ts'

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
