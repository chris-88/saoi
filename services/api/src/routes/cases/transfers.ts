import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { LINKABLE_BANKS } from '@shared/contracts/cards.ts'
import { applicationName } from '@shared/db/applications.ts'
import { caseFactReader } from '@shared/db/fact-reader.ts'
import { findApplication } from '@shared/db/applications.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { security } from '../common.ts'
import {
  actionErrors,
  caseIdParam,
  loadOrThrow,
  outcome,
  resultResponse,
  seatOf,
} from './actionKit.ts'
import { requireRole } from './policy.ts'

const transferBody = z
  .object({
    fromAccountId: z.uuid(),
    /** Null means the current account they already hold here, which the case must know of. */
    toApplicationId: z.uuid().nullable(),
    amount: z.number().positive().max(1_000_000),
    cadence: z.enum(['once', 'monthly']),
  })
  .openapi('InitiateTransfer')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/transfers',
  tags: ['open-banking'],
  summary: 'Initiate a transfer from a linked account',
  description:
    'Payment initiation, as an aggregator would do it: the consent must cover payments and ' +
    'still stand, the money must be there, and the destination must be an application on this ' +
    'case. The row is `initiated` until the console settles it. A one-off leaves the linked ' +
    'balance at once; a monthly one is a standing order and moves nothing today. Was ' +
    '`case-action` `initiate_transfer`.',
  security,
  middleware: [requireRole('initiate_transfer')],
  request: {
    params: z.object({ caseId: caseIdParam }),
    body: { required: true, content: { 'application/json': { schema: transferBody } } },
  },
  responses: { 201: resultResponse('Initiated.'), ...actionErrors },
})

export const transferRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const body = c.req.valid('json')
  const store = c.get('store')
  const { caseId } = seatOf(c.get('caseAccess'))

  const loaded = await loadOrThrow(store, caseId)
  const nameFor = await store.applicationNamer()

  const from = loaded.linkedAccounts.find((account) => account.id === body.fromAccountId)
  if (!from) throw new ApiError('not_found', 'That account is not linked.')
  if (!from.consentScope.includes('payments')) {
    throw new ApiError('forbidden', 'Nexus was not allowed to make payments from that account.')
  }
  if (Date.parse(from.consentExpiresAt) < Date.now()) {
    throw new ApiError('forbidden', 'The consent for that account has expired.')
  }

  const application =
    body.toApplicationId === null ? undefined : findApplication(loaded, body.toApplicationId)
  if (body.toApplicationId !== null && !application) {
    throw new ApiError('not_found', 'That application does not exist.')
  }
  // Into an account they already hold here only when the case knows they hold one.
  if (
    body.toApplicationId === null &&
    caseFactReader(loaded)?.boolean('banking.existingCustomer', 'primary') !== true
  ) {
    throw new ApiError('bad_request', 'There is no account here to move the money into yet.')
  }
  if (body.cadence === 'once' && body.amount > from.balance) {
    throw new ApiError(
      'bad_request',
      `That is more than the account holds (€${from.balance.toLocaleString('en-IE')}).`,
    )
  }

  const bankName = LINKABLE_BANKS.find((bank) => bank.id === from.bank)?.name ?? from.bank
  const toLabel =
    application === undefined
      ? 'Your Demo Bank current account'
      : applicationName(application, nameFor)

  await store.saveTransfer({
    caseId,
    fromAccountId: from.id,
    toApplicationId: body.toApplicationId,
    toLabel,
    amount: body.amount,
    cadence: body.cadence,
    newBalance:
      body.cadence === 'once' ? Math.round((from.balance - body.amount) * 100) / 100 : null,
    event: {
      amount: body.amount,
      from: bankName,
      fromAccount: from.displayName,
      to: toLabel,
      cadence: body.cadence,
      applicationName: toLabel,
    },
  })

  const amount = `€${body.amount.toLocaleString('en-IE')}`
  const summary =
    body.cadence === 'once'
      ? `${amount} on its way from ${bankName} to your ${toLabel}.`
      : `${amount} a month will go from ${bankName} to your ${toLabel}.`
  return c.json(await outcome(store, caseId, nameFor, summary), 201)
})
