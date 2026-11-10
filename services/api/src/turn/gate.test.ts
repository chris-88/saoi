import { describe, expect, it, vi } from 'vitest'
import { PRESETS, toneBucket } from '@shared/llm/persona.ts'
import { refusalFor } from '@shared/llm/refusals.ts'
import { loadedCase } from '../testing.actions.ts'
import { admit } from './gate.ts'

const tone = toneBucket(PRESETS.default)
const banking = { category: 'banking', profanity: false, sensitive: false } as const

function run(
  message: string,
  over: {
    isCustomerTurn?: boolean
    classify?: ReturnType<typeof vi.fn>
    killSwitch?: boolean
  } = {},
) {
  const classify = over.classify ?? vi.fn(() => Promise.resolve(banking))
  return {
    classify,
    result: admit({
      isCustomerTurn: over.isCustomerTurn ?? true,
      customerMessage: message,
      loaded: loadedCase('case', { killSwitch: over.killSwitch ?? false }),
      classify: classify as never,
      tone,
    }),
  }
}

describe('admit: the gate in front of the model (Invariant 4)', () => {
  it('lets a banking message through, classified', async () => {
    const { result, classify } = run('I want a mortgage')
    expect(await result).toMatchObject({ allowed: true, category: 'banking' })
    expect(classify).toHaveBeenCalledOnce()
  })

  it('passes the previous Saoirse turn to the classifier, so a short answer classifies in context', async () => {
    const loaded = loadedCase('case', {
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'How much is the house?',
          cards: [],
          createdAt: '2026-11-04T10:00:00Z',
        } as never,
      ],
    })
    const classify = vi.fn(() => Promise.resolve(banking))
    await admit({
      isCustomerTurn: true,
      customerMessage: 'about 92k',
      loaded,
      classify: classify,
      tone,
    })
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'about 92k',
        previousAssistantTurn: 'How much is the house?',
      }),
    )
  })

  it('blocks what is out of scope with the canned line, and says why', async () => {
    const classify = vi.fn(() =>
      Promise.resolve({ category: 'off_topic', profanity: false, sensitive: false } as const),
    )
    const gate = await run('Tell me a joke', { classify }).result
    expect(gate).toMatchObject({ allowed: false, category: 'off_topic', reason: 'off_topic' })
    if (gate.allowed) throw new Error('expected a block')
    expect(gate.response).toBe(refusalFor('off_topic', tone))
  })

  it('fails closed when the classifier throws', async () => {
    const classify = vi.fn(() => Promise.reject(new Error('boom')))
    const gate = await run('I want a mortgage', { classify }).result
    expect(gate.allowed).toBe(false)
    if (gate.allowed) throw new Error('expected a block')
    expect(gate.classifierFailure).toBeDefined()
  })

  it('refuses everything while the kill switch is on, without asking the classifier', async () => {
    const { result, classify } = run('I want a mortgage', { killSwitch: true })
    const gate = await result
    expect(gate).toMatchObject({ allowed: false, category: 'unsupported', reason: 'demo_paused' })
    expect(classify).not.toHaveBeenCalled()
  })

  it('refuses empty and over-long input before any model call', async () => {
    const empty = run('   ')
    expect((await empty.result).allowed).toBe(false)
    expect(empty.classify).not.toHaveBeenCalled()

    const long = run('a'.repeat(1_001))
    expect((await long.result).allowed).toBe(false)
    expect(long.classify).not.toHaveBeenCalled()
  })

  it('skips the gate for a tap, an opening and a return', async () => {
    const { result, classify } = run('', { isCustomerTurn: false })
    expect(await result).toMatchObject({ allowed: true, category: 'banking' })
    expect(classify).not.toHaveBeenCalled()
  })
})

describe('a comparison the customer brought', () => {
  it('lets questions about its providers through, and only then', async () => {
    const { withProvidersInScope } = await import('./gate.ts')
    const { demoDomainConfig, categoryReachesModel } =
      await import('@shared/tenants/demo/domain-config.ts')
    expect(categoryReachesModel(demoDomainConfig, 'competitor')).toBe(false)
    expect(categoryReachesModel(withProvidersInScope(demoDomainConfig), 'competitor')).toBe(true)
    // Nothing else changes.
    expect(categoryReachesModel(withProvidersInScope(demoDomainConfig), 'off_topic')).toBe(
      categoryReachesModel(demoDomainConfig, 'off_topic'),
    )
  })
})
