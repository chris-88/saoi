import type { ReactNode } from 'react'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Link } from 'react-router-dom'
import { CompassIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconTile } from '@/components/IconTile'
import { routes } from '@/app/routes'

export function NotFound(): ReactNode {
  useDocumentTitle('Page not found')
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-4 text-center">
        <IconTile tone="neutral" size="lg">
          <CompassIcon />
        </IconTile>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-muted-foreground text-sm">That page does not exist.</p>
        </div>
        <Button asChild>
          <Link to={routes.saoirse}>Back to the start</Link>
        </Button>
      </div>
    </div>
  )
}
