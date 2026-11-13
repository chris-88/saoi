import { describe, expect, it } from 'vitest'
import { isSignedInAction, SIGNED_IN_ACTION, signInAnswered } from './sign-in-prompt.ts'

describe('the sign-in action', () => {
  it('is the app’s "Signed in." tap, and nothing typed', () => {
    expect(isSignedInAction('action', SIGNED_IN_ACTION)).toBe(true)
    expect(isSignedInAction('action', ' Signed in. ')).toBe(true)
    expect(isSignedInAction('message', SIGNED_IN_ACTION)).toBe(false)
    expect(isSignedInAction('action', 'Kept "Buy my first home" as a plan.')).toBe(false)
    expect(isSignedInAction('return', undefined)).toBe(false)
  })
})

/**
 * 2026-11-13, one claimed-plan case: "Signed in." at 09:36, 09:49, 11:05 and 11:06, each after
 * its own Google login with the same account (two on the phone, two on a Mac), and the case
 * signed in once, at 09:36.
 */
describe('signInAnswered: one sign-in, one message', () => {
  const signedInAt = '2026-11-13T09:36:17.434Z'
  const first = { id: 'message-0936', createdAt: '2026-11-13T09:36:17.654Z' }

  it('lets the first sign-in through', () => {
    expect(signInAnswered(signedInAt, null)).toBeNull()
  })

  it('answers every later landing with the message already written', () => {
    expect(signInAnswered(signedInAt, first)).toBe('message-0936')
  })

  it('lets a sign-in through when the only message is from before the case was signed in', () => {
    expect(
      signInAnswered(signedInAt, { id: 'older', createdAt: '2026-11-12T10:00:00.000Z' }),
    ).toBeNull()
  })

  it('counts any message when no sign-in was recorded', () => {
    expect(signInAnswered(null, first)).toBe('message-0936')
    expect(signInAnswered(null, null)).toBeNull()
  })
})
