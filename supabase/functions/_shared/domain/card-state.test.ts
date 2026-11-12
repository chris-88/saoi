import { describe, expect, it } from 'vitest'
import { marketPlanSchema } from '../contracts/market-plan.ts'
import { exampleMarketPlan } from '../contracts/market-plan.example.ts'
import { arrivalMessage } from '../db/saved-plans.ts'
import { signInPromptCard } from '../llm/sign-in-prompt.ts'
import { buildHistory, type CaseState } from './card-state.ts'

const PLAN_ID = '99999999-9999-4999-8999-999999999999'

const state: CaseState = {
  applications: [],
  interests: [],
  plans: [],
  requests: [],
  formAnswers: [],
  signedIn: false,
  reusedBy: new Map(),
  linkedAccounts: [],
  transfers: [],
}

describe('the transcript on reload', () => {
  it('puts a lead card above its message’s text and the rest below, as the turn showed them', () => {
    const arrival = arrivalMessage({
      id: PLAN_ID,
      plan: marketPlanSchema.parse(exampleMarketPlan()),
    })
    const history = buildHistory(
      [
        {
          id: 'm1',
          role: 'assistant',
          content: arrival.content,
          cards: [...arrival.cards, signInPromptCard('https://app.saoi.ie/#/privacy')],
        },
        { id: 'm2', role: 'customer', content: 'About €60,000 between us.', cards: [] },
        { id: 'm3', role: 'assistant', content: 'That covers it.', cards: [] },
      ],
      state,
    )
    expect(
      history.map((entry) =>
        entry.kind === 'card' ? `card:${entry.card.type}` : `${entry.author}:${entry.text}`,
      ),
    ).toEqual([
      'card:saved_plan',
      `assistant:${arrival.content}`,
      'card:sign_in',
      'customer:About €60,000 between us.',
      'assistant:That covers it.',
    ])
    // Ids stay the stored positions, so a card keeps its key across the reorder.
    expect(history[0]?.id).toBe('m1-card-0')
    expect(history[2]?.id).toBe('m1-card-1')
  })
})
