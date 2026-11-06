import { describe, expect, it } from 'vitest'
import { fixtureScript } from './index.ts'

describe('fixtureScript', () => {
  it.each(['opening', 'reuse'])('loads and validates the %s script', (name) => {
    expect(fixtureScript(name)).toBeDefined()
  })

  it('names the available scripts when one is missing', () => {
    expect(() => fixtureScript('nope')).toThrow(/opening, reuse/)
  })
})
