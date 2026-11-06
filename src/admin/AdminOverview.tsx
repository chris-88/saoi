import { useCallback, type ReactNode } from 'react'
import { FormsScreen } from '@/admin/FormsScreen'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { queryKeys } from '@/lib/queryKeys'
import { useRealtimeInvalidation } from '@/lib/useRealtimeInvalidation'
import { adminApi } from '@/admin/adminClient'
import { CasesWorkspace } from '@/admin/CasesWorkspace'
import { EngineScreen } from '@/admin/EngineScreen'
import { ProductsScreen } from '@/admin/ProductsScreen'
import { AnalyticsScreen } from '@/admin/AnalyticsScreen'
import { FeedbackScreen } from '@/admin/FeedbackScreen'
import { CollaboratorsScreen } from '@/admin/CollaboratorsScreen'
import { PeriodSelect } from '@/admin/parts'
import { ProfileScreen } from '@/admin/ProfileScreen'
import { useAdminAuth } from '@/admin/useAdminAuth'
import { GuardrailsScreen } from '@/admin/GuardrailsScreen'
import { PersonaControls } from '@/admin/PersonaControls'
import { usePeriod } from '@/admin/usePeriod'

/**
 * Which screen the console is showing.
 *
 * Four, where there were six. "Overview", "cases" and "audience" were three lists of the same
 * conversations under different headings, and the difference between them was a distinction
 * only the person who built it could hold.
 */
type Section =
  | 'cases'
  | 'case'
  | 'guardrails'
  | 'persona'
  | 'engine'
  | 'catalogue'
  | 'analytics'
  | 'forms'
  | 'feedback'
  | 'collaborators'
  | 'profile'

/** The screens that read the shared overview. The others fetch their own. */
type OverviewSection = Extract<Section, 'cases' | 'case' | 'guardrails' | 'persona'>

export function AdminOverview({ section }: { readonly section?: Section }): ReactNode {
  /*
   * These screens read none of the overview.
   *
   * Both fetch exactly what they need — the catalogue overlay, or the analytics window — so
   * neither should sit behind a spinner waiting for a case list it will never read.
   */
  if (section === 'engine') return <EngineScreen />
  if (section === 'catalogue') return <ProductsScreen />
  if (section === 'forms') return <FormsScreen />
  if (section === 'analytics') return <Analytics />
  if (section === 'feedback') return <Feedback />
  if (section === 'collaborators') return <CollaboratorsScreen />
  if (section === 'profile') return <Profile />

  return <WithOverview section={section ?? 'cases'} />
}

/** Signed-in identity comes from the auth hook, not from the overview. */
function Profile(): ReactNode {
  const auth = useAdminAuth()

  if (auth.email === null) return <Skeleton className="h-40 w-full" />

  return <ProfileScreen email={auth.email} onSignOut={() => void auth.signOut()} />
}

/** The one screen that wants the period but not the overview. */
function Analytics(): ReactNode {
  const [period, setPeriod] = usePeriod()

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>
      <AnalyticsScreen period={period} />
    </div>
  )
}

/** Same window as the rest of the console, so "this month's feedback" is this month's. */
function Feedback(): ReactNode {
  const [period, setPeriod] = usePeriod()

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>
      <FeedbackScreen period={period} />
    </div>
  )
}

function WithOverview({ section }: { readonly section: OverviewSection }): ReactNode {
  const queryClient = useQueryClient()

  /**
   * The window the numbers are counted over, remembered across screens.
   *
   * Switching from Cases to Analytics and finding the period had reset makes two figures look
   * like they disagree when they were simply counted over different spans.
   */
  const [period, setPeriod] = usePeriod()

  const overview = useQuery({
    queryKey: queryKeys.admin.cases(period),
    // Wrapped, not passed: TanStack calls the function with its own query context, which would
    // arrive here as the period.
    queryFn: () => adminApi.overview(period),
  })

  const refresh = useCallback(
    // Every period, because an action changes the numbers in all of them.
    () => void queryClient.invalidateQueries({ queryKey: ['admin', 'cases'] }),
    [queryClient],
  )

  /**
   * §40 — the console follows the conversation as it happens. Somebody watching a customer talk
   * to Saoirse should see the facts land and the applications appear, rather than reloading to find
   * out whether anything did.
   */
  useRealtimeInvalidation(
    ['messages', 'facts', 'applications', 'events', 'product_interests'],
    refresh,
  )

  if (overview.isPending) return <Skeleton className="h-40 w-full" />
  if (overview.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{overview.error.message}</AlertDescription>
      </Alert>
    )
  }

  const data = overview.data

  switch (section) {
    case 'persona':
      return <PersonaControls persona={data.persona} onChanged={refresh} />
    case 'guardrails':
      return (
        <GuardrailsScreen blocked={data.blocked} killSwitch={data.killSwitch} onChanged={refresh} />
      )
    // Both render the workspace; the route decides which conversation is open in it.
    case 'cases':
    case 'case':
      return <CasesWorkspace data={data} period={period} onPeriodChange={setPeriod} />
  }
}
