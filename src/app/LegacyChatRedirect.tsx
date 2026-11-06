import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

/**
 * `/baz` was the chat's address before the product was renamed. Old links, printed QR codes and
 * pinned installs still point at it, so it stays as a redirect to the chat (`/`). The query
 * string travels with it: `/baz?src=qr` and a push link's `?n=<code>` still mean something.
 */
export function LegacyChatRedirect(): ReactNode {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/', search }} replace />
}
