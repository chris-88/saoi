import { describe, expect, it } from 'vitest'
import { NARRATABLE_EVENTS, describeEvent, isNarratable } from './narration.ts'

describe('saying what happened', () => {
  it('names the application and what the bank did', () => {
    expect(
      describeEvent({ type: 'application_approved', payload: { applicationName: 'Mortgage' } }),
    ).toBe('Mortgage was approved.')
    expect(
      describeEvent({
        type: 'information_requested',
        payload: { applicationName: 'Mortgage', detail: 'a payslip' },
      }),
    ).toBe('Mortgage: the team asked for a payslip.')
  })

  it('names the partner when it knows them', () => {
    expect(describeEvent({ type: 'partner_completed', payload: { partnerName: 'Emma' } })).toBe(
      'Emma completed their part.',
    )
    expect(describeEvent({ type: 'partner_completed', payload: {} })).toBe(
      'Your partner completed their part.',
    )
  })

  /** An account is opened; a loan is completed. The product on the event tells them apart. */
  it('says an account is open rather than complete', () => {
    expect(
      describeEvent({
        type: 'application_completed',
        payload: { applicationName: 'Current account', product: 'current_account' },
      }),
    ).toBe('Current account is open.')
    expect(
      describeEvent({
        type: 'application_completed',
        payload: { applicationName: 'Joint account', product: 'joint_account' },
      }),
    ).toBe('Joint account is open.')
    expect(
      describeEvent({
        type: 'application_completed',
        payload: { applicationName: 'Personal loan', product: 'personal_loan' },
      }),
    ).toBe('Personal loan is complete.')
    // Written before the product was carried on the event.
    expect(
      describeEvent({ type: 'application_completed', payload: { applicationName: 'Mortgage' } }),
    ).toBe('Mortgage is complete.')
  })

  it('says the documents were checked, naming the application when the event does', () => {
    expect(
      describeEvent({
        type: 'documents_verified',
        payload: { applicationName: 'Current account', product: 'current_account', documents: 2 },
      }),
    ).toBe('Current account: your documents were checked and accepted.')
    // The case-wide check writes no application on the event.
    expect(
      describeEvent({ type: 'documents_verified', payload: { count: 2, applications: 1 } }),
    ).toBe('Your documents were checked and accepted.')
  })

  /** Nobody wrote copy for it, so nobody reads a raw event name. */
  it('says nothing for an event it has no words for', () => {
    expect(describeEvent({ type: 'turn_tools', payload: {} })).toBeNull()
  })

  /** Every narratable event has a sentence, so the pill can never be blank. */
  it('has words for every narratable event', () => {
    for (const type of NARRATABLE_EVENTS) {
      expect(describeEvent({ type, payload: {} }), type).not.toBeNull()
      expect(isNarratable(type)).toBe(true)
    }
    expect(isNarratable('context_reused')).toBe(false)
  })
})
