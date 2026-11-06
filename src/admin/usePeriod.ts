import { useCallback, useState } from 'react'
import type { Period } from '@contracts/admin.ts'

const KEY = 'saoi.admin.period'

/**
 * The window the console's numbers are counted over.
 *
 * Kept in `localStorage` rather than per screen: switching from Cases to Analytics and finding
 * the period had reset makes two figures look like they disagree when they were simply counted
 * over different spans. Ephemeral UI state, so not TanStack Query and not the database.
 */
export function usePeriod(): readonly [Period, (next: Period) => void] {
  const [period, setPeriodState] = useState<Period>(() => read())

  const setPeriod = useCallback((next: Period) => {
    setPeriodState(next)
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // Private browsing and blocked storage both throw. The choice still applies this session.
    }
  }, [])

  return [period, setPeriod]
}

function read(): Period {
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored === '7d' || stored === '30d' || stored === '90d' || stored === 'all') return stored
  } catch {
    // Fall through to the default.
  }
  return 'all'
}
