import type { ClaimedPlan } from '@shared/db/saved-plans.ts'
import { SignJWT } from 'jose'
import type { CaseReadStore, CaseStore, EventRow, SnapshotRows } from './store/cases.ts'
import { fakeActions, type FakeActions } from './testing.actions.ts'
import type { MessageRow } from '@shared/domain/card-state.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'
import type { Identity, Mapping, NewInterest, SessionStore } from './store/sessions.ts'
import type { Invite, PartnerFactRow, PartnerSession, PartnerStore } from './store/partners.ts'
import type { HeldRequest, Seat, UploadStore, EventInput } from './store/uploads.ts'

export const SECRET = 'test-secret-test-secret-test-secret-123'
export const USER_ID = '11111111-1111-4111-8111-111111111111'
export const CASE_ID = '22222222-2222-4222-8222-222222222222'
export const OTHER_CASE_ID = '33333333-3333-4333-8333-333333333333'

export async function tokenFor(
  claims: { sub?: string; aud?: string; is_anonymous?: boolean; secret?: string } = {},
): Promise<string> {
  return new SignJWT({ is_anonymous: claims.is_anonymous ?? false })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub ?? USER_ID)
    .setAudience(claims.aud ?? 'authenticated')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(claims.secret ?? SECRET))
}

export const emptyRows: SnapshotRows = {
  applications: [],
  interests: [],
  plans: [],
  requests: [],
  formAnswers: [],
  reusedApplicationIds: [],
  linkedAccounts: [],
  transfers: [],
  notifications: [],
}

/**
 * An in-memory store. `events` are kept oldest first. `access` is the primary customer's seat
 * (user to cases), `partners` a partner's, `admins` the roster; `actions` records the writes of
 * the case action routes.
 */
export function fakeStore(
  init: {
    access?: Record<string, string[]>
    partners?: Record<string, string[]>
    admins?: string[]
    rows?: Partial<SnapshotRows>
    messages?: MessageRow[]
    events?: EventRow[]
    claimedPlans?: ClaimedPlan[]
  } = {},
): CaseStore & { events: EventRow[]; actions: FakeActions } {
  const events = init.events ?? []
  const access = init.access ?? { [USER_ID]: [CASE_ID] }
  const partners = init.partners ?? {}
  const admins = init.admins ?? []
  const actions = fakeActions(CASE_ID)
  // The store *is* the fake actions object, so a test that replaces `actions.startApplications`
  // changes what the routes call.
  const read: CaseReadStore = {
    caseAccess: (userId, caseId, roles = ['primary']) => {
      const seat = (role: 'primary' | 'partner', seats: Record<string, string[]>) =>
        roles.includes(role) && seats[userId]?.includes(caseId)
          ? { caseId, participantId: `participant-${role}-${userId}`, role }
          : null
      const found =
        seat('primary', access) ??
        seat('partner', partners) ??
        (roles.includes('admin') && admins.includes(userId)
          ? { caseId, participantId: null, role: 'admin' as const }
          : null)
      return Promise.resolve(found)
    },
    loadSnapshotRows: () => Promise.resolve({ ...emptyRows, ...init.rows }),
    loadMessages: (_caseId, limit) => Promise.resolve((init.messages ?? []).slice(-limit)),
    claimedPlans: () => Promise.resolve(init.claimedPlans ?? []),
    recentEvents: (_caseId, limit) => Promise.resolve([...events].reverse().slice(0, limit)),
    eventsSince: (_caseId, since) =>
      Promise.resolve(events.filter((event) => event.created_at >= since)),
    eventCreatedAt: (_caseId, id) =>
      Promise.resolve(events.find((event) => event.id === id)?.created_at ?? null),
  }
  return Object.assign(actions, read, { events, actions })
}

// ---- session, partner and document fakes ------------------------------------------------------

export const PRESENTER_KEY = 'test-presenter-key'
export const STRANGER_ID = '44444444-4444-4444-8444-444444444444'
export const PARTNER_ID = '55555555-5555-4555-8555-555555555555'
export const ACCOUNT_ID = '66666666-6666-4666-8666-666666666666'
export const ADMIN_ID = '77777777-7777-4777-8777-777777777777'

export const identityOf = (id: string, overrides: Partial<Identity> = {}): Identity => ({
  id,
  isAnonymous: true,
  email: null,
  name: null,
  provider: null,
  ...overrides,
})

type SeatInit = { userId: string; participantId: string; caseId: string; role: string }

/** An in-memory `SessionStore`. Users without an identity here are users that no longer exist. */
export function fakeSessions(
  init: {
    identities?: Identity[]
    seats?: SeatInit[]
    /** Cases the presenter's list shows, with how many messages each holds. */
    cases?: { caseId: string; messages: number; kind?: string }[]
    casesToday?: number
    interestsToday?: number
    substance?: Record<
      string,
      { customerMessages: number; facts: number; applications: number; plans: number }
    >
  } = {},
): SessionStore & {
  seats: SeatInit[]
  created: { userId: string; mode: string; source: string | null }[]
  interests: NewInterest[]
} {
  const identities = new Map(
    (
      init.identities ?? [
        identityOf(USER_ID),
        identityOf(STRANGER_ID),
        identityOf(PARTNER_ID),
        identityOf(ACCOUNT_ID, { isAnonymous: false, email: 'a@example.invalid' }),
        identityOf(ADMIN_ID, { isAnonymous: false, email: 'admin@example.invalid' }),
      ]
    ).map((identity) => [identity.id, identity]),
  )
  const seats: SeatInit[] = init.seats ?? [
    { userId: USER_ID, participantId: 'participant-primary', caseId: CASE_ID, role: 'primary' },
  ]
  const created: { userId: string; mode: string; source: string | null }[] = []
  const interests: NewInterest[] = []
  const mappingOf = (seat: SeatInit): Mapping => ({
    participantId: seat.participantId,
    caseId: seat.caseId,
    role: seat.role,
  })

  return {
    seats,
    created,
    interests,
    identity: (userId) => Promise.resolve(identities.get(userId) ?? null),
    primaryMappings: (userId) =>
      Promise.resolve(
        seats
          .filter((seat) => seat.userId === userId && seat.role === 'primary')
          .map(mappingOf)
          .reverse(),
      ),
    listCases: ({ userId, presenter, currentCaseId }) => {
      const mine = new Set(
        seats
          .filter((seat) => seat.userId === userId && seat.role === 'primary')
          .map((seat) => seat.caseId),
      )
      const all = init.cases ?? [{ caseId: CASE_ID, messages: 1 }]
      return Promise.resolve(
        all
          .filter((row) => (presenter ? row.kind !== 'test' : mine.has(row.caseId)))
          .map((row) => ({
            caseId: row.caseId,
            label: null,
            opening: null,
            messages: row.messages,
            applications: 0,
            lastActivityAt: null,
            current: row.caseId === currentCaseId,
            mine: mine.has(row.caseId),
          })),
      )
    },
    primaryParticipant: (caseId) => {
      const seat = seats.find((entry) => entry.caseId === caseId && entry.role === 'primary')
      return Promise.resolve(seat ? { id: seat.participantId, role: 'primary' } : null)
    },
    attach: (participantId, userId) => {
      const known = seats.find((seat) => seat.participantId === participantId)
      const already = seats.some(
        (seat) => seat.participantId === participantId && seat.userId === userId,
      )
      if (known && !already) seats.push({ ...known, userId })
      return Promise.resolve()
    },
    substance: (caseId) =>
      Promise.resolve(
        init.substance?.[caseId] ?? { customerMessages: 0, facts: 0, applications: 0, plans: 0 },
      ),
    customerCasesSince: () => Promise.resolve(init.casesToday ?? 0),
    createCase: ({ userId, mode, source }) => {
      created.push({ userId, mode, source })
      const caseId = `created-case-${String(created.length)}`
      const participantId = `created-participant-${String(created.length)}`
      seats.push({ userId, participantId, caseId, role: 'primary' })
      return Promise.resolve({ caseId, participantId })
    },
    describe: (mapping, identity, wasCreated) =>
      Promise.resolve({
        caseId: mapping.caseId,
        participantId: mapping.participantId,
        role: mapping.role === 'partner' ? 'partner' : 'primary',
        authLevel: identity.isAnonymous ? 'anonymous' : 'authenticated',
        customerFirstName: null,
        created: wasCreated,
        hasUpdates: false,
      }),
    interestsSince: () => Promise.resolve(init.interestsToday ?? 0),
    addInterest: (interest) => {
      interests.push(interest)
      return Promise.resolve()
    },
  }
}

export const INVITE_TOKEN = 'invite-token-invite-token-1234'
export const sha256Hex = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/** A case with a primary and a partner and nothing else. */
export const bareLoadedCase = {
  participants: [
    { id: 'participant-primary', role: 'primary', displayName: 'Aoife' },
    { id: 'participant-partner', role: 'partner', displayName: 'Emma' },
  ],
  applications: [],
  facts: [],
} as unknown as LoadedCase

type PartnerSeat = {
  userId: string
  participantId: string
  caseId: string
  displayName: string | null
}

export function fakePartners(
  init: {
    /** Token hash to invite. */
    invites?: Record<string, Invite>
    seats?: PartnerSeat[]
    existing?: string[]
    loaded?: LoadedCase | null
  } = {},
): PartnerStore & {
  seats: PartnerSeat[]
  answers: { caseId: string; rows: readonly PartnerFactRow[]; partnerName: string }[]
} {
  const seats: PartnerSeat[] = init.seats ?? [
    {
      userId: PARTNER_ID,
      participantId: 'participant-partner',
      caseId: CASE_ID,
      displayName: 'Emma',
    },
  ]
  const answers: { caseId: string; rows: readonly PartnerFactRow[]; partnerName: string }[] = []
  const existing = new Set(init.existing ?? [USER_ID, STRANGER_ID, PARTNER_ID])
  return {
    seats,
    answers,
    userExists: (userId) => Promise.resolve(existing.has(userId)),
    findInvite: (hash) => Promise.resolve(init.invites?.[hash] ?? null),
    hasSession: (participantId, userId) =>
      Promise.resolve(
        seats.some((seat) => seat.participantId === participantId && seat.userId === userId),
      ),
    join: (invite, userId) => {
      seats.push({
        userId,
        participantId: invite.participantId,
        caseId: invite.caseId,
        displayName: 'Emma',
      })
      return Promise.resolve()
    },
    partnerSession: (userId): Promise<PartnerSession | null> => {
      const seat = seats.find((entry) => entry.userId === userId)
      return Promise.resolve(
        seat
          ? {
              participantId: seat.participantId,
              caseId: seat.caseId,
              displayName: seat.displayName,
            }
          : null,
      )
    },
    loadCase: () => Promise.resolve(init.loaded === undefined ? bareLoadedCase : init.loaded),
    recordAnswers: (input) => {
      answers.push(input)
      return Promise.resolve()
    },
  }
}

export const REQUEST_ID = '88888888-8888-4888-8888-888888888888'

export function fakeUploads(
  init: {
    seats?: { userId: string; caseId: string; participantId: string; role: string }[]
    requests?: Record<string, HeldRequest & { caseId: string }>
    formApplications?: Record<string, { id: string; formId: string; caseId: string }>
  } = {},
): UploadStore & {
  files: { path: string; contentType: string; size: number }[]
  documents: { fileName: string; storagePath: string }[]
  events: EventInput[]
  fulfilled: string[]
  states: { applicationId: string; state: string }[]
  formFiles: { fieldId: string; value: Record<string, unknown> }[]
} {
  const files: { path: string; contentType: string; size: number }[] = []
  const documents: { fileName: string; storagePath: string }[] = []
  const events: EventInput[] = []
  const fulfilled: string[] = []
  const states: { applicationId: string; state: string }[] = []
  const formFiles: { fieldId: string; value: Record<string, unknown> }[] = []
  const seats = init.seats ?? [
    { userId: USER_ID, caseId: CASE_ID, participantId: 'participant-primary', role: 'primary' },
    { userId: PARTNER_ID, caseId: CASE_ID, participantId: 'participant-partner', role: 'partner' },
  ]
  const requests: Record<string, HeldRequest & { caseId: string }> = init.requests ?? {
    [REQUEST_ID]: {
      id: REQUEST_ID,
      caseId: CASE_ID,
      status: 'open',
      requirementId: 'payslip',
      application: { id: 'app-1', product: 'personal_loan', state: 'in_progress', resumeTo: null },
    },
  }
  return {
    files,
    documents,
    events,
    fulfilled,
    states,
    formFiles,
    seat: (userId, caseId): Promise<Seat | null> => {
      const seat = seats.find((entry) => entry.userId === userId && entry.caseId === caseId)
      return Promise.resolve(seat ? { participantId: seat.participantId, role: seat.role } : null)
    },
    findRequest: (caseId, requestId) => {
      const found = requests[requestId]
      return Promise.resolve(found && found.caseId === caseId ? found : null)
    },
    findFormApplication: (caseId, id) => {
      const found = init.formApplications?.[id]
      return Promise.resolve(found && found.caseId === caseId ? found : null)
    },
    putFile: (path, bytes, contentType) => {
      files.push({ path, contentType, size: bytes.byteLength })
      return Promise.resolve()
    },
    recordDocument: (input) => {
      documents.push({ fileName: input.fileName, storagePath: input.storagePath })
      return Promise.resolve()
    },
    fulfilRequest: (id) => {
      fulfilled.push(id)
      return Promise.resolve()
    },
    openRequestCount: () => Promise.resolve(0),
    setApplicationState: (applicationId, state) => {
      states.push({ applicationId, state })
      return Promise.resolve()
    },
    recordFormFile: (input) => {
      formFiles.push({ fieldId: input.fieldId, value: input.value })
      return Promise.resolve()
    },
    writeEvent: (input) => {
      events.push(input)
      return Promise.resolve()
    },
  }
}

/** Every store a test app needs, with the defaults above. Spread it into `createApp`. */
export function fakeStores() {
  return { sessions: fakeSessions(), partners: fakePartners(), uploads: fakeUploads() }
}
