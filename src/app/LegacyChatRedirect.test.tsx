import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { LegacyChatRedirect } from '@/app/LegacyChatRedirect'

function Where() {
  const { pathname, search } = useLocation()
  return <p>{`at ${pathname}${search}`}</p>
}

describe('LegacyChatRedirect', () => {
  it('sends /baz to the chat and keeps the query string', () => {
    render(
      <MemoryRouter initialEntries={['/baz?src=qr']}>
        <Routes>
          <Route path="/baz" element={<LegacyChatRedirect />} />
          <Route path="/" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('at /?src=qr')).toBeTruthy()
  })
})
