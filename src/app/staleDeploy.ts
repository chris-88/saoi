/**
 * Recovering from a deploy that landed while the app was open.
 *
 * Every build hashes its filenames and GitHub Pages swaps the whole site at once, so the moment
 * a deploy finishes, the chunk names a running page knows are gone from the server. A page that
 * has been open across a deploy — a phone in a pocket, a tab left on a desk — asks for
 * `index-OLD.js` on its next navigation, gets a 404, and the import rejects.
 *
 * That page is not broken, it is stale, and a reload fetches the build that does exist. So we
 * reload. The guard is what makes that safe: if a reload does not fix it, the failure is
 * something else, and the customer gets an honest message instead of a tab that reloads forever.
 */

const ATTEMPTED = 'saoi:stale-reload'

/** Long enough to cover a reload, short enough that a later genuine stale load still recovers. */
const WINDOW_MS = 10_000

/** A chunk that could not be fetched, as each engine words it. */
export function isModuleLoadError(error: unknown): boolean {
  // Only the shapes that actually carry a message: stringifying a bare object gives
  // "[object Object]", which matches nothing and reads like a bug when it turns up in a log.
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : ''

  return (
    /importing a module script failed/i.test(message) || // Safari
    /failed to fetch dynamically imported module/i.test(message) || // Chrome
    /error loading dynamically imported module/i.test(message) || // Firefox
    /unable to preload css/i.test(message)
  )
}

/**
 * Reload, unless we just did.
 *
 * Returns whether a reload was started, so the caller can let the error through when it was not.
 */
export function recoverFromStaleDeploy(): boolean {
  try {
    const last = Number(sessionStorage.getItem(ATTEMPTED) ?? '0')
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(ATTEMPTED, String(Date.now()))
  } catch {
    // Private browsing, blocked site data. Without somewhere to record the attempt there is
    // nothing stopping a loop, and a loop is worse than the error page.
    return false
  }

  window.location.reload()
  return true
}

/**
 * A new build has taken over, so show it.
 *
 * The preload guard above catches one kind of staleness: a tab that was open across a deploy
 * and reaches for a chunk that no longer exists. It cannot catch the other kind, which is the
 * common one. The service worker precaches the whole shell, so a returning visitor is served a
 * complete and self-consistent copy of the build they saw last time. Nothing 404s, nothing
 * errors, and the page simply renders yesterday's product on top of today's deploy.
 *
 * `autoUpdate` installs the new worker and claims the page, which fires `controllerchange`.
 * That is the signal that the assets underneath have changed, and a single guarded reload is
 * what turns it into the new build being on screen.
 *
 * Call it once, at start-up. The guard in `recoverFromStaleDeploy` is what stops a worker that
 * claims repeatedly from putting the page in a loop.
 */
export function reloadWhenWorkerTakesOver(): void {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    /*
     * Only when there was already a worker. The first registration on a first visit also fires
     * this, and reloading somebody the instant they arrive is a worse bug than the one being
     * fixed: they asked for the page, they are looking at the page, nothing is stale.
     */
    if (!hadController) return
    recoverFromStaleDeploy()
  })
}

/** Whether this page was being served by a worker when it started. */
const hadController =
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  navigator.serviceWorker.controller !== null
