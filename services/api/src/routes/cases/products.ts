import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { PRODUCTS } from '@shared/domain/journey.ts'
import type { AppEnv } from '../../context.ts'
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

/** Choosing products, and leaving one to one side (§6 Stage 6, §49). */

const selectBody = z
  .object({
    /**
     * A kind, and optionally which product of that kind: "SuperSaver and the notice account"
     * are both `savings`, so a bare list of kinds could not say two.
     */
    products: z
      .array(
        z.object({
          product: z.enum(PRODUCTS),
          catalogueId: z.string().min(1).max(80).optional(),
        }),
      )
      .min(1)
      .max(5),
  })
  .openapi('SelectProducts')

const select = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/products/select',
  tags: ['products'],
  summary: 'Start applications for the products the customer chose',
  description: 'Several applications start at once. Was `case-action` `select_products`.',
  security,
  middleware: [requireRole('select_products')],
  request: {
    params: z.object({ caseId: caseIdParam }),
    body: { required: true, content: { 'application/json': { schema: selectBody } } },
  },
  responses: { 200: resultResponse('Started, with every application redrawn.'), ...actionErrors },
})

const decline = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/products/{product}/decline',
  tags: ['products'],
  summary: 'Leave a product to one side',
  description:
    'Declining twice is declining once: the repeat writes no second event. Saoirse will not raise ' +
    'it again (§49). Was `case-action` `decline_product`.',
  security,
  middleware: [requireRole('decline_product')],
  request: {
    params: z.object({
      caseId: caseIdParam,
      product: z.enum(PRODUCTS).openapi({ param: { name: 'product', in: 'path' } }),
    }),
  },
  responses: { 200: resultResponse('Noted.'), ...actionErrors },
})

export const productRoutes = new OpenAPIHono<AppEnv>()
  .openapi(select, async (c) => {
    const { products } = c.req.valid('json')
    const store = c.get('store')
    const { caseId } = seatOf(c.get('caseAccess'))

    const loaded = await loadOrThrow(store, caseId)
    const nameFor = await store.applicationNamer()
    const { created, reused } = await store.startApplications(loaded, products, nameFor)

    const names = created.map((choice) => nameFor(choice.product, choice.catalogueId ?? null))
    const summary =
      created.length === 0
        ? 'Those were already started.'
        : `Started ${names.join(', ')}.` +
          (reused > 0
            ? ` ${String(reused)} ${reused === 1 ? 'thing' : 'things'} carried over from what we already knew.`
            : '')
    return c.json(await outcome(store, caseId, nameFor, summary), 200)
  })
  .openapi(decline, async (c) => {
    const { product } = c.req.valid('param')
    const store = c.get('store')
    const { caseId } = seatOf(c.get('caseAccess'))

    const loaded = await loadOrThrow(store, caseId)
    const nameFor = await store.applicationNamer()
    const already = loaded.productInterests.some(
      (interest) => interest.product === product && interest.status === 'declined',
    )
    if (!already) await store.declineProduct(caseId, product)

    const summary = already
      ? 'Already left to one side.'
      : 'Noted — I will not bring that up again.'
    return c.json(await outcome(store, caseId, nameFor, summary), 200)
  })
