import { useEffect, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { Button } from '@/components/ui/button'
import { isModuleLoadError } from '@/app/staleDeploy'

/**
 * What a customer sees when a route throws.
 *
 * Without this, React Router renders its own fallback — "Hey developer 👋", with advice about
 * the `errorElement` prop. It is addressed to whoever built the app, and it was being shown to
 * whoever opened it.
 */
export function RouteError(): ReactNode {
  const error = useRouteError()
  const stale = isModuleLoadError(error)

  useEffect(() => {
    // A stale chunk is already understood and already handled; reporting it would just be noise
    // in the alerting every time we deploy.
    if (!stale) Sentry.captureException(error)
  }, [error, stale])

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">
          {stale ? 'Saoirse has been updated' : 'Something went wrong'}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {stale
            ? 'Reload to pick up the new version. Your conversation is saved.'
            : 'The error has been reported. Reload to continue.'}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            window.location.reload()
          }}
        >
          Reload
        </Button>
      </div>
    </div>
  )
}
