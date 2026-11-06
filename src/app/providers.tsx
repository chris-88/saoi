import { type ReactNode, useState } from 'react'
import { LazyMotion, domAnimation } from 'motion/react'
import { QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { createQueryClient } from '@/lib/queryClient'

function Fallback(): ReactNode {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          The error has been reported. Reload to continue.
        </p>
      </div>
    </div>
  )
}

export function Providers({ children }: { children: ReactNode }): ReactNode {
  const [queryClient] = useState(createQueryClient)

  return (
    <Sentry.ErrorBoundary fallback={<Fallback />}>
      {/*
        The conversation animates through `m` components, which only pick up features from a
        `LazyMotion` root. `domAnimation` is the small set: animate, exit, in-view. The explainer
        still uses the full `motion` import inside its own lazy chunk, which is why this is not
        `strict`.
      */}
      <LazyMotion features={domAnimation}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            {children}
            <Toaster position="top-center" />
          </TooltipProvider>
        </QueryClientProvider>
      </LazyMotion>
    </Sentry.ErrorBoundary>
  )
}
