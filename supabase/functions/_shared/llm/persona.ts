import type { ToneBucket } from './refusals.ts'

/**
 * Persona is style only (§18, Invariant 5).
 *
 * Sliders map to fixed prose fragments. There is no free-text persona input anywhere in the
 * system, so there is no channel through which a persona setting could alter what Saoirse is
 * permitted to discuss, which tools it may call, or any customer protection. The composed
 * block is labelled and placed AFTER the immutable policy block in the prompt, so an
 * instruction inside it cannot outrank policy.
 */

export const SLIDER_NAMES = [
  'length',
  'humour',
  'sarcasm',
  'formality',
  'playfulness',
  'poetic',
] as const

export type SliderName = (typeof SLIDER_NAMES)[number]

/** Every slider runs 0 to 1. */
export type PersonaSliders = Readonly<Record<SliderName, number>>

export const PRESET_NAMES = [
  'default',
  'concise',
  'friendly',
  'formal',
  'dry_humour',
  'poetic',
] as const
export type PresetName = (typeof PRESET_NAMES)[number]

/** §17, §38, presets are named slider sets. "Custom" simply means values of your own. */
export const PRESETS: Readonly<Record<PresetName, PersonaSliders>> = {
  // §16: the default Saoirse is concise, curious and LIGHTLY HUMOROUS, occasionally playful.
  // Values sit mid-band deliberately, 0.3 would render as "No jokes", which contradicts §16
  // and the opening line in the vision document.
  default: {
    length: 0.45,
    humour: 0.45,
    sarcasm: 0.15,
    formality: 0.5,
    playfulness: 0.45,
    poetic: 0,
  },
  // Concise is about length. It does not strip the personality out of Saoirse.
  concise: { length: 0.1, humour: 0.4, sarcasm: 0.15, formality: 0.5, playfulness: 0.4, poetic: 0 },
  friendly: {
    length: 0.6,
    humour: 0.6,
    sarcasm: 0,
    formality: 0.25,
    playfulness: 0.7,
    poetic: 0.1,
  },
  formal: { length: 0.5, humour: 0, sarcasm: 0, formality: 1, playfulness: 0, poetic: 0 },
  dry_humour: {
    length: 0.4,
    humour: 0.7,
    sarcasm: 0.75,
    formality: 0.5,
    playfulness: 0.4,
    poetic: 0,
  },
  poetic: {
    length: 0.7,
    humour: 0.45,
    sarcasm: 0.15,
    formality: 0.4,
    playfulness: 0.7,
    poetic: 0.9,
  },
}

/** Three bands per slider: low, middle, high. */
type Fragments = readonly [low: string, mid: string, high: string]

const FRAGMENTS: Readonly<Record<SliderName, Fragments>> = {
  length: [
    'One sentence. Two at the absolute most. Say the thing and stop.',
    'One to three sentences. If it is running longer, you are explaining something they did not ask about.',
    'Take the room you need to explain properly, but never pad and never repeat yourself.',
  ],
  humour: [
    'Play it straight. No jokes.',
    'Be dry. A wry aside where the moment genuinely offers one, never forced, never at their expense.',
    'Be funny. Properly funny, in an understated way. Never at their expense, and never instead of being useful.',
  ],
  sarcasm: [
    'No sarcasm at all.',
    'The occasional raised eyebrow is fine. Aim it at the situation, never at the person.',
    'Dry, deadpan, slightly sardonic, about banking, bureaucracy and yourself. Never about them or their circumstances.',
  ],
  formality: [
    'Talk like a person texting a friend who happens to know banking. Contractions, short forms, no ceremony.',
    'Talk like a good colleague. Contractions, plain words, no bank-speak.',
    'Be precise and measured. Avoid contractions and slang, but stay human, formal is not the same as stiff.',
  ],
  playfulness: [
    'Be literal and direct.',
    'Let a bit of character through in how you phrase things.',
    'Enjoy the language. Be vivid and a little unexpected, as long as the meaning is never in doubt.',
  ],
  poetic: [
    'Plain words. No imagery.',
    'An occasional well-placed image, if it earns its place.',
    'Reach for rhythm and imagery. Never at the cost of being unmistakably clear about money, timing or process.',
  ],
}

function band(value: number): 0 | 1 | 2 {
  if (value < 0.34) return 0
  if (value < 0.67) return 1
  return 2
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * §50, Invariant 5, on a sensitive turn, humour, sarcasm, playfulness and poetic are forced
 * to zero. This is applied here rather than being asked of the model, so no persona setting
 * can override it.
 */
export function applySensitivity(sliders: PersonaSliders, sensitive: boolean): PersonaSliders {
  if (!sensitive) return sliders
  return { ...sliders, humour: 0, sarcasm: 0, playfulness: 0, poetic: 0 }
}

/** Which refusal wording to use (§26). Derived from the sliders, never set independently. */
export function toneBucket(sliders: PersonaSliders): ToneBucket {
  if (sliders.formality >= 0.67) return 'formal'
  if (sliders.humour >= 0.5 || sliders.playfulness >= 0.6) return 'playful'
  return 'neutral'
}

/**
 * The labelled style block. Everything inside it is about HOW Saoirse speaks; the sentence at the
 * end makes the boundary explicit to the model as well as to a reader of the prompt.
 */
export function composePersona(sliders: PersonaSliders): string {
  const lines = SLIDER_NAMES.map((name) => FRAGMENTS[name][band(clamp(sliders[name]))])

  return [
    '## Style',
    '',
    'How you write, dialled in. This changes nothing about what you may discuss, what you can',
    'do, any application rule, or any customer protection.',
    '',
    ...lines.map((line) => `- ${line}`),
  ].join('\n')
}

export function slidersFor(preset: PresetName): PersonaSliders {
  return PRESETS[preset]
}
