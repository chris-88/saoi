import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SaoirseScreen } from '@/surfaces/SaoirseScreen'
import { PartnerJoin } from '@/partner/PartnerJoin'
import { AdminConsole } from '@/admin/AdminConsole'

/**
 * jsdom has no `matchMedia`, and motion's `useReducedMotion` caches its answer at the first
 * call anywhere in the file. The landing page now renders the product's own components, so
 * that first call happens before the explainer installs its reduced-motion stub below. The
 * whole file therefore renders still from the start, which is what every test here assumes.
 */
beforeAll(() => {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList
})

/** Surfaces need the query client, so they are rendered the way the app renders them. */
function renderSurface(element: ReactNode, initialEntries: string[] = ['/']): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * Three customer surfaces, where there were five.
 *
 * The replica bank website and the app behind a simulated login are gone: they were scaffolding
 * around the only thing worth showing, and a signed-in version that knows more about you is a
 * claim this prototype no longer makes.
 */
describe('surfaces', () => {
  it('offers no way to sign in, because there is nothing to sign in to', () => {
    renderSurface(<SaoirseScreen />)
    expect(screen.queryByRole('link', { name: /log in|sign in/i })).not.toBeInTheDocument()
  })

  it('Saoirse is the whole screen, with the composer ready', () => {
    renderSurface(<SaoirseScreen />)
    expect(screen.getByRole('textbox', { name: /message saoirse/i })).toBeInTheDocument()
  })

  it('the partner surface shows nothing about the case until the invite is redeemed', () => {
    renderSurface(
      <Routes>
        <Route path="/join/:token" element={<PartnerJoin />} />
      </Routes>,
      ['/join/opaque-token'],
    )

    // §33, Invariant 7: a partner sees their own tasks and nothing else — and before the token
    // is redeemed, not even those.
    expect(screen.queryByText(/your tasks/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('the admin console asks for a sign-in before showing anything (§37)', () => {
    renderSurface(<AdminConsole />)
    // The server checks admin status on every call regardless, but the console must not present
    // controls to someone who has not signed in.
    expect(screen.queryByText(/rebuild the sample customer/i)).not.toBeInTheDocument()
  })
})

describe('questions and collaboration', () => {
  it('offers a question form and an offer-to-work form, each with its own consent', async () => {
    const { Ask } = await import('@/surfaces/Ask')
    renderSurface(<Ask />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /ask a question, or work on this/i,
    )
    expect(screen.getByRole('tab', { name: /ask a question/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /work on this/i })).toBeInTheDocument()
    // The question form is the one open by default: a room scans this after the showcase.
    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/you can reply to me by email/i)).toBeInTheDocument()
    expect(screen.getByText(/not a banking service/i)).toBeInTheDocument()
  })
})
