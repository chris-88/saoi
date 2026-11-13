import { describe, expect, it } from 'vitest'
import { CONVERSATION } from '@shared/llm/conversation.ts'
import { asApplicationId } from '@shared/domain/facts.ts'
import { STAGES } from '@shared/domain/conversation/stages.ts'
import { loadedCase } from '../testing.actions.ts'
import { computeStage, DEMO_PLAN_TOOLS, MARKET_TOOLS, toolsForTurn } from './stage.ts'

const FORM_TOOLS = ['record_form_answers', 'show_form_declarations', 'show_form_upload']
const noGoals = { candidates: [], lines: [] }

describe('toolsForTurn: withholding a tool is enforcement', () => {
  it.each(STAGES)('offers exactly the stage guide’s tools in %s once a form exists', (stage) => {
    expect(toolsForTurn(stage, true)).toEqual(CONVERSATION[stage].tools)
  })

  it.each(STAGES)('never offers a form tool in %s while there is no form', (stage) => {
    const offered = toolsForTurn(stage, false)
    for (const tool of FORM_TOOLS) expect(offered).not.toContain(tool)
    expect(offered).toEqual(CONVERSATION[stage].tools.filter((tool) => !FORM_TOOLS.includes(tool)))
  })

  it('offers no product card while the conversation is still finding out what is wanted', () => {
    expect(toolsForTurn('opening', true)).not.toContain('show_product_options')
    expect(toolsForTurn('direction', true)).not.toContain('show_product_options')
  })
})

/**
 * A market conversation (a claimed plan or holdings), 2026-11-13: after "yes a plan" on a claimed
 * home plan Saoirse ran the POC's `propose_plan` and `show_arrangement`. The plan is the one they
 * brought, so the POC's plan, arrangement and application tools are offered in no stage.
 */
describe('toolsForTurn: a market conversation runs none of the Demo Bank plan flow', () => {
  it.each(STAGES)('offers only recording and the market tools in %s, form or not', (stage) => {
    for (const hasForm of [false, true]) {
      expect(toolsForTurn(stage, hasForm, true)).toEqual([
        'record_facts',
        'set_reminder',
        'record_holding',
        ...MARKET_TOOLS,
      ])
      for (const tool of DEMO_PLAN_TOOLS) {
        expect(toolsForTurn(stage, hasForm, true)).not.toContain(tool)
      }
    }
  })

  it('keeps the Demo Bank plan flow for a case without a claimed plan or holdings', () => {
    expect(toolsForTurn('planning', false)).toContain('propose_plan')
    expect(toolsForTurn('arranging', false)).toContain('show_arrangement')
    expect(toolsForTurn('applying', true)).toContain('show_review')
  })
})

describe('computeStage: read from the case every turn, never stored', () => {
  const inputs = (over: Partial<Parameters<typeof computeStage>[0]> = {}) => ({
    loaded: loadedCase('case'),
    goals: noGoals,
    keptPlans: [],
    savingsOptions: [],
    ...over,
  })

  it('opens a blank case', () => {
    const { stage, approach, arrangement } = computeStage(inputs())
    expect(stage).toBe('opening')
    expect(approach).toBeNull()
    expect(arrangement).toBeNull()
  })

  it('is applying as soon as an application exists, whatever else is true', () => {
    const loaded = loadedCase('case', {
      applications: [
        {
          id: asApplicationId('app'),
          product: 'credit_card',
        } as never,
      ],
    })
    expect(computeStage(inputs({ loaded })).stage).toBe('applying')
  })

  it('moves to choosing once a plan has been kept', () => {
    expect(computeStage(inputs({ keptPlans: [{ title: 'Deposit' }] })).stage).toBe('choosing')
  })
})
