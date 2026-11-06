import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Card } from '@contracts/cards.ts'
import { ConnectAccountsCard } from './ConnectAccountsCard'
import { AccountsOverviewCard } from './AccountsOverviewCard'
import { TransferCard } from './TransferCard'
import { settledState, type CaseState } from '@/saoirse/cardState'

const connect: Extract<Card, { type: 'connect_accounts' }> = {
  type: 'connect_accounts',
  why: 'So the savings application can be assessed from what is there, not from statements.',
  banks: [
    { id: 'aib', name: 'AIB' },
    { id: 'revolut', name: 'Revolut' },
  ],
  scope: ['balances', 'transactions', 'payments'],
  consentDays: 90,
}

const overview: Extract<Card, { type: 'accounts_overview' }> = {
  type: 'accounts_overview',
  asOf: '2026-10-22T09:00:00Z',
  accounts: [
    {
      id: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      bank: 'AIB',
      displayName: 'Current',
      accountType: 'current',
      ibanMasked: 'IE•• •••• •••• 4471',
      balance: 2_310.4,
    },
    {
      id: '7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      bank: 'AIB',
      displayName: 'Online Saver',
      accountType: 'savings',
      ibanMasked: 'IE•• •••• •••• 9902',
      balance: 32_000,
    },
  ],
  month: { moneyIn: 4_420, moneyOut: 2_875 },
  salary: { amount: 4_420, employer: 'Ardán Software', lastOn: '2026-09-25' },
  regular: [{ label: 'Rent', amount: 1_650, cadence: 'monthly' }],
  savingsHeld: 32_000,
}

const transfer: Extract<Card, { type: 'transfer' }> = {
  type: 'transfer',
  fromAccountId: '7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  fromLabel: 'AIB Online Saver',
  toApplicationId: '8f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  toLabel: 'SuperSaver',
  amount: 32_000,
  cadence: 'once',
  why: 'It earns more here, and it is the deposit.',
}

const empty: CaseState = {
  applications: [],
  interests: [],
  plans: [],
  requests: [],
  formAnswers: [],
  signedIn: false,
  reusedBy: new Map(),
  linkedAccounts: [],
  transfers: [],
}

describe('ConnectAccountsCard', () => {
  it('shows the consent only once a bank is picked, in the scope the contract lists', async () => {
    const onAllow = vi.fn(() => Promise.resolve())
    render(<ConnectAccountsCard card={connect} onAllow={onAllow} />)

    expect(screen.queryByText(/Nexus will share/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AIB' }))

    expect(screen.getByText(/Nexus will share your AIB accounts/)).toBeInTheDocument()
    expect(screen.getByText(/move money only when you tap/)).toBeInTheDocument()
    expect(screen.getByText(/For 90 days/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(onAllow).toHaveBeenCalledWith('aib', ['balances', 'transactions', 'payments'])
    await waitFor(() => expect(screen.getByText('Linked AIB')).toBeInTheDocument())
  })

  it('settles as not linked when declined before any bank is picked', async () => {
    const onDecline = vi.fn(() => Promise.resolve())
    render(<ConnectAccountsCard card={connect} onDecline={onDecline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.getByText('Not linked')).toBeInTheDocument())
  })
})

describe('AccountsOverviewCard', () => {
  it('renders every figure the server sent and nothing tappable', () => {
    render(<AccountsOverviewCard card={overview} />)
    expect(screen.getByText('€2,310')).toBeInTheDocument()
    expect(screen.getAllByText('€32,000')).toHaveLength(2)
    expect(screen.getByText(/€4,420 from Ardán Software, last on 25 Sep/)).toBeInTheDocument()
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('TransferCard', () => {
  it("initiates with the card's own figures and never says the money has landed", async () => {
    const onMove = vi.fn(() => Promise.resolve())
    render(<TransferCard card={transfer} onMove={onMove} />)

    fireEvent.click(screen.getByRole('button', { name: 'Move it' }))
    expect(onMove).toHaveBeenCalledWith({
      fromAccountId: transfer.fromAccountId,
      toApplicationId: transfer.toApplicationId,
      amount: 32_000,
      cadence: 'once',
    })
    await waitFor(() =>
      expect(screen.getByText('€32,000 on its way to SuperSaver')).toBeInTheDocument(),
    )
    expect(screen.queryByText(/landed/)).not.toBeInTheDocument()
  })

  it('says what the tap is before it is tapped, and after', async () => {
    render(<TransferCard card={transfer} onMove={() => Promise.resolve()} />)
    expect(screen.getByText('PSD2')).toBeInTheDocument()
    expect(screen.getByText('Payment initiation')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move it' }))
    await waitFor(() => expect(screen.getByText(/under PSD2/)).toBeInTheDocument())
  })
})

describe('settledState for the open banking cards', () => {
  it('leaves a connect card open until a consent exists, then names the bank', () => {
    expect(settledState(connect, empty)).toBeUndefined()
    const linked = {
      ...empty,
      linkedAccounts: [{ id: 'a', bank: 'revolut', revoked_at: null }],
    }
    expect(settledState(connect, linked)?.label).toBe('Linked Revolut')
    const revoked = {
      ...empty,
      linkedAccounts: [{ id: 'a', bank: 'revolut', revoked_at: '2026-10-22T10:00:00Z' }],
    }
    expect(settledState(connect, revoked)?.label).toBe('Stopped sharing')
  })

  it('settles a transfer card by application and amount, and says landed only once settled', () => {
    expect(settledState(transfer, empty)).toBeUndefined()
    const initiated = {
      ...empty,
      transfers: [
        { to_application_id: transfer.toApplicationId, amount: 32_000, state: 'initiated' },
      ],
    }
    expect(settledState(transfer, initiated)?.label).toBe('€32,000 on its way to SuperSaver')
    const other = {
      ...empty,
      transfers: [{ to_application_id: transfer.toApplicationId, amount: 500, state: 'settled' }],
    }
    expect(settledState(transfer, other)).toBeUndefined()
    const settled = {
      ...empty,
      transfers: [
        { to_application_id: transfer.toApplicationId, amount: 32_000, state: 'settled' },
      ],
    }
    expect(settledState(transfer, settled)?.label).toBe('€32,000 landed in SuperSaver')
  })

  it('never settles the overview: it is something to read', () => {
    expect(settledState(overview, empty)).toBeUndefined()
  })
})
