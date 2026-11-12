import type { Database, Json } from '@shared/db/database.types.ts'
import { loadCase, mustWrite, writeEvent } from '@shared/db/case-repository.ts'
import { evaluateFor, recordReuse } from '@shared/db/applications.ts'
import { NARRATABLE_EVENTS } from '@shared/db/digest.ts'
import { canonicalCase } from '@shared/domain/seed/canonical.ts'
import type { CaseSubstance } from '@shared/domain/continuity.ts'
import type { CaseSummary, SessionResponse } from '@shared/contracts/session.ts'
import type { Db } from './client.ts'

/**
 * Everything the session routes need from the database: which conversation a browser belongs
 * to, how one is opened, and the interest list. Orchestration (who may open what, the daily
 * cap, which conversation wins on sign-in) stays in the routes; this is data access plus the
 * two multi-step writes that must stay together (`describe` and `createCase`).
 */

/** The auth user as the account record has it, not as a token claims. */
export type Identity = {
  readonly id: string
  readonly isAnonymous: boolean
  readonly email: string | null
  readonly name: string | null
  readonly provider: string | null
}

/** A browser's seat in a conversation. */
export type Mapping = {
  readonly participantId: string
  readonly caseId: string
  readonly role: string
}

export type NewInterest = {
  readonly kind: 'collaborate' | 'question'
  readonly name: string
  readonly email: string
  readonly organisation: string | null
  readonly role: string | null
  readonly interest: string
  readonly consent: true
  readonly source: string | null
}

export type SessionStore = {
  /** Null when the user no longer exists (a purged project leaves live tokens behind). */
  identity(userId: string): Promise<Identity | null>
  /** Primary seats only, most recently used first. A partner seat is not a conversation. */
  primaryMappings(userId: string): Promise<readonly Mapping[]>
  /** The conversations the switcher shows, empty ones excluded unless current. */
  listCases(input: {
    userId: string
    presenter: boolean
    currentCaseId: string | null
  }): Promise<readonly CaseSummary[]>
  primaryParticipant(caseId: string): Promise<{ id: string; role: string } | null>
  /** Seats the user at the participant, or refreshes `last_used_at` when already seated. */
  attach(participantId: string, userId: string): Promise<void>
  substance(caseId: string): Promise<CaseSubstance>
  customerCasesSince(sinceIso: string): Promise<number>
  createCase(input: {
    userId: string
    mode: 'new' | 'known'
    source: string | null
  }): Promise<{ caseId: string; participantId: string }>
  /** Catches the case up to a sign-in, then returns the response every landing gives. */
  describe(mapping: Mapping, identity: Identity, created: boolean): Promise<SessionResponse>
  interestsSince(sinceIso: string): Promise<number>
  addInterest(interest: NewInterest): Promise<void>
}

type SeatRow = {
  participant_id: string
  participants: { id: string; case_id: string; role: string } | null
}

/**
 * Whether anything worth telling them happened since they were last seen: a narratable event
 * (`NARRATABLE_EVENTS`: the bank moving, a plan claimed, a plan edited in the profile) after
 * `last_seen_at`. True until a turn marks them seen; the app runs a return turn on it.
 */
export async function hasUpdatesSince(db: Db, caseId: string): Promise<boolean> {
  const theCase = await db.from('cases').select('last_seen_at').eq('id', caseId).maybeSingle()
  const lastSeen = theCase.data?.last_seen_at
  if (!lastSeen) return false

  const since = await db
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .in('type', NARRATABLE_EVENTS as unknown as string[])
    .gt('created_at', lastSeen)
  return (since.count ?? 0) > 0
}

export function supabaseSessionStore(db: Db): SessionStore {
  async function primaryMappings(userId: string): Promise<Mapping[]> {
    const result = await db
      .from('participant_sessions')
      .select('participant_id, last_used_at, participants!inner(id, case_id, role)')
      .eq('auth_user_id', userId)
      .eq('participants.role', 'primary')
      .order('last_used_at', { ascending: false })
    if (result.error) throw new Error(`Failed to load sessions: ${result.error.message}`)
    return (result.data as unknown as SeatRow[]).flatMap((row) =>
      row.participants
        ? [
            {
              participantId: row.participants.id,
              caseId: row.participants.case_id,
              role: row.participants.role,
            },
          ]
        : [],
    )
  }

  const updatesSince = (caseId: string): Promise<boolean> => hasUpdatesSince(db, caseId)

  /**
   * Somebody who has signed in since they last called: the case says `anonymous` and the
   * participant is nobody. This is where that catches up, on the first call afterwards. The
   * name goes on the participant rather than into `facts`: it is not something the customer
   * told Saoirse. `system_derived`, never `verified`, and never overwrites what they said.
   */
  async function adoptIdentity(
    participantId: string,
    caseId: string,
    identity: Identity,
  ): Promise<void> {
    if (identity.isAnonymous) return
    const named = identity.name?.trim() ? identity.name.trim() : undefined

    const theCase = await db.from('cases').select('auth_level').eq('id', caseId).maybeSingle()
    if (theCase.data?.auth_level !== 'authenticated') {
      mustWrite(
        await db.from('cases').update({ auth_level: 'authenticated' }).eq('id', caseId),
        'the case',
      )
      // The provider as the token states it: §53 counts how people actually got in.
      await writeEvent(db, {
        caseId,
        type: 'customer_signed_in',
        actor: 'customer',
        payload: { provider: identity.provider ?? 'unknown' },
      })
    }

    if (named !== undefined) {
      const participant = await db
        .from('participants')
        .select('display_name')
        .eq('id', participantId)
        .maybeSingle()
      if (!participant.data?.display_name) {
        mustWrite(
          await db.from('participants').update({ display_name: named }).eq('id', participantId),
          'the participant',
        )
      }
    }

    const existing = await db
      .from('facts')
      .select('key')
      .eq('case_id', caseId)
      .in('key', ['identity.fullName', 'identity.email'])
      .is('superseded_by', null)
    const held = new Set((existing.data ?? []).map((row) => row.key))

    const rows: Database['public']['Tables']['facts']['Insert'][] = []
    const row = (key: string, value: string) => ({
      case_id: caseId,
      key,
      participant_id: participantId,
      subject_kind: 'participant' as const,
      value: value as unknown as Json,
      source: 'system_derived' as const,
      verified: false,
    })
    if (named !== undefined && !held.has('identity.fullName')) {
      rows.push(row('identity.fullName', named))
    }
    if (identity.email && !held.has('identity.email')) {
      rows.push(row('identity.email', identity.email))
    }

    if (rows.length === 0) return
    mustWrite(await db.from('facts').insert(rows), 'the signed-in details')
    for (const added of rows) {
      await writeEvent(db, {
        caseId,
        type: 'context_captured',
        actor: 'customer',
        payload: { key: added.key },
      })
    }

    // What the account just saved them typing, recorded where the reuse metric reads (§53).
    const justAdded = new Set(rows.map((added) => String(added.key)))
    const reloaded = await loadCase(db, caseId)
    if (reloaded !== null) {
      for (const application of reloaded.applications) {
        await recordReuse(db, reloaded, application, evaluateFor(reloaded, application), justAdded)
      }
    }
  }

  return {
    async identity(userId) {
      const result = await db.auth.admin.getUserById(userId)
      const user = result.data.user
      if (result.error || !user) return null
      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
      const name = ['full_name', 'name']
        .map((key) => metadata[key])
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      const provider = (user.app_metadata as Record<string, unknown> | null)?.['provider']
      return {
        id: user.id,
        isAnonymous: user.is_anonymous === true,
        email: user.email ?? null,
        name: name ?? null,
        provider: typeof provider === 'string' ? provider : null,
      }
    },

    primaryMappings,

    async listCases({ userId, presenter, currentCaseId }) {
      const mine = await primaryMappings(userId)
      const myCaseIds = new Set(mine.map((mapping) => mapping.caseId))

      // `test` cases are left out on purpose: automated probes create them and delete them
      // without warning, and a switcher full of them is one nobody can find anything in.
      const select = 'id, label, created_at, updated_at, kind'
      const rows = presenter
        ? await db
            .from('cases')
            .select(select)
            .neq('kind', 'test')
            .order('updated_at', { ascending: false })
            .limit(60)
        : await db
            .from('cases')
            .select(select)
            .in('id', [...myCaseIds, '00000000-0000-4000-8000-000000000000'])
            .order('updated_at', { ascending: false })
            .limit(60)

      const cases = (rows.data ?? []).filter((row) => presenter || myCaseIds.has(row.id))
      const ids = cases.map((row) => row.id)

      const [messages, applications] = await Promise.all([
        db.from('messages').select('case_id, role, content, created_at').in('case_id', ids),
        db.from('applications').select('case_id').in('case_id', ids),
      ])

      const summaries = cases.map((row) => {
        const theirs = (messages.data ?? []).filter((m) => m.case_id === row.id)
        const opening = theirs
          .filter((m) => m.role === 'customer')
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]
        const latest = theirs
          .map((m) => String(m.created_at))
          .sort()
          .pop()
        return {
          caseId: row.id,
          label: row.label ?? null,
          opening: opening ? String(opening.content).slice(0, 120) : null,
          messages: theirs.length,
          applications: (applications.data ?? []).filter((a) => a.case_id === row.id).length,
          lastActivityAt: latest ?? row.updated_at ?? null,
          current: row.id === currentCaseId,
          mine: myCaseIds.has(row.id),
        }
      })

      // A conversation nobody has spoken in is not a conversation. The one you are in stays:
      // it is empty exactly when you have just started it.
      return summaries.filter((row) => row.messages > 0 || row.current)
    },

    async primaryParticipant(caseId) {
      const result = await db
        .from('participants')
        .select('id, role')
        .eq('case_id', caseId)
        .eq('role', 'primary')
        .maybeSingle()
      return result.data ?? null
    },

    async attach(participantId, userId) {
      mustWrite(
        await db.from('participant_sessions').upsert(
          {
            participant_id: participantId,
            auth_user_id: userId,
            last_used_at: new Date().toISOString(),
          },
          { onConflict: 'participant_id,auth_user_id' },
        ),
        'the session',
      )
    },

    async substance(caseId) {
      const [messages, facts, applications, plans] = await Promise.all([
        db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .eq('role', 'customer'),
        db
          .from('facts')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .is('superseded_by', null),
        db.from('applications').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
        db.from('plans').select('id', { count: 'exact', head: true }).eq('case_id', caseId),
      ])
      return {
        customerMessages: messages.count ?? 0,
        facts: facts.count ?? 0,
        applications: applications.count ?? 0,
        plans: plans.count ?? 0,
      }
    },

    async customerCasesSince(sinceIso) {
      const result = await db
        .from('cases')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'customer')
        .gte('created_at', sinceIso)
      return result.count ?? 0
    },

    async createCase({ userId, mode, source }) {
      const created = await db
        .from('cases')
        .insert({ kind: 'customer', auth_level: 'anonymous', label: null, source })
        .select('id')
        .single()
      if (created.error || !created.data) throw new Error('Could not create the case.')
      const caseId = created.data.id

      const participant = await db
        .from('participants')
        .insert({ case_id: caseId, role: 'primary' })
        .select('id')
        .single()
      if (participant.error || !participant.data) throw new Error('Could not create the seat.')
      const participantId = participant.data.id

      mustWrite(
        await db
          .from('participant_sessions')
          .insert({ participant_id: participantId, auth_user_id: userId }),
        'the session',
      )

      // `known` starts them as somebody the bank already deals with: signed in, with the
      // details it holds loaded. Not a shortcut: it is where §53 has anything to show.
      if (mode === 'known') {
        const customer = await db
          .from('customers')
          .select('id')
          .eq('bank_reference', canonicalCase.customer.bankReference)
          .maybeSingle()

        mustWrite(
          await db
            .from('cases')
            .update({
              auth_level: 'authenticated',
              customer_id: customer.data?.id ?? null,
              label: 'Audience · demo customer',
            })
            .eq('id', caseId),
          'the case',
        )

        mustWrite(
          await db.from('facts').insert(
            canonicalCase.bankHeldFacts.map((fact) => ({
              case_id: caseId,
              key: fact.key,
              participant_id: fact.subject === 'household' ? null : participantId,
              subject_kind:
                fact.subject === 'household' ? ('household' as const) : ('participant' as const),
              value: fact.value as Json,
              source: fact.source,
              verified: fact.verified,
            })),
          ),
          'the facts',
        )
      }

      mustWrite(
        await db.from('events').insert({
          case_id: caseId,
          type: 'case_created',
          actor: 'system',
          payload: { mode },
        }),
        'the event',
      )

      return { caseId, participantId }
    },

    async describe(mapping, identity, created) {
      // Through one responder for every landing, so a case opened by somebody already signed
      // in is marked authenticated and carries their name.
      await adoptIdentity(mapping.participantId, mapping.caseId, identity)

      const theCase = await db
        .from('cases')
        .select('auth_level, customer_id')
        .eq('id', mapping.caseId)
        .maybeSingle()
      const participant = await db
        .from('participants')
        .select('display_name')
        .eq('id', mapping.participantId)
        .maybeSingle()
      const signedInName = participant.data?.display_name

      return {
        caseId: mapping.caseId,
        participantId: mapping.participantId,
        role: mapping.role === 'partner' ? 'partner' : 'primary',
        authLevel: theCase.data?.auth_level === 'authenticated' ? 'authenticated' : 'anonymous',
        customerFirstName: theCase.data?.customer_id
          ? canonicalCase.customer.firstName
          : (signedInName?.split(' ')[0] ?? null),
        created,
        hasUpdates: await updatesSince(mapping.caseId),
      }
    },

    async interestsSince(sinceIso) {
      const result = await db
        .from('collaborators')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso)
      return result.count ?? 0
    },

    async addInterest(interest) {
      mustWrite(await db.from('collaborators').insert(interest), 'the registration')
    },
  }
}
