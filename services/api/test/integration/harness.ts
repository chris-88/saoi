/**
 * Integration harness for saoi-api.
 *
 * Runs the real app (real stores, real token verification) in process against the Postgres,
 * GoTrue and Storage that `supabase start` brings up, with the project's migrations and seed
 * applied. Users are real anonymous or email users, so the tokens are the ones the local
 * stack signs with its own secret. The same idea as `supabase/functions/_shared/test/harness.ts`
 * for the Edge Functions; the expectations in the specs are the ones that suite pins.
 *
 * Run with `npm run test:integration` (needs `supabase start`).
 */
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createApp } from '../../src/app.ts'
import { createTokenVerifier } from '../../src/middleware/auth.ts'
import { createServiceClient } from '../../src/store/client.ts'
import { supabaseStore } from '../../src/store/cases.ts'
import { supabasePartnerStore } from '../../src/store/partners.ts'
import { supabaseSessionStore } from '../../src/store/sessions.ts'
import { supabaseUploadStore } from '../../src/store/uploads.ts'
import { createAdminStores } from '../../src/store/admin/factory.ts'
import { fixtureModels } from '../../src/turn/generate.ts'
import { createTurnRunner } from '../../src/turn/turn.ts'

export const PRESENTER_KEY = 'test-presenter-key'

type Config = { url: string; anonKey: string; serviceKey: string; jwtSecret: string }

let cached: Config | undefined

function config(): Config {
  if (cached) return cached
  let { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey } = process.env
  let { SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_JWT_SECRET: jwtSecret } = process.env

  if (!url || !anonKey || !serviceKey || !jwtSecret) {
    const text = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const read = (key: string) => new RegExp(`^${key}="?([^"\\n]+)"?$`, 'm').exec(text)?.[1]
    url ??= read('API_URL')
    anonKey ??= read('ANON_KEY')
    serviceKey ??= read('SERVICE_ROLE_KEY')
    jwtSecret ??= read('JWT_SECRET')
  }
  if (!url || !anonKey || !serviceKey || !jwtSecret) {
    throw new Error('No local Supabase. Run `supabase start` first.')
  }
  cached = { url, anonKey, serviceKey, jwtSecret }
  grantServiceRole()
  return cached
}

/**
 * The local stack does not expose new `public` tables to the Data API roles, and the
 * migrations were written when Supabase's default privileges did that for them. Production
 * works; a fresh `supabase start` answers every service-role query with 42501. This restores
 * what production has, for the test database only. Idempotent. `SKIP_TEST_GRANTS=1` skips it.
 */
function grantServiceRole(): void {
  if (process.env['SKIP_TEST_GRANTS'] === '1') return
  const sql = `do $$ begin
    execute 'grant usage on schema public to service_role';
    execute 'grant all on all tables in schema public to service_role';
    execute 'grant all on all sequences in schema public to service_role';
    execute 'grant execute on all functions in schema public to service_role';
  end $$`
  execFileSync('supabase', ['db', 'query', '--local', sql], { stdio: 'ignore' })
}

export function serviceClient(): SupabaseClient<any> {
  const c = config()
  return createClient<any>(c.url, c.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type App = ReturnType<typeof createApp>

export function buildApp(options: { audienceMaxCases?: number; fixture?: string } = {}): App {
  const c = config()
  const db = createServiceClient(c.url, c.serviceKey)
  return createApp({
    version: 'integration',
    verifyToken: createTokenVerifier({
      secret: c.jwtSecret,
      jwksUrl: `${c.url}/auth/v1/.well-known/jwks.json`,
    }),
    store: supabaseStore(db),
    sessions: supabaseSessionStore(db),
    partners: supabasePartnerStore(db),
    uploads: supabaseUploadStore(db),
    admin: createAdminStores(db, {
      saoiModel: 'claude-sonnet-5-5',
      gateModel: 'claude-haiku-4-5-20251001',
      appBaseUrl: 'http://localhost',
      vapid: { privateD: 'x', publicKey: 'x', subject: 'mailto:test@example.invalid' },
    }),
    // The fixture provider: no model is called and no key is needed.
    turn: {
      run: createTurnRunner({
        db,
        appBaseUrl: 'http://localhost:5173/',
        models: fixtureModels({ fixture: options.fixture ?? 'opening' }),
      }),
    },
    config: {
      presenterKey: PRESENTER_KEY,
      audienceMaxCases: options.audienceMaxCases ?? 1_000_000,
    },
    rateLimit: { max: 1_000_000, windowMs: 60_000 },
  })
}

export type TestUser = { id: string; token: string; email?: string }

/** A real anonymous Supabase user with a real access token, as a visitor's browser has. */
export async function anonymousUser(): Promise<TestUser> {
  const c = config()
  const client = createClient(c.url, c.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.session || !data.user) throw new Error(`anonymous sign-in: ${error?.message}`)
  return { id: data.user.id, token: data.session.access_token }
}

/** A signed-in email user. With `admin`, also a row in `admin_users`. */
export async function emailUser(options: { admin: boolean }): Promise<TestUser> {
  const c = config()
  const service = serviceClient()
  const email = `t-${crypto.randomUUID()}@example.invalid`
  const password = crypto.randomUUID()
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`)
  const id = created.data.user.id

  if (options.admin) {
    const inserted = await service.from('admin_users').insert({ auth_user_id: id, email })
    if (inserted.error) throw new Error(`admin_users: ${inserted.error.message}`)
  }

  const client = createClient(c.url, c.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const session = await client.auth.signInWithPassword({ email, password })
  if (session.error || !session.data.session) throw new Error(`sign-in: ${session.error?.message}`)
  return { id, token: session.data.session.access_token, email }
}

export type Reply = { status: number; body: any }

export async function request(
  app: App,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await app.request(path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // Not JSON.
  }
  return { status: response.status, body }
}

/** A reply read as text, for the streaming routes. */
export async function requestRaw(
  app: App,
  path: string,
  options: { token?: string | null; body?: unknown },
): Promise<{ status: number; headers: Headers; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  const response = await app.request(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body ?? {}),
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

/** The `data:` frames of an event stream, parsed. Comment lines (keep-alives) are skipped. */
export function sseFrames(text: string): any[] {
  return text
    .split('\n\n')
    .flatMap((block) => block.split('\n'))
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
}

export const errorCode = (reply: Reply): string | undefined => reply.body?.error?.code

export type Participant = { user: TestUser; caseId: string; participantId: string }

/** A new visitor: anonymous user, then `POST /api/sessions`, exactly as the SPA does. */
export async function startVisitor(app: App, mode: 'new' | 'known' = 'new'): Promise<Participant> {
  const user = await anonymousUser()
  const reply = await request(app, 'POST', '/api/sessions', { token: user.token, body: { mode } })
  if (reply.status !== 200) throw new Error(`session start: ${JSON.stringify(reply.body)}`)
  return { user, caseId: reply.body.caseId, participantId: reply.body.participantId }
}

/** Gives a case a partner participant and an anonymous browser mapped to it. */
export async function addPartner(caseId: string, name = 'Partner'): Promise<Participant> {
  const service = serviceClient()
  const user = await anonymousUser()
  const made = await service
    .from('participants')
    .insert({ case_id: caseId, role: 'partner', display_name: name })
    .select('id')
    .single()
  if (made.error) throw new Error(`partner participant: ${made.error.message}`)
  const mapped = await service
    .from('participant_sessions')
    .insert({ participant_id: made.data.id, auth_user_id: user.id })
  if (mapped.error) throw new Error(`partner session: ${mapped.error.message}`)
  return { user, caseId, participantId: made.data.id }
}

export async function rows(table: string, caseId: string): Promise<any[]> {
  const r = await serviceClient().from(table).select('*').eq('case_id', caseId)
  if (r.error) throw new Error(`${table}: ${r.error.message}`)
  return r.data ?? []
}

/** Rows of a table with a `created_at`, oldest first: the order they were written in. */
export async function rowsInOrder(table: string, caseId: string): Promise<any[]> {
  const r = await serviceClient()
    .from(table)
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })
  if (r.error) throw new Error(`${table}: ${r.error.message}`)
  return r.data ?? []
}

export const NO_SUCH_ID = '00000000-0000-4000-8000-0000000000aa'
