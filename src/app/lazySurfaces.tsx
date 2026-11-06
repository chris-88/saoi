import { lazy, Suspense, type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The surfaces a first visit to the landing page does not need.
 *
 * The landing page is the front door; the conversation (cards, motion, forms), the partner join
 * flow, the ask form and the privacy notice each pull in libraries the landing page never
 * touches. Imported statically they all rode in the entry chunk. Each is its own chunk now, and
 * the entry chunk is held to a budget by `npm run check:bundle`.
 *
 * In its own file because `router.tsx` exports a router, and a module that exports both a
 * component and something else loses fast refresh.
 */
const Saoirse = lazy(async () => ({
  default: (await import('@/surfaces/SaoirseScreen')).SaoirseScreen,
}))
const AskForm = lazy(async () => ({ default: (await import('@/surfaces/Ask')).Ask }))
const PrivacyNotice = lazy(async () => ({
  default: (await import('@/surfaces/Privacy')).Privacy,
}))
const Join = lazy(async () => ({ default: (await import('@/partner/PartnerJoin')).PartnerJoin }))

function Pending(): ReactNode {
  return <Skeleton className="m-6 h-64" />
}

export function LazySaoirseScreen(): ReactNode {
  return (
    <Suspense fallback={<Pending />}>
      <Saoirse />
    </Suspense>
  )
}

export function LazyAsk(): ReactNode {
  return (
    <Suspense fallback={<Pending />}>
      <AskForm />
    </Suspense>
  )
}

export function LazyPrivacy(): ReactNode {
  return (
    <Suspense fallback={<Pending />}>
      <PrivacyNotice />
    </Suspense>
  )
}

export function LazyPartnerJoin(): ReactNode {
  return (
    <Suspense fallback={<Pending />}>
      <Join />
    </Suspense>
  )
}
