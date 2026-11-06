import { QueryClient } from '@tanstack/react-query'

/**
 * Server state is invalidated by Supabase Realtime, not by polling
 * (CLAUDE.md > TanStack Query).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}
