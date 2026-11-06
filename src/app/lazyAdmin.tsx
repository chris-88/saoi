import { lazy, Suspense, type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The console loads on demand; the customer never downloads it.
 *
 * It is the larger half of this application — a charting library, a command palette, a data grid
 * — and none of it is reachable without typing `/admin`. Bundled together it arrived on every
 * phone that opened Saoirse, which is a cost paid by the people the product is for so that one
 * operator does not wait a moment.
 *
 * In its own file because `router.tsx` exports a router, and a module that exports both a
 * component and something else loses fast refresh.
 */
const Console = lazy(async () => ({
  default: (await import('@/admin/AdminConsole')).AdminConsole,
}))

const Overview = lazy(async () => ({
  default: (await import('@/admin/AdminOverview')).AdminOverview,
}))

type Section = NonNullable<Parameters<typeof Overview>[0]['section']>

export function LazyAdminConsole(): ReactNode {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-64" />}>
      <Console />
    </Suspense>
  )
}

export function LazyAdminOverview({ section }: { readonly section: Section }): ReactNode {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-64" />}>
      <Overview section={section} />
    </Suspense>
  )
}
