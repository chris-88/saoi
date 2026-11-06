import { describe, expect, it } from 'vitest'
import { PUBLISHED_RATES } from '@shared/tenants/demo/mortgage-rates-select.ts'
import { toolContext } from './_testing.ts'
import { showMortgageRatesTool } from './show-mortgage-rates.ts'

describe('show_mortgage_rates', () => {
  it('shows the published rates the customer is entitled to, with repayments', () => {
    const outcome = showMortgageRatesTool.run(
      { customerType: 'first_time_buyer', ber: 'B', amountEur: 300_000, termYears: 30 },
      toolContext({ rateTable: PUBLISHED_RATES as never }),
    )

    expect(outcome).toMatchObject({ card: { type: 'mortgage_rates' } })
    expect(outcome).not.toHaveProperty('refused')
  })

  it('refuses when no published rate matches', () => {
    const outcome = showMortgageRatesTool.run(
      { customerType: 'first_time_buyer', ber: 'B' },
      toolContext({ rateTable: { asOf: '2026-01-01', rates: [] } as never }),
    )

    expect(outcome).toMatchObject({ refused: true })
    expect(outcome).not.toHaveProperty('card')
  })
})
