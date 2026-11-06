import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { CONSENT_SCOPE, LINKABLE_BANKS, LINKABLE_BANK_IDS } from '@shared/contracts/cards.ts'
import { caseFactReader, emptyFactReader } from '@shared/db/fact-reader.ts'
import { CONSENT_DAYS, synthesiseAccounts } from '@shared/domain/open-banking/synthesise.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { security } from '../common.ts'
import {
  actionErrors,
  caseIdParam,
  describeScope,
  loadOrThrow,
  outcome,
  resultResponse,
  seatOf,
} from './actionKit.ts'
import { requireRole } from './policy.ts'

/**
 * Open banking, simulated (§6, §53). There is no aggregator to call: the accounts Nexus would
 * return are generated from the case's own facts and written as if they had been read. The
 * consent is the real part: a scope, an expiry, and nothing read outside either.
 */

const linkBody = z
  .object({
    bank: z.enum(LINKABLE_BANK_IDS),
    scope: z.array(z.enum(CONSENT_SCOPE)).min(1),
  })
  .openapi('LinkAccounts')

const link = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/linked-accounts',
  tags: ['open-banking'],
  summary: 'Link a bank’s accounts under a consent',
  description:
    'The consent tap on the `connect_accounts` card. Linking the same bank twice is linking it ' +
    'once. Was `case-action` `link_accounts`.',
  security,
  middleware: [requireRole('link_accounts')],
  request: {
    params: z.object({ caseId: caseIdParam }),
    body: { required: true, content: { 'application/json': { schema: linkBody } } },
  },
  responses: { 201: resultResponse('Linked, or already linked.'), ...actionErrors },
})

const revoke = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/linked-accounts/revoke',
  tags: ['open-banking'],
  summary: 'Withdraw the consent',
  description:
    'The rows stay, marked, so the inspector can still say what was linked and when it was ' +
    'let go; nothing downstream reads a revoked account again. Was `case-action` ' +
    '`revoke_accounts`.',
  security,
  middleware: [requireRole('revoke_accounts')],
  request: { params: z.object({ caseId: caseIdParam }) },
  responses: { 200: resultResponse('Withdrawn.'), ...actionErrors },
})

export const linkedAccountRoutes = new OpenAPIHono<AppEnv>()
  .openapi(link, async (c) => {
    const body = c.req.valid('json')
    const store = c.get('store')
    const { caseId } = seatOf(c.get('caseAccess'))

    const bank = LINKABLE_BANKS.find((candidate) => candidate.id === body.bank)
    if (!bank) throw new ApiError('bad_request', 'That bank cannot be linked.')

    const loaded = await loadOrThrow(store, caseId)
    const nameFor = await store.applicationNamer()

    // Linking the same bank twice is linking it once. The rows already there are the answer.
    if (loaded.linkedAccounts.some((account) => account.bank === body.bank)) {
      const summary = `Your ${bank.name} accounts are already linked.`
      return c.json(await outcome(store, caseId, nameFor, summary), 201)
    }

    const prepared = synthesiseAccounts({
      bank: body.bank,
      bankName: bank.name,
      facts: caseFactReader(loaded) ?? emptyFactReader,
      today: new Date().toISOString().slice(0, 10),
      // The case and the bank, so the same customer sees the same statement on every visit
      // and a second bank is a different one.
      seed: `${caseId}:${body.bank}`,
    })
    const consentExpiresAt = new Date(Date.now() + CONSENT_DAYS * 86_400_000).toISOString()
    await store.saveLinkedAccounts({
      caseId,
      bank: body.bank,
      bankName: bank.name,
      prepared,
      scope: body.scope,
      consentExpiresAt,
    })

    const count = prepared.accounts.length
    const summary =
      `Linked ${String(count)} ${count === 1 ? 'account' : 'accounts'} at ${bank.name}. ` +
      `Nexus will share ${describeScope(body.scope)} for ${String(CONSENT_DAYS)} days.`
    return c.json(await outcome(store, caseId, nameFor, summary), 201)
  })
  .openapi(revoke, async (c) => {
    const store = c.get('store')
    const { caseId } = seatOf(c.get('caseAccess'))

    const loaded = await loadOrThrow(store, caseId)
    const nameFor = await store.applicationNamer()
    if (loaded.linkedAccounts.length === 0) {
      return c.json(await outcome(store, caseId, nameFor, 'Nothing is linked.'), 200)
    }

    await store.revokeLinkedAccounts({
      caseId,
      accounts: loaded.linkedAccounts.length,
      banks: [...new Set(loaded.linkedAccounts.map((account) => account.bank))],
    })
    const summary = 'Nexus access withdrawn. Nothing more will be read from those accounts.'
    return c.json(await outcome(store, caseId, nameFor, summary), 200)
  })
