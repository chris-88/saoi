import { describe, expect, it } from 'vitest'
import { isModuleLoadError } from '@/app/staleDeploy'

/*
 * The strings are the test.
 *
 * Each engine words a failed chunk fetch differently and none of them is an error subclass we
 * could check with `instanceof`, so matching the wording is all there is. If a browser changes
 * its phrasing the recovery silently stops working, and the only warning would be a customer
 * seeing an error page after a deploy — so the exact strings are pinned here.
 */
describe('isModuleLoadError', () => {
  it.each([
    ['Safari', 'Importing a module script failed.'],
    ['Chrome', 'Failed to fetch dynamically imported module: https://app.saoi.ie/assets/x.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Vite CSS preload', 'Unable to preload CSS for /assets/index-abc.css'],
  ])('recognises %s', (_engine, message) => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true)
  })

  it('leaves ordinary failures alone', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isModuleLoadError(new Error('NetworkError when attempting to fetch resource.'))).toBe(
      false,
    )
  })

  it('does not stringify a bare object into a match', () => {
    expect(isModuleLoadError({ status: 404 })).toBe(false)
    expect(isModuleLoadError(null)).toBe(false)
  })
})
