import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  PRESET_NAMES,
  SLIDER_NAMES,
  applySensitivity,
  composePersona,
  slidersFor,
  toneBucket,
  type PersonaSliders,
} from './persona.ts'

const at = (value: number): PersonaSliders => ({
  length: value,
  humour: value,
  sarcasm: value,
  formality: value,
  playfulness: value,
  poetic: value,
})

describe('presets', () => {
  it('defines every slider for every preset', () => {
    for (const preset of PRESET_NAMES) {
      for (const slider of SLIDER_NAMES) {
        const value = PRESETS[preset][slider]
        expect(value, `${preset}.${slider}`).toBeGreaterThanOrEqual(0)
        expect(value, `${preset}.${slider}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('formal has no humour, sarcasm, playfulness or poetry', () => {
    const formal = slidersFor('formal')
    expect([formal.humour, formal.sarcasm, formal.playfulness, formal.poetic]).toEqual([0, 0, 0, 0])
  })

  it('dry humour is humorous and sarcastic without being playful or poetic', () => {
    const dry = slidersFor('dry_humour')
    expect(dry.humour).toBeGreaterThan(0.5)
    expect(dry.sarcasm).toBeGreaterThan(0.5)
    expect(dry.poetic).toBe(0)
  })
})

describe('composePersona()', () => {
  it('is stable for a given set of sliders', () => {
    expect(composePersona(slidersFor('default'))).toMatchInlineSnapshot(`
      "## Style

      How you write, dialled in. This changes nothing about what you may discuss, what you can
      do, any application rule, or any customer protection.

      - One to three sentences. If it is running longer, you are explaining something they did not ask about.
      - Be dry. A wry aside where the moment genuinely offers one, never forced, never at their expense.
      - No sarcasm at all.
      - Talk like a good colleague. Contractions, plain words, no bank-speak.
      - Let a bit of character through in how you phrase things.
      - Plain words. No imagery."
    `)
  })

  it('changes wording when a slider moves between bands', () => {
    const quiet = composePersona(at(0))
    const loud = composePersona(at(1))

    expect(quiet).not.toEqual(loud)
    expect(quiet).toContain('No jokes.')
    expect(loud).toMatch(/Properly funny/)
  })

  it('clamps values outside 0 to 1 rather than throwing', () => {
    expect(() => composePersona(at(-5))).not.toThrow()
    expect(() => composePersona(at(99))).not.toThrow()
    expect(composePersona(at(-5))).toEqual(composePersona(at(0)))
    expect(composePersona(at(99))).toEqual(composePersona(at(1)))
  })

  it('always states the style block cannot change scope, rules or protections', () => {
    for (const preset of PRESET_NAMES) {
      const block = composePersona(slidersFor(preset))
      expect(block, preset).toMatch(/changes nothing about what you may discuss/i)
      expect(block, preset).toContain('customer protection')
    }
  })

  it('contains no instruction about tools, products or permissions', () => {
    for (const preset of PRESET_NAMES) {
      const block = composePersona(slidersFor(preset)).toLowerCase()
      for (const forbidden of ['tool', 'record_facts', 'submit', 'approve', 'you may now']) {
        expect(block, `${preset} / ${forbidden}`).not.toContain(forbidden)
      }
    }
  })
})

describe('applySensitivity() (§50, Invariant 5)', () => {
  it('forces humour, sarcasm, playfulness and poetic to zero', () => {
    const sensitive = applySensitivity(slidersFor('poetic'), true)

    expect(sensitive.humour).toBe(0)
    expect(sensitive.sarcasm).toBe(0)
    expect(sensitive.playfulness).toBe(0)
    expect(sensitive.poetic).toBe(0)
  })

  it('leaves length and formality alone: brevity is not a protection', () => {
    const original = slidersFor('poetic')
    const sensitive = applySensitivity(original, true)

    expect(sensitive.length).toBe(original.length)
    expect(sensitive.formality).toBe(original.formality)
  })

  it('does nothing when the turn is not sensitive', () => {
    expect(applySensitivity(slidersFor('dry_humour'), false)).toEqual(slidersFor('dry_humour'))
  })

  it('silences even the most playful persona', () => {
    const block = composePersona(applySensitivity(at(1), true))
    expect(block).toContain('No jokes.')
    expect(block).toContain('No sarcasm at all.')
  })
})

describe('toneBucket()', () => {
  it('picks formal wording for a formal persona', () => {
    expect(toneBucket(slidersFor('formal'))).toBe('formal')
  })

  it('picks playful wording for a friendly persona', () => {
    expect(toneBucket(slidersFor('friendly'))).toBe('playful')
  })

  it('picks neutral wording for the default persona', () => {
    expect(toneBucket(slidersFor('default'))).toBe('neutral')
  })
})

/**
 * §16 — the default persona is concise, helpful, curious, competent and LIGHTLY HUMOROUS.
 * An earlier default put humour and playfulness at 0.3, which fell into the lowest band and
 * rendered as "No jokes" — the opposite of what §16 asks for.
 */
describe('the default persona matches §16', () => {
  const block = composePersona(slidersFor('default'))

  it('is dry rather than humourless', () => {
    expect(block).toMatch(/Be dry/)
    expect(block).not.toContain('No jokes.')
  })

  it('lets character through rather than being literal', () => {
    expect(block).not.toContain('Be literal and direct.')
  })

  it('keeps turns to a conversational length', () => {
    expect(block).toMatch(/One to three sentences/)
  })

  it('does not make the default sarcastic', () => {
    expect(block).toContain('No sarcasm at all.')
  })
})
