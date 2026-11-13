import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The app first: it loads @hono/zod-openapi, which has to extend zod before any shared schema
// is built, or the routes' `.openapi()` calls find nothing.
import { adminTestApp } from './testing.ts'
import { adminMarketViewsSchema, type AdminMarketView } from '@shared/contracts/market.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import type { AdminMarketStore } from '../../store/admin/market.ts'

const PATH = '/api/admin/market/views'

const store: AdminMarketStore = {
  list: () => Promise.reject(new Error('list not faked')),
  views: () => Promise.resolve(normaliseMarket(MARKET_FIXTURE, { includePlatforms: true })),
}

async function views(): Promise<AdminMarketView[]> {
  const { send } = adminTestApp({ market: store })
  const reply = await send('admin', 'GET', PATH)
  expect(reply.status).toBe(200)
  return adminMarketViewsSchema.parse(await reply.json()).views
}

describe('admin market views route', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T09:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('403 for a non-admin, 401 anonymous', async () => {
    const { send } = adminTestApp({ market: store })
    expect((await send('user', 'GET', PATH)).status).toBe(403)
    expect((await send('anonymous', 'GET', PATH)).status).toBe(401)
  })

  it('one entry where a bank row and its CCPC twins fold, with every source listed', async () => {
    const all = await views()
    const advantage = all.filter((view) => view.id === 'boi:savings.advantage_fixed')
    expect(advantage).toHaveLength(1)
    const view = advantage[0]
    expect(view).toMatchObject({
      provider: 'boi',
      providerName: 'Bank of Ireland',
      category: 'deposits',
      categoryLabel: 'Deposits',
      access: 'Fixed term',
      termMonths: 6,
      retired: false,
    })
    expect(view?.sources[0]).toMatchObject({ source: 'bank', rowId: 'boi:savings.advantage_fixed' })
    const ccpc = view?.sources.filter((source) => source.source === 'ccpc') ?? []
    expect(ccpc).toHaveLength(3)
    for (const source of view?.sources ?? []) {
      expect(source.url).toMatch(/^https:\/\//)
      expect(source.checkedAt).toMatch(/^2026-/)
    }
    // No row folded into it is listed again on its own.
    const rowIds = new Set(view?.sources.map((source) => source.rowId))
    expect(all.filter((other) => other !== view && rowIds.has(other.id))).toEqual([])
  })

  it('a CCPC ladder is one entry, its terms ascending, the shortest as the term', async () => {
    const ladders = (await views()).filter(
      (view) => view.id.includes('.ladder_') && view.ladder.length > 1,
    )
    expect(ladders.length).toBeGreaterThan(0)
    for (const ladder of ladders) {
      const months = ladder.ladder.map((rung) => rung.months)
      expect(months).toEqual([...months].sort((a, b) => a - b))
      expect(ladder.termMonths).toBe(months[0])
      expect(ladder.termLabel).toContain(' to ')
      expect(ladder.headline.ratePct).toBe(ladder.ladder[0]?.ratePct)
      expect(ladder.sources.length).toBe(ladder.ladder.length)
      expect(ladder.sources.every((source) => source.source === 'ccpc')).toBe(true)
    }
  })

  it('labels every category', async () => {
    const labels = new Map((await views()).map((view) => [view.category, view.categoryLabel]))
    expect(Object.fromEntries(labels)).toEqual({
      savings: 'Savings',
      deposits: 'Deposits',
      mortgages: 'Mortgages',
      loans: 'Loans',
      credit_cards: 'Credit cards',
      current_accounts: 'Current accounts',
    })
  })

  it('gives the term fields by kind', async () => {
    const all = await views()
    const fixedMortgage = all.find(
      (view) => view.category === 'mortgages' && view.termLabel?.endsWith('-year fixed'),
    )
    expect(fixedMortgage?.termMonths).toBe(Number(fixedMortgage?.termLabel?.split('-')[0]) * 12)
    expect(fixedMortgage?.headline.label).toMatch(/^\d+\.\d{2}% initial$/)

    // The fixture has no variable-rate mortgage; a variable savings rate is labelled the same way.
    const loan = all.find((view) => view.category === 'loans' && view.termMonths !== null)
    expect(loan?.termLabel).toMatch(/^up to /)
    expect(loan?.headline.label).toMatch(/^APR \d+\.\d{2}%$/)

    const instant = all.find((view) => view.id === 'boi:savings.instant_access')
    expect(instant).toMatchObject({
      access: 'Instant access',
      termMonths: null,
      termLabel: 'variable',
      ladder: [],
    })
    expect(instant?.headline.label).toMatch(/% AER$/)

    for (const view of all.filter(
      (one) => one.category === 'credit_cards' || one.category === 'current_accounts',
    )) {
      expect(view).toMatchObject({ termMonths: null, termLabel: null, ladder: [], access: null })
    }
  })

  it('words each view: rate lines, conditions, unknowns, staleness', async () => {
    const all = await views()
    for (const view of all) {
      expect(view.lines.length).toBeGreaterThan(0)
      expect(view.providerName).not.toBe('')
      // Fixture rows were checked on 2026-11-09: four days before.
      expect(view.stale).toBe(false)
    }
    const supersaver = all.find((view) => view.id === 'boi:savings.supersaver')
    expect(supersaver?.category).toBe('savings')
    expect(supersaver?.conditions.map((condition) => condition.label)).toContain('Monthly saving')
    // Raisin's platform banks are listed, named as the bank that holds the deposit.
    expect(
      all.some((view) => view.provider === 'aareal' && view.providerName === 'Aareal Bank'),
    ).toBe(true)
  })

  it('is stale after 8 whole days', async () => {
    vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'))
    const view = (await views()).find((one) => one.id === 'boi:savings.supersaver')
    expect(view?.stale).toBe(true)
  })

  it('is listed in the OpenAPI document', async () => {
    const { app } = adminTestApp({ market: store })
    const doc = (await (await app.request('/api/openapi.json')).json()) as {
      paths: Record<string, unknown>
    }
    expect(Object.keys(doc.paths)).toContain(PATH)
  })
})
