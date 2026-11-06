import { z } from 'zod'
import { saoiApiUrl } from '@/lib/env'
import {
  listCasesResponseSchema,
  sessionResponseSchema,
  type SessionRequest,
} from '@contracts/session.ts'
import { partnerViewSchema, type PartnerRequest } from '@contracts/partner.ts'
import { caseActionResponseSchema, type CaseActionRequest } from '@contracts/case-action.ts'
import type { AdminRequest } from '@contracts/admin.ts'
import { supabase } from '@/lib/supabase'
import {
  caseFeedReadySchema,
  caseFeedUpdateSchema,
  caseHistorySchema,
  caseSnapshotSchema,
  type CaseFeedReady,
  type CaseFeedUpdate,
  type CaseHistory,
  type CaseSnapshot,
} from '@contracts/case-read.ts'

/**
 * The client for `saoi-api` (`services/api`).
 *
 * `fetch` with the Supabase access token as a bearer, which the service verifies.
 * Every response is parsed against the schema the service declares in its OpenAPI document, so
 * a drifting server is a loud error here and not a half-rendered card.
 */

async function accessToken(): Promise<string> {
  const session = await supabase?.auth.getSession()
  const token = session?.data.session?.access_token
  if (!token) throw new Error('Not signed in.')
  return token
}

export class SaoiApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SaoiApiError'
    this.status = status
  }
}

async function failure(response: Response): Promise<SaoiApiError> {
  let message = 'Saoirse is unavailable right now.'
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // The generic message stands.
  }
  return new SaoiApiError(response.status, message)
}

async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const response = await fetch(`${saoiApiUrl}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw await failure(response)
  return schema.parse(await response.json())
}

/**
 * A write (or a read that carries a header). The body is JSON unless it is a `FormData`, in
 * which case the browser sets the multipart boundary itself.
 */
async function sendJson<T extends z.ZodType>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  schema: T,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<z.infer<T>> {
  const isForm = options.body instanceof FormData
  const response = await fetch(`${saoiApiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(options.body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined
      ? {}
      : { body: isForm ? (options.body as FormData) : JSON.stringify(options.body) }),
  })
  if (!response.ok) throw await failure(response)
  return schema.parse(await response.json())
}

const caseUrl = (caseId: string, leaf: string) => `/api/cases/${encodeURIComponent(caseId)}/${leaf}`

export function fetchCaseSnapshot(caseId: string): Promise<CaseSnapshot> {
  return getJson(caseUrl(caseId, 'snapshot'), caseSnapshotSchema)
}

export function fetchCaseHistory(caseId: string): Promise<CaseHistory> {
  return getJson(caseUrl(caseId, 'history'), caseHistorySchema)
}

const e = encodeURIComponent
const anything = z.unknown()

/**
 * The `admin` Edge Function's actions, each sent to its own resource route under
 * `/api/admin`. Takes the same request the function does and returns the same payload (minus
 * the envelope), so `adminClient` does not care which it is talking to. Destructive actions
 * send `confirm: true`, which the service requires; `reset_case` needs its case id.
 */
export function callAdminApi(request: AdminRequest): Promise<unknown> {
  const get = (path: string) => sendJson('GET', path, anything)
  const send = (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
    sendJson(method, path, anything, body === undefined ? {} : { body })
  const rest = <T extends { action: string }>(r: T): Omit<T, 'action'> => {
    const { action: _action, ...body } = r
    return body
  }
  switch (request.action) {
    case 'overview': {
      const query = new URLSearchParams({ period: request.period })
      if (request.caseId !== undefined) query.set('caseId', request.caseId)
      return get(`/api/admin/overview?${query.toString()}`)
    }
    case 'analytics':
      return get(`/api/admin/analytics?period=${request.period}`)
    case 'list_feedback':
      return get(`/api/admin/feedback?period=${request.period}`)
    case 'list_collaborators':
      return get('/api/admin/collaborators')
    case 'inspect_case':
      return get(`/api/admin/cases/${e(request.caseId)}`)
    case 'reset_case':
      if (request.caseId === undefined) {
        return Promise.reject(new Error('Choose a case to rebuild.'))
      }
      return send('POST', '/api/admin/cases/reset', { caseId: request.caseId, confirm: true })
    case 'delete_case':
      return send('DELETE', `/api/admin/cases/${e(request.caseId)}`, { confirm: true })
    case 'purge_cases':
      return send('POST', '/api/admin/cases/purge', { confirm: true })
    case 'tag_test_case':
      return send('POST', `/api/admin/cases/${e(request.caseId)}/tag-test`)
    case 'simulate_event': {
      const { applicationId, ...body } = rest(request)
      return send('POST', `/api/admin/applications/${e(applicationId)}/events`, body)
    }
    case 'reach_savings_target':
      return send('POST', `/api/admin/cases/${e(request.caseId)}/savings-target/reach`)
    case 'set_savings_balance':
      return send('PUT', `/api/admin/cases/${e(request.caseId)}/savings-balance`, {
        amount: request.amount,
      })
    case 'plan_move':
      return send(
        'POST',
        `/api/admin/cases/${e(request.caseId)}/plans/${e(request.planId)}/moves`,
        { move: request.move },
      )
    case 'verify_documents':
      return send('POST', `/api/admin/cases/${e(request.caseId)}/documents/verify`)
    case 'demo_action':
      return send('POST', `/api/admin/cases/${e(request.caseId)}/demo-actions`, {
        move: request.move,
      })
    case 'settle_transfer':
      return send('POST', `/api/admin/transfers/${e(request.transferId)}/settle`)
    case 'send_notification': {
      const { caseId, ...body } = rest(request)
      return send('POST', `/api/admin/cases/${e(caseId)}/notifications`, body)
    }
    case 'set_kill_switch':
      return send('PUT', '/api/admin/kill-switch', { enabled: request.enabled })
    case 'set_persona':
      return send('PUT', '/api/admin/persona', rest(request))
    case 'preview_persona':
      return send('POST', '/api/admin/persona/preview', rest(request))
    case 'test_guardrail':
      return send('POST', '/api/admin/guardrails/test', { message: request.message })
    case 'list_products':
      return get('/api/admin/products')
    case 'set_product':
      return send('PUT', `/api/admin/products/${e(request.id)}`, {
        product: request.product,
        enabled: request.enabled,
      })
    case 'delete_product':
      return send('DELETE', `/api/admin/products/${e(request.id)}`)
    case 'load_published_products':
      return send('POST', '/api/admin/products/load-published')
    case 'restore_published_product':
      return send('POST', `/api/admin/products/${e(request.id)}/restore`)
    case 'list_rates':
      return get('/api/admin/rates')
    case 'set_rate':
      return send('PUT', `/api/admin/rates/${e(request.id)}`, {
        rate: request.rate,
        enabled: request.enabled,
      })
    case 'delete_rate':
      return send('DELETE', `/api/admin/rates/${e(request.id)}`)
    case 'load_published_rates':
      return send('POST', '/api/admin/rates/load-published')
    case 'restore_published_rate':
      return send('POST', `/api/admin/rates/${e(request.id)}/restore`)
    case 'catalogue_overrides':
      return get('/api/admin/catalogue-overrides')
    case 'set_catalogue_override': {
      const { kind, entryId, ...body } = rest(request)
      return send('PUT', `/api/admin/catalogue-overrides/${e(kind)}/${e(entryId)}`, body)
    }
    case 'clear_catalogue_override':
      return send(
        'DELETE',
        `/api/admin/catalogue-overrides/${e(request.kind)}/${e(request.entryId)}`,
      )
    case 'list_form_applications':
      return get('/api/admin/form-applications')
    case 'inspect_form_application':
      return get(`/api/admin/form-applications/${e(request.formApplicationId)}`)
    case 'rebuild_form_applications':
      return send('POST', '/api/admin/form-applications/rebuild')
    default:
      return assertNever(request)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled admin action: ${JSON.stringify(value)}`)
}

const registeredSchema = z.object({ registered: z.literal(true) })
const uploadedSchema = z.object({ fileName: z.string() }).loose()

/**
 * The `session` Edge Function's actions, each sent to its own route. Takes the same request the
 * function does and returns the same payload, so `lib/session.ts` does not care which it is
 * talking to. The presenter key travels in a header here, not in the body.
 */
export function callSessionApi(request: SessionRequest): Promise<unknown> {
  switch (request.action) {
    case 'start': {
      const { action: _action, ...body } = request
      return sendJson('POST', '/api/sessions', sessionResponseSchema, { body })
    }
    case 'new_case':
      return sendJson('POST', '/api/cases', sessionResponseSchema, { body: { mode: request.mode } })
    case 'list_cases':
      return sendJson('GET', '/api/cases', listCasesResponseSchema, {
        headers: presenterHeader(request.presenterKey),
      })
    case 'switch_case':
      return sendJson('POST', caseUrl(request.caseId, 'switch'), sessionResponseSchema, {
        headers: presenterHeader(request.presenterKey),
      })
    case 'claim_participant':
      return sendJson('POST', '/api/sessions/claim', sessionResponseSchema, {
        body: { priorAuthUserId: request.priorAuthUserId },
      })
    case 'register_interest': {
      const { action: _action, ...body } = request
      return sendJson('POST', '/api/interest', registeredSchema, { body })
    }
  }
}

const presenterHeader = (key: string | undefined): Record<string, string> =>
  key === undefined ? {} : { 'X-Presenter-Key': key }

/** The `partner` Edge Function's actions, one route each. Returns the partner's view. */
export function callPartnerApi(request: PartnerRequest): Promise<unknown> {
  switch (request.action) {
    case 'join':
      return sendJson('POST', '/api/partner/join', partnerViewSchema, {
        body: { token: request.token },
      })
    case 'tasks':
      return sendJson('GET', '/api/partner/tasks', partnerViewSchema)
    case 'submit':
      return sendJson('POST', '/api/partner/submit', partnerViewSchema, {
        body: { answers: request.answers },
      })
  }
}

const subscribedSchema = z.object({ subscribed: z.literal(true) })

/**
 * The `case-action` Edge Function's actions, each sent to its resource route. Takes the same
 * request the function does and returns the same payload (minus the envelope), so
 * `lib/caseActions.ts` does not care which it is talking to. The caller's role is enforced by
 * the server's policy table, not here: a partner's browser gets a 403 for every one of these.
 */
export function callCaseActionApi(
  request: CaseActionRequest,
  /** The open case, for the actions that name an application and not a case. */
  openCaseId?: string,
): Promise<unknown> {
  const post = (caseId: string, leaf: string, body?: unknown) =>
    sendJson('POST', caseUrl(caseId, leaf), caseActionResponseSchema, {
      body: body ?? {},
    })
  // The Edge Function found the case from the application; the route is addressed by both.
  const onApplication = (applicationId: string, leaf: string, body?: unknown) => {
    if (openCaseId === undefined) {
      return Promise.reject(new Error('Which conversation is this for?'))
    }
    return post(openCaseId, `applications/${encodeURIComponent(applicationId)}/${leaf}`, body)
  }

  switch (request.action) {
    case 'select_products':
      return post(request.caseId, 'products/select', { products: request.products })
    case 'decline_product':
      return post(request.caseId, `products/${encodeURIComponent(request.product)}/decline`)
    case 'confirm_requirement':
      return onApplication(request.applicationId, 'confirm', {
        requirementId: request.requirementId,
      })
    case 'submit_application':
      return onApplication(request.applicationId, 'submit', {
        confirmations: request.confirmations,
      })
    case 'pause_application':
      return onApplication(request.applicationId, 'pause')
    case 'resume_application':
      return onApplication(request.applicationId, 'resume')
    case 'decide_plan':
      return post(request.caseId, `plans/${encodeURIComponent(request.planId)}/decisions`, {
        decision: request.decision,
      })
    case 'invite_partner':
      return post(request.caseId, 'invites', { name: request.name })
    case 'subscribe_push':
      return sendJson('POST', caseUrl(request.caseId, 'push-subscriptions'), subscribedSchema, {
        body: { endpoint: request.endpoint, p256dh: request.p256dh, auth: request.auth },
      })
    case 'grant_consent':
      return onApplication(request.applicationId, 'consent', {
        requirementId: request.requirementId,
      })
    case 'confirm_form_declarations':
      return onApplication(request.applicationId, 'form-declarations', {
        fieldIds: request.fieldIds,
      })
    case 'submit_health_form':
      return onApplication(request.applicationId, 'health-answers', {
        values: request.values,
      })
    case 'link_accounts':
      return post(request.caseId, 'linked-accounts', { bank: request.bank, scope: request.scope })
    case 'revoke_accounts':
      return post(request.caseId, 'linked-accounts/revoke')
    case 'initiate_transfer':
      return post(request.caseId, 'transfers', {
        fromAccountId: request.fromAccountId,
        toApplicationId: request.toApplicationId,
        amount: request.amount,
        cadence: request.cadence,
      })
    case 'give_feedback': {
      const { action: _action, caseId, ...body } = request
      return post(caseId, 'feedback', body)
    }
  }
}

/** `upload`: a multipart body addressed to the case. */
export function uploadDocumentApi(caseId: string, form: FormData): Promise<unknown> {
  return sendJson('POST', caseUrl(caseId, 'documents'), uploadedSchema, { body: form })
}

export type CaseFeedHandlers = {
  /** On every (re)connect: the newest narratable event, for a baseline. */
  readonly onReady: (ready: CaseFeedReady) => void
  readonly onUpdate: (update: CaseFeedUpdate) => void
}

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000

/**
 * Follows the change feed until `signal` aborts, reconnecting with backoff and `Last-Event-ID`.
 *
 * `fetch` rather than `EventSource`, which cannot send the Authorization header. Resolves when
 * aborted. A 401 or 404 is not retried: nothing a retry does changes it.
 */
export async function followCaseFeed(
  caseId: string,
  handlers: CaseFeedHandlers,
  signal: AbortSignal,
): Promise<void> {
  let lastEventId: string | undefined
  let delay = RETRY_MIN_MS

  while (!signal.aborted) {
    try {
      const response = await fetch(`${saoiApiUrl}${caseUrl(caseId, 'events')}`, {
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          Accept: 'text/event-stream',
          ...(lastEventId === undefined ? {} : { 'Last-Event-ID': lastEventId }),
        },
        signal,
      })
      if (!response.ok || !response.body) {
        throw await failure(response)
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += value.replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = parseFrame(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
          if (frame === null) continue

          delay = RETRY_MIN_MS
          dispatch(frame, handlers, (id) => {
            lastEventId = id
          })
        }
      }
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof SaoiApiError && (error.status === 401 || error.status === 404)) return
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
}

type Frame = { readonly event: string; readonly data: string; readonly id?: string }

/** One SSE frame. Comment lines (the keep-alive) and frames without data are `null`. */
function parseFrame(text: string): Frame | null {
  let event = 'message'
  let id: string | undefined
  const data: string[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    else if (field === 'id') id = value
  }
  if (data.length === 0) return null
  return { event, data: data.join('\n'), ...(id === undefined ? {} : { id }) }
}

function dispatch(frame: Frame, handlers: CaseFeedHandlers, remember: (id: string) => void): void {
  try {
    const payload: unknown = JSON.parse(frame.data)
    if (frame.event === 'ready') {
      handlers.onReady(caseFeedReadySchema.parse(payload))
    } else if (frame.event === 'update') {
      const update = caseFeedUpdateSchema.parse(payload)
      if (frame.id !== undefined) remember(frame.id)
      handlers.onUpdate(update)
    }
  } catch {
    // A frame that does not parse is dropped; the next one is unaffected.
  }
}
