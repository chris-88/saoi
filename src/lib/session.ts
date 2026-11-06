import { requireSupabase } from '@/lib/supabase'
import { callSessionApi } from '@/lib/saoiApi'
import {
  listCasesResponseSchema,
  sessionResponseSchema,
  type ListCasesResponse,
  type SessionRequest,
  type SessionResponse,
} from '@contracts/session.ts'

/** The registration as the contract defines it, without the discriminator the client adds. */
export type RegisterInterest = Omit<
  Extract<SessionRequest, { action: 'register_interest' }>,
  'action'
>

/**
 * Every visitor gets an anonymous Supabase user, which `session` then maps to a participant
 * on a case (§12, §28). The anonymous user persists in browser storage, so returning to the
 * tab returns to the same conversation.
 */
/**
 * One sign-in at a time.
 *
 * Two callers on first load both found no session and both created an anonymous user, a
 * millisecond apart, and each then started a case of its own: pairs of empty cases a quarter
 * of a second apart, all through the morning, each pair one visitor and two of the audience
 * cap. The second caller now waits for the first.
 */
let signingIn: Promise<string> | null = null

export async function ensureAnonymousUser(): Promise<string> {
  const supabase = requireSupabase()

  const existing = await supabase.auth.getSession()
  if (existing.data.session) return existing.data.session.access_token

  if (signingIn === null) {
    signingIn = supabase.auth
      .signInAnonymously()
      .then((created) => {
        if (created.error || !created.data.session) {
          throw new Error(created.error?.message ?? 'Could not start a session.')
        }
        return created.data.session.access_token
      })
      .finally(() => {
        signingIn = null
      })
  }
  return signingIn
}

/**
 * Whether the server is telling us this browser's user no longer exists.
 *
 * A JWT outlives the user it was minted for. Purging the project's auth users leaves every
 * open tab holding a token that parses, passes every local check, and is refused by the
 * server — and `getSession()` reads storage rather than asking, so the client has no idea.
 */
function sessionIsStale(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no session|unauthoris|unauthoriz|user.*not found|jwt|invalid token/i.test(message)
}

/** One request to saoi-api. */
function send(body: SessionRequest): Promise<unknown> {
  return callSessionApi(body)
}

async function invoke(body: SessionRequest): Promise<unknown> {
  await ensureAnonymousUser()
  try {
    return await send(body)
  } catch (error) {
    if (!sessionIsStale(error)) throw error

    /*
     * Start again as somebody new rather than leaving them on a dead session.
     *
     * Without this, a purge — or a user deleted for any other reason — leaves anybody with the
     * tab still open on a screen that can never recover, because every call fails and nothing
     * clears the token that is causing it. Once only: if a fresh anonymous user is also
     * refused, the problem is not the token.
     */
    const supabase = requireSupabase()
    await supabase.auth.signOut().catch(() => undefined)
    await ensureAnonymousUser()
    return await send(body)
  }
}

/**
 * `source` is where they came in from, when the address said (§44). Sent on the first start
 * only: the server keeps it against the case it creates, and a re-run of `start` after a
 * sign-in or a reset is the same person, not a second arrival.
 */
export async function startSession(
  mode: 'new' | 'known' = 'new',
  source?: string | null,
): Promise<SessionResponse> {
  return sessionResponseSchema.parse(
    await invoke({
      action: 'start',
      mode,
      ...(source === undefined || source === null ? {} : { source }),
    }),
  )
}

/**
 * Somebody who wants to work on this (§44).
 *
 * Goes through `session` because that is the one function an anonymous visitor can already
 * reach, and the public pages have no case to hang it on. The server's own message comes back
 * on a refusal, so the form can say "too many today" or "that looked automated" in the
 * server's words rather than guessing.
 */
export async function registerInterest(input: RegisterInterest): Promise<void> {
  await invoke({ action: 'register_interest', ...input })
}

/**
 * The presenter key, kept on the device rather than in the URL.
 *
 * Arrives once as `?presenter=…`, is stored, and the parameter is dropped from the address bar
 * — a key that lives in the URL is a key in every screenshot, every screen share and every
 * browser history on the machine. Without it the switcher lists only this browser's own
 * conversations, which is what a visitor should see.
 */
const PRESENTER_STORAGE_KEY = 'saoi.presenterKey'

export function rememberPresenterKey(key: string): void {
  try {
    window.localStorage.setItem(PRESENTER_STORAGE_KEY, key)
  } catch {
    // Private browsing, or storage disabled. The menu simply stays on the visitor's own list.
  }
}

export function presenterKey(): string | undefined {
  try {
    return window.localStorage.getItem(PRESENTER_STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function forgetPresenterKey(): void {
  try {
    window.localStorage.removeItem(PRESENTER_STORAGE_KEY)
  } catch {
    // Nothing to forget if it could never be stored.
  }
}

export async function listCases(): Promise<ListCasesResponse> {
  const key = presenterKey()
  return listCasesResponseSchema.parse(
    await invoke({ action: 'list_cases', ...(key === undefined ? {} : { presenterKey: key }) }),
  )
}

export async function switchCase(caseId: string): Promise<SessionResponse> {
  const key = presenterKey()
  return sessionResponseSchema.parse(
    await invoke({
      action: 'switch_case',
      caseId,
      ...(key === undefined ? {} : { presenterKey: key }),
    }),
  )
}

export async function startNewCase(mode: 'new' | 'known' = 'new'): Promise<SessionResponse> {
  return sessionResponseSchema.parse(await invoke({ action: 'new_case', mode }))
}

/**
 * Who this browser was before it signed in.
 *
 * Written before the identity changes and read after, because afterwards there is no way to
 * find out: the anonymous user is simply gone from the client's point of view, and with it the
 * only link to the conversation it was holding. Local storage is the right place for exactly
 * one reason — it survives leaving for the inbox and coming back, which a variable does not.
 */
const PRIOR_USER_KEY = 'saoi.priorAuthUser'

export function rememberPriorUser(authUserId: string): void {
  try {
    window.localStorage.setItem(PRIOR_USER_KEY, authUserId)
  } catch {
    // Private browsing. The claim is skipped and the sign-in still works; what is lost is the
    // conversation following them, which is the thing worth logging if this ever matters.
  }
}

/**
 * Move the conversation onto whoever this browser is now.
 *
 * Safe to call on every sign-in and deliberately quiet about failing. The common case is that
 * the auth id never changed and there is nothing to do; the case this exists for is the one
 * where it did, and a visitor who has just signed in should not be shown an error about
 * plumbing. Returns the session when something was carried over, so the caller can refresh.
 */
export async function claimPriorConversation(): Promise<SessionResponse | null> {
  const prior = ((): string | null => {
    try {
      return window.localStorage.getItem(PRIOR_USER_KEY)
    } catch {
      return null
    }
  })()

  if (prior === null) return null

  try {
    const response = sessionResponseSchema.parse(
      await invoke({ action: 'claim_participant', priorAuthUserId: prior }),
    )
    try {
      window.localStorage.removeItem(PRIOR_USER_KEY)
    } catch {
      // Harmless: claiming the same participant twice is an upsert.
    }
    return response
  } catch (error) {
    console.warn('could not carry the conversation over:', error)
    return null
  }
}
