/*
 * Web Push handlers, pulled into the generated service worker.
 *
 * A separate file imported through `workbox.importScripts` rather than a hand-written service
 * worker, because the generated one already does work that is easy to break and expensive to
 * discover broken: precaching the shell, the navigation fallback, never caching the API, and
 * the cleanup that stops a deploy stranding an open page. Swapping it for a bespoke one to add
 * two event listeners would put all of that at risk for no gain.
 *
 * Plain JavaScript because it is shipped from `public/` as-is — nothing compiles it, so there
 * is nothing to typecheck it either. It is kept to the two handlers for that reason.
 */

self.addEventListener('push', (event) => {
  /*
   * A push with no readable payload still shows something.
   *
   * Push services are allowed to wake a worker with no data, and some browsers will show a
   * generic "This site has been updated in the background" if a push event resolves without a
   * notification. A deliberate fallback is better than that.
   */
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'Saoirse'
  const base = self.registration.scope

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'There is an update waiting for you.',
      icon: new URL('icons/icon-192.png', base).href,
      badge: new URL('icons/icon-192.png', base).href,
      // One tag, so a second update replaces the first rather than stacking. Somebody coming
      // back to four identical notifications learns to ignore them.
      tag: 'saoi-update',
      renotify: true,
      data: { url: payload.url || base },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope

  event.waitUntil(
    (async () => {
      // Focus a tab that is already open rather than opening a second one, which is how
      // somebody ends up with the same conversation in two windows disagreeing with itself.
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of open) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          await client.navigate(target).catch(() => undefined)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })(),
  )
})
