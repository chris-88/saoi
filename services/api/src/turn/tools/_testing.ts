import { loadedCase } from '../../testing.actions.ts'
import type { ToolContext } from './_shared.ts'

export const CASE = '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11'

/**
 * A tool context with the Supabase client left empty: tests that reach the database mock the
 * shared writers, and everything else reads the loaded case.
 */
export function toolContext(over: Partial<ToolContext> = {}): ToolContext {
  return {
    admin: {} as never,
    turn: { caseId: CASE, trigger: 'message' },
    loaded: loadedCase(CASE),
    primary: 'participant-primary',
    gate: {
      allowed: true,
      category: 'banking',
      clarifyInScope: false,
      suppressHumour: false,
      suppressProductOffers: false,
      profanity: false,
      injectionFlagged: false,
    },
    goals: { candidates: [], lines: [] },
    goalContext: null,
    kb: { products: [] } as never,
    rateTable: [] as never,
    savingsOptions: [],
    nameFor: () => 'Savings account',
    digest: { applications: [] } as never,
    currentAccountPick: null,
    needContext: null,
    customerMessage: '',
    market: () => Promise.resolve({ products: [], recordsOf: new Map(), viewOfRow: new Map() }),
    rejections: [],
    ...over,
  }
}
