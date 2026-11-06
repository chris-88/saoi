import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Providers } from '@/app/providers'
import { router } from '@/app/router'
import { initSentry } from '@/lib/sentry'
import { completeSignIn } from '@/lib/identity'
import { recoverFromStaleDeploy, reloadWhenWorkerTakesOver } from '@/app/staleDeploy'
import '@/styles/fonts.css'
import '@/index.css'

initSentry()

/*
 * Redeem a sign-in that has just come back from the inbox, before React mounts.
 *
 * It has to happen first: `session start` runs on mount and decides which case this browser
 * gets, and running it against the anonymous session a moment before the signed-in one lands
 * would hand them the wrong conversation and then quietly correct it.
 */
await completeSignIn().catch(() => undefined)

/*
 * Vite raises this when a dynamic import 404s, which on a static host means one thing: the
 * build this page came from is no longer the build on the server. Reload into the current one.
 *
 * Preventing the default stops the rejection surfacing, so nothing flashes on the way out. If
 * the reload is refused — because we just tried one — the error goes through to the route
 * boundary, which says so plainly.
 */
window.addEventListener('vite:preloadError', (event) => {
  if (recoverFromStaleDeploy()) event.preventDefault()
})

/*
 * The other half of the same problem, and the half that bites more often: the service worker
 * serves a whole cached build, so nothing fails, and the page quietly renders the last version
 * somebody saw. When the new worker claims the page, reload into it.
 */
reloadWhenWorkerTakesOver()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root is missing from index.html')

createRoot(rootElement).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
