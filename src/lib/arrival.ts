/**
 * Where somebody came in from (§44).
 *
 * A QR on a slide, a link in a message and a poster in a corridor can each carry `?src=`, and
 * the console's "where they came from" list is only as good as what reaches the server on the
 * first start. The parameter can sit in either of two places, because the address is a hash
 * route: `/?src=qr#/` is what a printed code encodes, and `/#/?src=qr` is what React
 * Router's own search params see. Both are read, and both are taken out of the address bar
 * afterwards for the same reason the presenter key is: a parameter that has done its job
 * should not sit there looking like it still might.
 */
const PARAM = 'src'

/** The source, trimmed to the contract's length, or null when the address carries none. */
export function readArrivalSource(): string | null {
  const fromPath = new URLSearchParams(window.location.search).get(PARAM)
  const fromHash = new URLSearchParams(hashQuery()).get(PARAM)
  const raw = (fromPath ?? fromHash ?? '').trim()
  return raw.length === 0 ? null : raw.slice(0, 40)
}

/**
 * Drops `src` from the part of the address before the hash.
 *
 * The hash's own query is React Router's and is stripped through `setSearchParams`, so the
 * route does not remount. This only touches the path's search string, with `replaceState` so
 * the back button does not lead to the parameter.
 */
export function stripArrivalSourceFromPath(): void {
  const params = new URLSearchParams(window.location.search)
  if (!params.has(PARAM)) return
  params.delete(PARAM)
  const search = params.toString()
  const next = `${window.location.pathname}${search.length === 0 ? '' : `?${search}`}${window.location.hash}`
  window.history.replaceState(window.history.state, '', next)
}

function hashQuery(): string {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return at === -1 ? '' : hash.slice(at + 1)
}
