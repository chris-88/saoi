import { beforeAll, describe, expect, it } from 'vitest'
// First: the app patches zod with `.openapi`, which a schema built before it would lack.
import { buildApp, emailUser, request, serviceClient, serviceDb, startVisitor } from '../harness.ts'
import { supabasePlanStore } from '../../../src/store/plans.ts'
import { supabaseTelemetryStore } from '../../../src/store/telemetry.ts'

const app = buildApp()
const service = serviceClient()

/** A saved plan row, as `POST /api/plans` or a draft writes it. */
async function savedPlan(): Promise<string> {
  const made = await service
    .from('saved_plans')
    .insert({
      version: 1,
      document: {},
      title: 'AI usage test plan',
      client: 'claude',
      token_hash: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id')
    .single()
  if (made.error) throw new Error(`saved_plans: ${made.error.message}`)
  return made.data.id as string
}

describe('GET /api/admin/ai-usage', () => {
  let token = ''

  beforeAll(async () => {
    token = (await emailUser({ admin: true })).token
    // Nothing else writes calls; start from none so the counts are exact.
    const cleared = await service.from('mcp_calls').delete().not('id', 'is', null)
    if (cleared.error) throw new Error(`mcp_calls: ${cleared.error.message}`)
  })

  it('follows calls from the telemetry record through the link funnel', async () => {
    const db = serviceDb()
    const telemetry = supabaseTelemetryStore(db)
    const plans = supabasePlanStore(db)

    // A plan opened and claimed into a case that signed in and chose a product.
    const visitor = await startVisitor(app)
    const claimedPlan = await savedPlan()
    // A plan only held.
    const heldPlan = await savedPlan()

    const base = {
      kind: 'tool' as const,
      userAgent: 'Claude-User',
      clientName: null,
      clientVersion: null,
      gateMissing: [],
      asked: {},
    }
    await telemetry.record({
      ...base,
      name: 'saoi_money_check',
      host: 'claude',
      sessionKey: 'a'.repeat(64),
      outcome: 'ok',
      ms: 120,
      card: true,
      savedPlanId: claimedPlan,
    })
    await telemetry.record({
      ...base,
      name: 'saoi_build_plan',
      host: 'claude',
      sessionKey: 'a'.repeat(64),
      outcome: 'ok',
      ms: 80,
      card: true,
      savedPlanId: heldPlan,
    })
    await telemetry.record({
      ...base,
      name: 'saoi_home_calculator',
      host: 'chatgpt',
      userAgent: 'openai-mcp/1.0',
      sessionKey: 'b'.repeat(64),
      outcome: 'gated',
      ms: 40,
      card: false,
      gateMissing: ['income'],
      asked: { price: '350-450k' },
      savedPlanId: null,
    })

    await plans.markOpened(claimedPlan)
    const claimed = await service
      .from('saved_plans')
      .update({
        claimed_at: new Date().toISOString(),
        claimed_by: visitor.user.id,
        case_id: visitor.caseId,
      })
      .eq('id', claimedPlan)
    expect(claimed.error).toBeNull()
    const events = await service.from('events').insert([
      { case_id: visitor.caseId, type: 'customer_signed_in', actor: 'customer', payload: {} },
      { case_id: visitor.caseId, type: 'product_chosen', actor: 'customer', payload: {} },
    ])
    expect(events.error).toBeNull()

    const reply = await request(app, 'GET', '/api/admin/ai-usage?period=7d', { token })
    expect(reply.status).toBe(200)
    expect(reply.body.totals).toEqual({
      calls: 3,
      sessions: 2,
      cardsShown: 2,
      plansSaved: 2,
      linksOpened: 1,
      claimed: 1,
      signedIn: 1,
      chosen: 1,
    })
    const claude = reply.body.funnel.find((entry: { host: string }) => entry.host === 'claude')
    expect(claude.steps.map((step: { count: number }) => step.count)).toEqual([2, 2, 2, 1, 1, 1, 1])
    expect(reply.body.gateMissing).toEqual([{ figure: 'income', count: 1 }])
    expect(reply.body.recent.map((call: { name: string }) => call.name)).toEqual([
      'saoi_home_calculator',
      'saoi_build_plan',
      'saoi_money_check',
    ])
    expect(reply.body.recent[0].asked).toEqual({ price: '350-450k' })
    expect(reply.body.nextCursor).toBeNull()

    // The plan's opening is recorded once, on the plan and on the call.
    const opened = await service
      .from('saved_plans')
      .select('opened_at')
      .eq('id', claimedPlan)
      .single()
    expect(opened.data?.opened_at).not.toBeNull()
  })

  it('pages the recent calls fifty at a time', async () => {
    const at = Date.now() - 60_000
    const rows = Array.from({ length: 55 }, (_, i) => ({
      kind: 'resource',
      name: 'saoi://about/earnings',
      host: 'other',
      outcome: 'ok',
      ms: 5,
      // The same instant for a run of them, so ties are broken by id.
      called_at: new Date(at - Math.floor(i / 10) * 1000).toISOString(),
    }))
    const inserted = await service.from('mcp_calls').insert(rows)
    expect(inserted.error).toBeNull()

    const first = await request(app, 'GET', '/api/admin/ai-usage?period=7d', { token })
    expect(first.body.recent).toHaveLength(50)
    expect(first.body.nextCursor).not.toBeNull()
    const second = await request(
      app,
      'GET',
      `/api/admin/ai-usage?period=7d&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { token },
    )
    expect(second.status).toBe(200)
    const ids = new Set([
      ...first.body.recent.map((call: { id: string }) => call.id),
      ...second.body.recent.map((call: { id: string }) => call.id),
    ])
    expect(ids.size).toBe(first.body.totals.calls)
    expect(second.body.nextCursor).toBeNull()
    expect(first.body.userAgents).toEqual([{ userAgent: '(none sent)', count: 55 }])
  })
})
