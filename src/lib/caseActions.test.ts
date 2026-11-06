import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock('@/lib/saoiApi', () => ({
  callCaseActionApi: state.api,
}))

import { runCaseAction } from '@/lib/caseActions'

const CASE = '22222222-2222-4222-8222-222222222222'
const reply = { applications: [], summary: 'Done.' }
const action = { action: 'decline_product', caseId: CASE, product: 'personal_loan' } as const

describe('runCaseAction', () => {
  beforeEach(() => {
    state.api.mockReset().mockResolvedValue(reply)
  })

  it('calls saoi-api, handing over the open case', async () => {
    await expect(runCaseAction(action, { caseId: CASE })).resolves.toEqual(reply)
    expect(state.api).toHaveBeenCalledWith(action, CASE)
  })

  it('rejects a reply that does not match the contract', async () => {
    state.api.mockResolvedValue({ summary: 1 })
    await expect(runCaseAction(action)).rejects.toThrow()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })
})
