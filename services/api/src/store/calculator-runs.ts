import type { CalculatorRun } from '@shared/domain/market/run-bands.ts'
import type { Db } from './client.ts'

/**
 * The anonymous record of each home-calculator run (`calculator_runs`): one banded row, written
 * after the response, never read here. A failure is logged and never reaches the customer.
 */
export type CalculatorRunStore = {
  record(run: CalculatorRun): Promise<void>
}

export function supabaseCalculatorRunStore(db: Db): CalculatorRunStore {
  return {
    async record(run) {
      const result = await db.from('calculator_runs').insert(run)
      if (result.error) throw new Error(`Could not record the run: ${result.error.message}`)
    },
  }
}
