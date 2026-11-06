import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ saoiApiUrl: 'https://api.example.test/saoi' }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
  },
}))

import {
  SaoiApiError,
  callCaseActionApi,
  callPartnerApi,
  callSessionApi,
  fetchCaseHistory,
  fetchCaseSnapshot,
  followCaseFeed,
  uploadDocumentApi,
} from '@/lib/saoiApi'

const CASE = '22222222-2222-4222-8222-222222222222'

const snapshot = {
  caseId: CASE,
  signedIn: true,
  applications: [],
  interests: [],
  plans: [],
  requests: [],
  formAnswers: [],
  reusedBy: { a1: 2 },
  linkedAccounts: [],
  transfers: [],
  notifications: [],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stream(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('saoiApi', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('fetches the snapshot with the bearer token and parses it', async () => {
    fetchMock.mockResolvedValueOnce(json(snapshot))
    const result = await fetchCaseSnapshot(CASE)

    expect(result.reusedBy).toEqual({ a1: 2 })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`https://api.example.test/saoi/api/cases/${CASE}/snapshot`)
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('rejects a response that does not match the contract', async () => {
    fetchMock.mockResolvedValueOnce(json({ caseId: CASE }))
    await expect(fetchCaseSnapshot(CASE)).rejects.toThrow()
  })

  it('surfaces the service error message and status', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ ok: false, error: { code: 'not_found', message: 'That case does not exist.' } }, 404),
    )
    const error = await fetchCaseHistory(CASE).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SaoiApiError)
    expect(error).toMatchObject({ status: 404, message: 'That case does not exist.' })
  })

  it('parses history entries', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        caseId: CASE,
        entries: [
          { kind: 'message', id: 'm1', author: 'assistant', text: 'hello', messageId: 'm1' },
        ],
      }),
    )
    const history = await fetchCaseHistory(CASE)
    expect(history.entries[0]).toMatchObject({ kind: 'message', text: 'hello' })
  })

  describe('followCaseFeed', () => {
    it('hands ready and update frames over, split across chunks, ignoring keep-alives', async () => {
      const controller = new AbortController()
      fetchMock.mockResolvedValueOnce(
        stream([
          `event: ready\ndata: {"caseId":"${CASE}","lat`,
          'est":null}\n\n: keep-alive\n\nid: e9\nevent: update\n',
          'data: {"id":"e9","type":"application_approved","text":"Card was approved.","at":"t"}\n\n',
        ]),
      )
      const ready = vi.fn()
      const update = vi.fn(() => controller.abort())

      await followCaseFeed(CASE, { onReady: ready, onUpdate: update }, controller.signal)

      expect(ready).toHaveBeenCalledWith({ caseId: CASE, latest: null })
      expect(update).toHaveBeenCalledWith({
        id: 'e9',
        type: 'application_approved',
        text: 'Card was approved.',
        at: 't',
      })
    })

    it('reconnects with Last-Event-ID after the stream closes', async () => {
      {
        const controller = new AbortController()
        fetchMock
          .mockResolvedValueOnce(
            stream(['id: e1\nevent: update\ndata: {"id":"e1","type":"t","text":"x","at":"t"}\n\n']),
          )
          .mockImplementationOnce(() => {
            controller.abort()
            return Promise.resolve(stream([]))
          })

        const done = followCaseFeed(
          CASE,
          { onReady: vi.fn(), onUpdate: vi.fn() },
          controller.signal,
        )
        await done

        expect(fetchMock).toHaveBeenCalledTimes(2)
        const second = fetchMock.mock.calls[1]?.[1]
        expect((second?.headers as Record<string, string>)['Last-Event-ID']).toBe('e1')
      }
    })

    it('gives up on a 404 instead of retrying', async () => {
      fetchMock.mockResolvedValueOnce(
        json({ ok: false, error: { code: 'not_found', message: 'nope' } }, 404),
      )
      await followCaseFeed(
        CASE,
        { onReady: vi.fn(), onUpdate: vi.fn() },
        new AbortController().signal,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})

const session = {
  caseId: CASE,
  participantId: '33333333-3333-4333-8333-333333333333',
  role: 'primary',
  authLevel: 'anonymous',
  customerFirstName: null,
  created: true,
  hasUpdates: false,
}

describe('session, partner and upload routes', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) ?? []
    const requestInit = init ?? {}
    return {
      url: typeof url === 'string' ? url : '',
      init: requestInit,
      sent: (): unknown =>
        typeof requestInit.body === 'string' ? JSON.parse(requestInit.body) : undefined,
    }
  }

  it('start goes to POST /api/sessions with the body but not the action', async () => {
    fetchMock.mockResolvedValue(json(session))
    const result = await callSessionApi({ action: 'start', mode: 'known', source: 'qr' })
    expect(result).toMatchObject({ caseId: CASE, created: true })
    const { url, init, sent } = lastCall()
    expect(url).toBe('https://api.example.test/saoi/api/sessions')
    expect(init.method).toBe('POST')
    expect(sent()).toEqual({ mode: 'known', source: 'qr' })
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('new_case goes to POST /api/cases', async () => {
    fetchMock.mockResolvedValue(json(session, 201))
    await callSessionApi({ action: 'new_case', mode: 'new' })
    expect(lastCall().url).toBe('https://api.example.test/saoi/api/cases')
    expect(lastCall().sent()).toEqual({ mode: 'new' })
  })

  it('list_cases is a GET and carries the presenter key in a header, not the body', async () => {
    fetchMock.mockResolvedValue(json({ cases: [], presenter: true }))
    const result = await callSessionApi({ action: 'list_cases', presenterKey: 'secret' })
    expect(result).toEqual({ cases: [], presenter: true })
    const { url, init } = lastCall()
    expect(url).toBe('https://api.example.test/saoi/api/cases')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('X-Presenter-Key')).toBe('secret')
  })

  it('list_cases without a key sends no header', async () => {
    fetchMock.mockResolvedValue(json({ cases: [], presenter: false }))
    await callSessionApi({ action: 'list_cases' })
    expect(new Headers(lastCall().init.headers).has('X-Presenter-Key')).toBe(false)
  })

  it('switch_case addresses the case in the path', async () => {
    fetchMock.mockResolvedValue(json({ ...session, created: false }))
    await callSessionApi({ action: 'switch_case', caseId: CASE, presenterKey: 'secret' })
    const { url, init } = lastCall()
    expect(url).toBe(`https://api.example.test/saoi/api/cases/${CASE}/switch`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('X-Presenter-Key')).toBe('secret')
  })

  it('claim_participant sends only the prior id', async () => {
    fetchMock.mockResolvedValue(json(session))
    await callSessionApi({ action: 'claim_participant', priorAuthUserId: CASE })
    expect(lastCall().url).toBe('https://api.example.test/saoi/api/sessions/claim')
    expect(lastCall().sent()).toEqual({ priorAuthUserId: CASE })
  })

  it('register_interest goes to POST /api/interest', async () => {
    fetchMock.mockResolvedValue(json({ registered: true }))
    await callSessionApi({
      action: 'register_interest',
      name: 'Ada',
      email: 'ada@example.test',
      interest: 'happy to help',
      consent: true,
    })
    expect(lastCall().url).toBe('https://api.example.test/saoi/api/interest')
    expect(lastCall().sent()).toMatchObject({ name: 'Ada', consent: true })
    expect(lastCall().sent()).not.toHaveProperty('action')
  })

  it('surfaces the server’s own message on a refusal', async () => {
    fetchMock.mockResolvedValue(
      json({ ok: false, error: { code: 'rate_limited', message: 'Try again tomorrow.' } }, 429),
    )
    await expect(
      callSessionApi({
        action: 'register_interest',
        name: 'Ada',
        email: 'ada@example.test',
        interest: 'happy to help',
        consent: true,
      }),
    ).rejects.toThrow('Try again tomorrow.')
  })

  it('a response that does not match the contract is a loud error', async () => {
    fetchMock.mockResolvedValue(json({ caseId: 'not-a-uuid' }))
    await expect(callSessionApi({ action: 'start', mode: 'new' })).rejects.toThrow()
  })

  const view = { partnerName: 'Emma', invitedBy: 'Aoife', applications: [], tasks: [] }

  it('partner join, tasks and submit use their own routes', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(view)))
    await callPartnerApi({ action: 'join', token: 'x'.repeat(24) })
    expect(lastCall().url).toBe('https://api.example.test/saoi/api/partner/join')
    expect(lastCall().sent()).toEqual({ token: 'x'.repeat(24) })

    const tasks = await callPartnerApi({ action: 'tasks' })
    expect(tasks).toEqual(view)
    expect(lastCall().url).toBe('https://api.example.test/saoi/api/partner/tasks')
    expect(lastCall().init.method).toBe('GET')

    await callPartnerApi({ action: 'submit', answers: [{ id: 'fact:a', value: 1 }] })
    expect(lastCall().url).toBe('https://api.example.test/saoi/api/partner/submit')
    expect(lastCall().sent()).toEqual({
      answers: [{ id: 'fact:a', value: 1 }],
    })
  })

  it('upload posts the multipart body to the case’s documents route, leaving the boundary to the browser', async () => {
    fetchMock.mockResolvedValue(json({ fileName: 'payslip.pdf', requirementId: 'payslip' }, 201))
    const form = new FormData()
    form.append('requestId', 'r1')
    form.append('file', new File(['%PDF-'], 'payslip.pdf', { type: 'application/pdf' }))
    await uploadDocumentApi(CASE, form)
    const { url, init } = lastCall()
    expect(url).toBe(`https://api.example.test/saoi/api/cases/${CASE}/documents`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe(form)
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })

  it('upload surfaces a refusal as the thrown message', async () => {
    fetchMock.mockResolvedValue(
      json({ ok: false, error: { code: 'bad_request', message: 'Send a PDF or a photo.' } }, 400),
    )
    await expect(uploadDocumentApi(CASE, new FormData())).rejects.toBeInstanceOf(SaoiApiError)
  })
})

describe('callCaseActionApi', () => {
  const APP = '88888888-8888-4888-8888-888888888888'
  const PLAN = '99999999-9999-4999-8999-999999999999'
  const FROM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const base = `https://api.example.test/saoi/api/cases/${CASE}`
  const result = { applications: [], summary: 'Done.' }
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(() => Promise.resolve(json(result, 200)))
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  type Call = Parameters<typeof callCaseActionApi>[0]
  const table: readonly [string, Call, string, unknown][] = [
    [
      'select_products',
      { action: 'select_products', caseId: CASE, products: [{ product: 'credit_card' }] },
      `${base}/products/select`,
      { products: [{ product: 'credit_card' }] },
    ],
    [
      'decline_product',
      { action: 'decline_product', caseId: CASE, product: 'personal_loan' },
      `${base}/products/personal_loan/decline`,
      {},
    ],
    [
      'confirm_requirement',
      { action: 'confirm_requirement', applicationId: APP, requirementId: 'terms' },
      `${base}/applications/${APP}/confirm`,
      { requirementId: 'terms' },
    ],
    [
      'submit_application',
      { action: 'submit_application', applicationId: APP, confirmations: ['terms'] },
      `${base}/applications/${APP}/submit`,
      { confirmations: ['terms'] },
    ],
    [
      'pause_application',
      { action: 'pause_application', applicationId: APP },
      `${base}/applications/${APP}/pause`,
      {},
    ],
    [
      'resume_application',
      { action: 'resume_application', applicationId: APP },
      `${base}/applications/${APP}/resume`,
      {},
    ],
    [
      'decide_plan',
      { action: 'decide_plan', caseId: CASE, planId: PLAN, decision: 'keep' },
      `${base}/plans/${PLAN}/decisions`,
      { decision: 'keep' },
    ],
    [
      'invite_partner',
      { action: 'invite_partner', caseId: CASE, name: 'Emma' },
      `${base}/invites`,
      { name: 'Emma' },
    ],
    [
      'grant_consent',
      { action: 'grant_consent', applicationId: APP, requirementId: 'health-consent' },
      `${base}/applications/${APP}/consent`,
      { requirementId: 'health-consent' },
    ],
    [
      'confirm_form_declarations',
      { action: 'confirm_form_declarations', applicationId: APP, fieldIds: ['7'] },
      `${base}/applications/${APP}/form-declarations`,
      { fieldIds: ['7'] },
    ],
    [
      'submit_health_form',
      {
        action: 'submit_health_form',
        applicationId: APP,
        values: [{ key: 'protection.health.smoker', value: false }],
      },
      `${base}/applications/${APP}/health-answers`,
      { values: [{ key: 'protection.health.smoker', value: false }] },
    ],
    [
      'link_accounts',
      { action: 'link_accounts', caseId: CASE, bank: 'aib', scope: ['balances'] },
      `${base}/linked-accounts`,
      { bank: 'aib', scope: ['balances'] },
    ],
    [
      'revoke_accounts',
      { action: 'revoke_accounts', caseId: CASE },
      `${base}/linked-accounts/revoke`,
      {},
    ],
    [
      'initiate_transfer',
      {
        action: 'initiate_transfer',
        caseId: CASE,
        fromAccountId: FROM,
        toApplicationId: null,
        amount: 10,
        cadence: 'once',
      },
      `${base}/transfers`,
      { fromAccountId: FROM, toApplicationId: null, amount: 10, cadence: 'once' },
    ],
    [
      'give_feedback',
      { action: 'give_feedback', caseId: CASE, kind: 'session', rating: 5, comment: 'Good' },
      `${base}/feedback`,
      { kind: 'session', rating: 5, comment: 'Good' },
    ],
  ]

  it.each(table)(
    '%s goes to its route with the bearer token and no envelope',
    async (_n, request, url, body) => {
      await expect(callCaseActionApi(request, CASE)).resolves.toEqual(result)
      const [calledUrl, init] = fetchMock.mock.calls[0] ?? []
      expect(calledUrl).toBe(url)
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
      expect(JSON.parse(init?.body as string)).toEqual(body)
    },
  )

  it('subscribe_push has its own reply shape', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ subscribed: true }, 201)))
    await expect(
      callCaseActionApi({
        action: 'subscribe_push',
        caseId: CASE,
        endpoint: 'https://push.example.test/x',
        p256dh: 'k',
        auth: 'a',
      }),
    ).resolves.toEqual({ subscribed: true })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${base}/push-subscriptions`)
  })

  it('needs the open case for an action that names only an application', async () => {
    await expect(
      callCaseActionApi({ action: 'pause_application', applicationId: APP }),
    ).rejects.toThrow('Which conversation')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the server’s refusal, as a partner would meet it', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        json(
          {
            ok: false,
            error: {
              code: 'forbidden',
              message: 'Only the person who started this case can do that.',
            },
          },
          403,
        ),
      ),
    )
    const error = await callCaseActionApi({ action: 'revoke_accounts', caseId: CASE }).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(SaoiApiError)
    expect(error).toMatchObject({ status: 403 })
  })

  it('rejects a reply that does not match the contract', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ summary: 3 }, 200)))
    await expect(callCaseActionApi({ action: 'revoke_accounts', caseId: CASE })).rejects.toThrow()
  })
})
