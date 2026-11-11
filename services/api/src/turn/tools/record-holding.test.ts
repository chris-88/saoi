import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Holding } from '@shared/contracts/holdings.ts'
import { exampleMarketPlan } from '@shared/contracts/market-plan.example.ts'
import { createHolding, loadHoldings, updateHolding } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { CASE, toolContext } from './_testing.ts'
import { recordHoldingTool } from './record-holding.ts'

vi.mock('@shared/db/holdings.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createHolding: vi.fn(),
  updateHolding: vi.fn(),
  loadHoldings: vi.fn(),
}))
vi.mock('@shared/db/saved-plans.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadClaimedPlans: vi.fn(),
}))

const HOLDING: Holding = {
  id: '9f8b0c7e-0000-4000-8000-000000000001',
  kind: 'savings',
  label: 'BoI savings',
  provider: 'Bank of Ireland',
  productId: null,
  balance: 33_000,
  ratePct: 2,
  monthlyAmountEur: null,
  fixedUntil: null,
  notedOn: '2026-12-11',
  source: 'saoirse',
  reminderId: null,
  createdAt: '2026-12-11T09:00:00.000Z',
  updatedAt: '2026-12-11T09:00:00.000Z',
}

const PRAISE_OR_INSTRUCTION = /\b(well done|great|good|keep going|you should)\b/i

beforeEach(() => {
  vi.mocked(createHolding).mockReset()
  vi.mocked(updateHolding).mockReset()
  vi.mocked(loadHoldings).mockReset().mockResolvedValue([HOLDING])
  vi.mocked(loadClaimedPlans)
    .mockReset()
    .mockResolvedValue([{ id: 'plan-1', plan: exampleMarketPlan() }])
})

describe('record_holding', () => {
  it('adds a holding the customer stated, as Saoirse, and returns the progress as a fact', async () => {
    vi.mocked(createHolding).mockResolvedValue(HOLDING)
    const outcome = await recordHoldingTool.run(
      {
        kind: 'savings',
        label: 'BoI savings',
        balance: 33_000,
        ratePct: 2,
        provider: 'Bank of Ireland',
      },
      toolContext(),
    )
    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toBeUndefined()
    expect(createHolding).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caseId: CASE,
        participantId: 'participant-primary',
        actor: 'model',
      }),
      expect.objectContaining({
        kind: 'savings',
        label: 'BoI savings',
        balance: 33_000,
        ratePct: 2,
        provider: 'Bank of Ireland',
        notedOn: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' }),
      }),
    )
    expect(outcome.result).toMatch(
      /^Recorded: BoI savings \(savings, Bank of Ireland\): €33,000 held at 2%; noted 11 Dec 2026\./,
    )
    expect(outcome.result).toMatch(/Progress against the plan: €33,000 of €35,000 saved/)
    expect(outcome.result.split(' Say what')[0]).not.toMatch(PRAISE_OR_INSTRUCTION)
  })

  it('changes a holding by its id, and refuses an id the case does not hold', async () => {
    vi.mocked(updateHolding).mockResolvedValueOnce({ ...HOLDING, balance: 34_000 })
    const changed = await recordHoldingTool.run(
      { holdingId: HOLDING.id, kind: 'savings', label: 'BoI savings', balance: 34_000 },
      toolContext(),
    )
    expect(changed.result).toMatch(/^Changed: BoI savings/)
    expect(updateHolding).toHaveBeenCalledWith(expect.anything(), expect.anything(), HOLDING.id, {
      kind: 'savings',
      label: 'BoI savings',
      balance: 34_000,
    })

    vi.mocked(updateHolding).mockResolvedValueOnce(null)
    const missing = await recordHoldingTool.run(
      { holdingId: HOLDING.id, kind: 'savings', label: 'BoI savings', balance: 1 },
      toolContext(),
    )
    expect(missing.refused).toBe(true)
  })

  it('says a reminder is kept for a fixed-until date', async () => {
    vi.mocked(createHolding).mockResolvedValue({
      ...HOLDING,
      kind: 'mortgage',
      label: 'AIB mortgage',
      fixedUntil: '2027-03-01',
      reminderId: '9f8b0c7e-0000-4000-8000-000000000002',
    })
    const outcome = await recordHoldingTool.run(
      { kind: 'mortgage', label: 'AIB mortgage', balance: 240_000, fixedUntil: '2027-03-01' },
      toolContext(),
    )
    expect(outcome.result).toMatch(/fixed until 1 Mar 2027/)
    expect(outcome.result).toMatch(/A reminder is kept for the date/)
  })

  it('refuses when it could not be recorded', async () => {
    vi.mocked(createHolding).mockRejectedValue(new Error('database down'))
    const outcome = await recordHoldingTool.run(
      { kind: 'savings', label: 'x', balance: 1 },
      toolContext(),
    )
    expect(outcome).toEqual({ result: 'That could not be recorded just now.', refused: true })
  })
})
