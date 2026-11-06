import { fixtureScriptSchema, type FixtureScript } from '@shared/llm/fixture-provider.ts'
import opening from './opening.json' with { type: 'json' }
import reuse from './reuse.json' with { type: 'json' }

/**
 * The scripts a fixture run can replay, by name.
 *
 * Static imports rather than a directory read: an Edge Function bundle has no filesystem at
 * runtime, and a script that is not in this map is a script the bundle does not contain. Each
 * one is parsed on first use, so a hand-edited JSON file fails the turn that loads it with a
 * Zod message rather than producing a strange conversation.
 *
 * Scripts are transcribed from real conversations, turn for turn, so what they replay is what
 * the model actually did on a live case and not an idea of it.
 */
const SCRIPTS: Readonly<Record<string, unknown>> = {
  opening,
  reuse,
}

export function fixtureScript(name: string): FixtureScript {
  const raw = SCRIPTS[name]
  if (raw === undefined) {
    throw new Error(
      `No fixture script named "${name}". Available: ${Object.keys(SCRIPTS).join(', ')}.`,
    )
  }
  return fixtureScriptSchema.parse(raw)
}
