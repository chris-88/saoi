import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Card } from '@contracts/cards.ts'
import { MortgageRatesCard } from './MortgageRatesCard'

/** The rates card with the switch comparison the server attaches when a rate is given. */
const card: Extract<Card, { type: 'mortgage_rates' }> = {
  type: 'mortgage_rates',
  title: 'Our rates against what you have',
  basis: { buyerType: 'switcher', ber: 'A', amountEur: 300_000, termYears: 20 },
  asOf: '2025-11-26',
  options: [
    {
      id: 'two-year',
      label: '2 years fixed',
      familyLabel: 'Fixed, with Cashback Plus',
      ratePct: 3.85,
      aprcPct: 4.2,
      cashbackEur: 6_000,
      cashbackNote: null,
      monthlyEur: 1_794,
      note: null,
    },
  ],
  comparison: {
    against: { label: 'AIB, 4% fixed for 2 years', ratePct: 4, monthlyEur: 1_818 },
    rows: [
      {
        optionId: 'two-year',
        monthlyDifferenceEur: 24,
        overYears: 2,
        repaymentDifferenceEur: 576,
        cashbackDifferenceEur: 6_000,
        netBeforeCostsEur: 6_576,
      },
    ],
    costs: [
      { label: 'Valuation', amount: '€150 to €250 plus VAT', note: null },
      {
        label: 'Your solicitor',
        amount: 'Agreed with your solicitor',
        note: 'The bank does not cover it.',
      },
    ],
  },
}

describe('MortgageRatesCard with a comparison', () => {
  it('shows each rate against the one they have, and lists the costs without deducting them', () => {
    render(<MortgageRatesCard card={card} />)

    expect(screen.getByText(/against AIB, 4% fixed for 2 years/i)).toBeInTheDocument()
    expect(screen.getByText('+€576')).toBeInTheDocument()
    expect(screen.getByText('+€6,000')).toBeInTheDocument()
    expect(screen.getByText('+€6,576')).toBeInTheDocument()
    expect(screen.getByText(/before switching costs/i)).toBeInTheDocument()
    expect(screen.getByText('€150 to €250 plus VAT')).toBeInTheDocument()
  })

  it('shows nothing of the kind without one', () => {
    const { comparison: _comparison, ...plain } = card
    render(<MortgageRatesCard card={plain} />)
    expect(screen.queryByText(/before switching costs/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/what switching costs/i)).not.toBeInTheDocument()
  })
})
