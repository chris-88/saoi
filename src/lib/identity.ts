import * as Sentry from '@sentry/react'
import { requireSupabase, supabase } from '@/lib/supabase'
import { claimPriorConversation, rememberPriorUser } from '@/lib/session'

/**
 * Signing in, so the conversation follows the person rather than the browser.
 *
 * Every visitor already has an anonymous Supabase user, and `participant_sessions` maps that
 * user to their participant on a case. The good path **attaches** an identity to the anonymous
 * user that is already there: `auth.uid()` does not change, so the case, the conversation, the
 * applications and every fact carry over with nothing to move and nothing to reconcile.
 *
 * It was once believed that was the only path, and it is not. Attaching fails whenever the
 * address already belongs to a user — a second device, or anybody signing in twice — and the
 * fall-through signs them into that account instead. Different
 * `auth.uid()`, no mapping, and a conversation that has disappeared at the precise moment it
 * was meant to be made safe. A live case was orphaned exactly this way.
 *
 * So both paths note who this browser was before they begin, and both claim the participant
 * afterwards. `participant_sessions` is many-to-one by design, which is the same fact wearing
 * a different hat: one person, several auth users, one conversation.
 */

export type Identity = {
  /** True while they are still just a browser. */
  readonly anonymous: boolean
  readonly email: string | null
  readonly name: string | null
  readonly avatarUrl: string | null
}

export const ANONYMOUS: Identity = {
  anonymous: true,
  email: null,
  name: null,
  avatarUrl: null,
}

function readMetadata(
  metadata: Record<string, unknown>,
  ...keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

/** Who is signed in, as far as the browser knows. */
export async function currentIdentity(): Promise<Identity> {
  if (!supabase) return ANONYMOUS
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return ANONYMOUS

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  return {
    // `is_anonymous` is the only reliable signal: an anonymous user still has an id and a JWT.
    anonymous: user.is_anonymous === true,
    email: user.email ?? null,
    name: readMetadata(metadata, 'full_name', 'name'),
    avatarUrl: readMetadata(metadata, 'avatar_url', 'picture'),
  }
}

/**
 * Where the link in the email comes back to.
 *
 * Deliberately the bare origin and base path, with no fragment. Supabase appends `?code=…` to
 * whatever this is, and appending a query to a URL that already has a `#/` on the end
 * produces something neither the router nor the exchange can read.
 */
function returnTo(): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}`
}

/**
 * The route to put them back on afterwards.
 *
 * `returnTo` has to be a bare origin, because Supabase appends `?code=` and a URL that already
 * ends in `#/` cannot take a query string. That lost the route: signing in from the middle
 * of a conversation returned them to the front page, which reads exactly like being logged out.
 * The route is kept here across the redirect and restored once the code is redeemed.
 */
const ROUTE_KEY = 'saoi.signInReturnRoute'

function rememberRoute(): void {
  try {
    window.localStorage.setItem(ROUTE_KEY, window.location.hash || '#/')
  } catch {
    // Storage blocked. They land on the front page, which is the old behaviour, not a failure.
  }
}

/**
 * Where to land after signing in.
 *
 * The remembered route when there is one, and the conversation otherwise. The fallback is not
 * a nicety: a magic link is opened from an email client, frequently in a different browser or
 * an in-app webview, so the tab that stored the route is not the tab that comes back. Without
 * a default that lands somebody on the front page — which, having just signed in, reads as
 * having been signed out.
 */
function restoreRoute(): void {
  let route: string | null = null
  try {
    route = window.localStorage.getItem(ROUTE_KEY)
    window.localStorage.removeItem(ROUTE_KEY)
  } catch {
    // No storage; the fallback below is the whole point.
  }

  window.location.hash = route?.startsWith('#/') === true ? route : '#/'
}

/**
 * That a sign-in has just happened, for the screen that loads next.
 *
 * Signing in ends in a reload, which is the simplest way to land in a live session, and a
 * reload is also how the moment gets lost: the conversation came back with "Signed in" under
 * the card and Saoirse saying nothing at all. The customer had just handed over an address and got
 * silence.
 *
 * Session storage rather than local: it is about this tab, right now, and it must not survive
 * into a later visit and greet somebody twice.
 */
const JUST_SIGNED_IN_KEY = 'saoi.justSignedIn'

export function noteSignedInMoment(): void {
  try {
    window.sessionStorage.setItem(JUST_SIGNED_IN_KEY, '1')
  } catch {
    // No storage, so no greeting. The conversation still works.
  }
}

/** Reads it and clears it, so the greeting happens once however many times this mounts. */
export function takeSignedInMoment(): boolean {
  try {
    const found = window.sessionStorage.getItem(JUST_SIGNED_IN_KEY) === '1'
    if (found) window.sessionStorage.removeItem(JUST_SIGNED_IN_KEY)
    return found
  } catch {
    return false
  }
}

/**
 * The address this browser last signed in with.
 *
 * The one piece of continuity a browser can offer, and it is worth being exact about how
 * little it does. It cannot help on a new device, because nothing stored here exists there.
 * What it does is turn the same-browser case — storage cleared, session expired, the installed
 * app opened for the first time — from "type your address again" into one tap.
 *
 * Stored only after a sign-in actually succeeded, so a typo never sticks, and never displayed
 * in full: `maskedAddress` is what goes on screen, and `forgetKnownAddress` is wired to a
 * "not me" beside it. A demo device gets passed around, and the next person should be able to
 * get rid of it without signing in as somebody else first.
 */
const KNOWN_ADDRESS_KEY = 'saoi.knownAddress'

export function rememberKnownAddress(address: string): void {
  const trimmed = address.trim()
  if (trimmed.length === 0) return
  try {
    window.localStorage.setItem(KNOWN_ADDRESS_KEY, trimmed)
  } catch {
    // Private browsing. The prompt simply does not appear and the menu still works.
  }
}

export function lastKnownAddress(): string | null {
  try {
    const stored = window.localStorage.getItem(KNOWN_ADDRESS_KEY)
    return stored === null || stored.trim().length === 0 ? null : stored
  } catch {
    return null
  }
}

export function forgetKnownAddress(): void {
  try {
    window.localStorage.removeItem(KNOWN_ADDRESS_KEY)
  } catch {
    // Nothing to forget if it could never be stored.
  }
}

/**
 * Enough of an address to recognise your own, and not enough to read somebody else's.
 *
 * The first character and the domain. `t•••@chrisquinn.ie` is unmistakable to the person it
 * belongs to and close to useless to anybody else, which is the whole requirement.
 */
export function maskedAddress(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) return '•••'
  const local = address.slice(0, at)
  const first = local.slice(0, 1)
  return `${first}•••${address.slice(at)}`
}

/**
 * Note the address off the live session, once signing in has worked.
 *
 * Read from the session rather than from the field they typed: the link path never had a field,
 * and the address on the account is the one that will work next time.
 */
async function noteSignedInAddress(): Promise<void> {
  if (!supabase) return
  try {
    const { data } = await supabase.auth.getUser()
    const address = data.user?.email
    if (typeof address === 'string') rememberKnownAddress(address)
  } catch {
    // Not worth failing a sign-in over.
  }
}

/**
 * Why the last attempt failed, left for whatever is on screen next.
 *
 * A sign-in that fails on the way back from the inbox fails before React mounts, so there is
 * no component to hand the reason to. Session storage rather than local: it is about this
 * attempt, in this tab, and it should not outlive either.
 */
const FAILURE_KEY = 'saoi.signInError'

export function lastSignInError(): string | null {
  try {
    return window.sessionStorage.getItem(FAILURE_KEY)
  } catch {
    return null
  }
}

/** Cleared when they try again, rather than by reading it — see the card for why. */
export function clearSignInError(): void {
  try {
    window.sessionStorage.removeItem(FAILURE_KEY)
  } catch {
    // Nothing stored it in the first place.
  }
}

function rememberFailure(message: string): void {
  try {
    window.sessionStorage.setItem(FAILURE_KEY, message)
  } catch {
    // Nothing to remember it with. The console still has it.
  }
}

/**
 * A session handed back in the URL fragment rather than as a code.
 *
 * `updateUser` creates no PKCE verifier, so the link in a confirmation email comes back the
 * other way: `#access_token=…&refresh_token=…`. That is also
 * exactly where this app keeps its route, so without this the router is handed a pile of token
 * parameters, nothing reads the session, and somebody who just clicked "Open Saoirse" lands on the
 * front page signed out. Which is what happened.
 */
async function sessionFromFragment(): Promise<'none' | 'ok' | 'failed'> {
  if (!supabase) return 'none'

  const raw = window.location.hash.replace(/^#/, '')
  // A route, not a token payload. `#/` has no `=` in it.
  if (!raw.includes('access_token=')) return 'none'

  const fragment = new URLSearchParams(raw)
  const access_token = fragment.get('access_token')
  const refresh_token = fragment.get('refresh_token')
  if (access_token === null || refresh_token === null) return 'failed'

  const { error } = await supabase.auth.setSession({ access_token, refresh_token })

  // Out of the address bar and out of the history either way: these are credentials.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  if (error) {
    console.error('sign-in from the email link failed:', error.message)
    rememberFailure(error.message)
    return 'failed'
  }
  return 'ok'
}

export async function completeSignIn(): Promise<{ signedIn: boolean; error?: string }> {
  if (!supabase) return { signedIn: false }

  /*
   * A link from the inbox comes back one of two ways, and both are email.
   *
   * `updateUser` is not a PKCE flow, so its confirmation hands the session back in the
   * fragment. `signInWithOtp` is, so its link comes back as `?code=`. Both have to work,
   * because which one a person gets depends on whether the address was already known.
   *
   * Routed on either outcome. Somebody who followed a link from their inbox should end up in
   * the conversation whether or not the token in it was still good, because the alternative is
   * the front page, which is indistinguishable from having been signed out.
   */
  const fromFragment = await sessionFromFragment()
  if (fromFragment !== 'none') {
    if (fromFragment === 'ok') {
      await noteSignedInAddress()
      await claimPriorConversation()
    }
    restoreRoute()
    return { signedIn: fromFragment === 'ok' }
  }

  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const refusal = params.get('error_description') ?? params.get('error')

  if (code === null && refusal === null) return { signedIn: false }

  const clean = () => {
    params.delete('code')
    params.delete('error')
    params.delete('error_description')
    params.delete('state')
    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', url)
  }

  if (code === null) {
    clean()
    console.error('sign-in refused:', refusal)
    if (refusal !== null) rememberFailure(refusal)
    restoreRoute()
    return { signedIn: false, ...(refusal === null ? {} : { error: refusal }) }
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  clean()
  restoreRoute()
  if (!error) {
    await noteSignedInAddress()
    await claimPriorConversation()
  }
  if (error) {
    console.error('sign-in exchange failed:', error.message)
    rememberFailure(error.message)
  }
  return error ? { signedIn: false, error: error.message } : { signedIn: true }
}

/**
 * Sign out, and get a fresh anonymous user.
 *
 * Without the second half they would be left with no session at all, which every read and
 * every Edge Function treats as "no session" rather than "a visitor" — a blank screen with no
 * way back. Signing out of Saoirse means becoming a stranger again, not becoming nobody.
 */
export async function signOutIdentity(): Promise<void> {
  const client = requireSupabase()
  // Signing out is the clearest possible "not me", so the remembered address goes with it.
  forgetKnownAddress()
  await client.auth.signOut()
  await client.auth.signInAnonymously()
}

/**
 * Send an address the code, and the link beside it.
 *
 * An anonymous visitor is CONVERTED rather than replaced, so the conversation they are in the
 * middle of survives: `updateUser` attaches the address to the user that already exists and
 * keeps `auth.uid()`. `signInWithOtp` creates or finds a separate one, which is right only
 * when the address already has an account — and when it does, the claim carries the
 * conversation across.
 *
 * It supplies no name, so Saoirse cannot promise to fill anything in on the strength of it.
 */
/**
 * Which confirmation an address went out as, because verifying needs to know.
 *
 * An anonymous user gets their address attached to the account they already have, which is an
 * `email_change`. Anybody else gets an ordinary sign-in, which is an `email`. Same email, same
 * six digits, different verification type, and getting it wrong is a flat refusal.
 */
const OTP_KIND = 'saoi.signInOtpKind'

function rememberKind(kind: 'email' | 'email_change'): void {
  try {
    window.localStorage.setItem(OTP_KIND, kind)
  } catch {
    // Private browsing. The code path falls back to trying both.
  }
}

/**
 * Sign in with the six digits from the email, without leaving the app.
 *
 * The reason this exists at all. On an installed PWA a magic link opens in the default
 * browser, which is a different storage context with a different session, so the customer
 * watches their conversation disappear and arrives somewhere that looks like being logged out.
 * There is no way to send them back: iOS has no deep link into an installed web app.
 *
 * A code does not have that problem, because nobody goes anywhere. They read six digits in
 * their mail app, come back, and type them where they were already standing.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ ok: boolean; message?: string }> {
  const client = requireSupabase()
  const token = code.replace(/\D/g, '')

  /*
   * Short enough that it cannot be a code at all. Not an exact length.
   *
   * The length is set in the hosted auth config, which this bundle cannot read, and it was on
   * eight while everything here assumed six. Checking for "at least a plausible code" and
   * letting the server decide is the difference between a wrong code and a locked door.
   */
  if (token.length < 6) return { ok: false, message: 'That code looks too short.' }

  let kind: 'email' | 'email_change' = 'email'
  try {
    const stored = window.localStorage.getItem(OTP_KIND)
    if (stored === 'email' || stored === 'email_change') kind = stored
  } catch {
    // Nothing remembered, so try the ordinary one first and the other after.
  }

  const attempt = async (type: 'email' | 'email_change') =>
    await client.auth.verifyOtp({ email: email.trim(), token, type })

  let result = await attempt(kind)

  /*
   * One retry as the other kind.
   *
   * Which one was sent is remembered in storage, and storage is exactly the thing that is
   * missing in a private window or after site data is cleared. Trying the other is cheaper
   * than telling somebody holding a valid code that it is wrong.
   */
  if (result.error) {
    result = await attempt(kind === 'email' ? 'email_change' : 'email')
  }

  if (result.error) {
    return {
      ok: false,
      message: /expired|invalid/i.test(result.error.message)
        ? 'That code has expired or does not match. Send another.'
        : result.error.message,
    }
  }

  /*
   * The conversation follows them, whichever user they ended up as.
   *
   * A no-op when the address was attached to the user already here, which is the ordinary
   * case. It matters when the address already had an account: Supabase signs them into that
   * one, and without this the conversation stays behind on the anonymous user — which is how a
   * live case ended up orphaned while its owner looked at an empty screen.
   */
  await noteSignedInAddress()
  await claimPriorConversation()

  return { ok: true }
}

export async function startEmailSignIn(
  email: string,
): Promise<{ ok: boolean; message?: string; checkInbox?: boolean }> {
  const client = requireSupabase()
  const trimmed = email.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return { ok: false, message: 'That does not look like an email address.' }
  }

  rememberRoute()
  const { data: userData } = await client.auth.getUser()

  // Noted before anything can change it: `signInWithOtp` below may land on a different user.
  if (userData.user) rememberPriorUser(userData.user.id)

  if (userData.user?.is_anonymous === true) {
    // Keeps the conversation: same user, now with an address on it.
    const { error } = await client.auth.updateUser(
      { email: trimmed },
      // A second argument, not an attribute. Without it Supabase falls back to the project's
      // Site URL, which is the front page, and the customer lands there instead of the chat.
      { emailRedirectTo: returnTo() },
    )
    if (!error) {
      rememberKind('email_change')
      return { ok: true, checkInbox: true }
    }
    console.warn('could not attach the address, sending a sign-in link instead:', error.message)
  }

  const { error } = await client.auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: returnTo() },
  })

  if (error) {
    // The code that never arrived used to leave no trace anywhere a person could look: the
    // mailer had not been asked, and the browser had kept the reason to itself. The address
    // stays out of it; the service's own message carries none.
    Sentry.captureMessage('sign-in code could not be sent', {
      level: 'warning',
      tags: { stage: 'otp', code: error.code ?? 'unknown', status: String(error.status ?? '') },
    })
    return { ok: false, message: error.message }
  }

  rememberKind('email')
  return { ok: true, checkInbox: true }
}
