import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  catalogueLoadSchema,
  catalogueOverridesSchema,
  catalogueWriteSchema,
} from '@shared/contracts/admin.ts'
import { mortgageRatesListSchema, productCatalogueListSchema } from '@shared/contracts/catalogue.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { actionBody } from './schemas.ts'

/**
 * Plan §3.2 and §51: the console's catalogue screens. Reworded goals and needs, the product
 * catalogue and the mortgage rate table. Was the `admin` actions `catalogue_overrides`,
 * `set_catalogue_override`, `clear_catalogue_override`, `list_products`, `set_product` and the
 * rest of that family.
 */

const forbidden = errorResponse('Not an administrator.')
const invalid = errorResponse('The request is not valid.')

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } })
const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: json(schema),
})

const rowId = z.string().trim().min(1).max(80)
const productPath = z.object({ id: rowId.min(3) })
const ratePath = z.object({ id: rowId })
const overridePath = z.object({
  kind: z.enum(['goal', 'need']),
  entryId: z.string().min(1).max(120),
})

const writeResponse = ok('The row’s new version.', catalogueWriteSchema.openapi('CatalogueWrite'))
const loadResponse = ok(
  'How many rows were copied in from the published file.',
  catalogueLoadSchema.openapi('CatalogueLoad'),
)
const deletedResponse = ok(
  'The row is gone.',
  z.object({ deleted: z.literal(true) }).openapi('CatalogueRowDeleted'),
)

const productBody = actionBody('set_product').omit({ id: true }).openapi('ProductWrite')
const rateBody = actionBody('set_rate').omit({ id: true }).openapi('RateWrite')
const overrideBody = actionBody('set_catalogue_override')
  .omit({ kind: true, entryId: true })
  .openapi('CatalogueOverrideWrite')

const writeErrors = {
  ...authenticatedErrors,
  400: invalid,
  403: forbidden,
}

const listProducts = createRoute({
  method: 'get',
  path: '/api/admin/products',
  tags: ['admin'],
  summary: 'The product catalogue as rows',
  description:
    'Until something is loaded, the published file itself, marked as such. Was `admin` action `list_products`.',
  security,
  responses: {
    200: ok('The rows.', productCatalogueListSchema.openapi('ProductCatalogueList')),
    ...authenticatedErrors,
    403: forbidden,
  },
})

const setProduct = createRoute({
  method: 'put',
  path: '/api/admin/products/{id}',
  tags: ['admin'],
  summary: 'Save a product',
  description:
    'Copies the published file in first if the table is empty. The product’s own id must match ' +
    'the path. Was `admin` action `set_product`.',
  security,
  request: {
    params: productPath,
    body: { required: true, content: json(productBody) },
  },
  responses: { 200: writeResponse, ...writeErrors },
})

const deleteProduct = createRoute({
  method: 'delete',
  path: '/api/admin/products/{id}',
  tags: ['admin'],
  summary: 'Delete a product row',
  description:
    'Copies the published file in first, so deleting one row never leaves a one-row catalogue. ' +
    'Was `admin` action `delete_product`.',
  security,
  request: { params: productPath },
  responses: { 200: deletedResponse, ...writeErrors },
})

const loadProducts = createRoute({
  method: 'post',
  path: '/api/admin/products/load-published',
  tags: ['admin'],
  summary: 'Load the published products',
  description:
    'Adds the rows that are missing and leaves existing ones alone. Was `admin` action `load_published_products`.',
  security,
  responses: { 200: loadResponse, ...authenticatedErrors, 403: forbidden },
})

const restoreProduct = createRoute({
  method: 'post',
  path: '/api/admin/products/{id}/restore',
  tags: ['admin'],
  summary: 'Restore a product to the published wording',
  description:
    'A product the file does not have is removed (version 0). Was `admin` action `restore_published_product`.',
  security,
  request: { params: ratePath },
  responses: { 200: writeResponse, ...writeErrors },
})

const listRates = createRoute({
  method: 'get',
  path: '/api/admin/rates',
  tags: ['admin'],
  summary: 'The mortgage rate table as rows',
  description: 'Was `admin` action `list_rates`.',
  security,
  responses: {
    200: ok(
      'The rows and the date every quote carries.',
      mortgageRatesListSchema.openapi('MortgageRatesList'),
    ),
    ...authenticatedErrors,
    403: forbidden,
  },
})

const setRate = createRoute({
  method: 'put',
  path: '/api/admin/rates/{id}',
  tags: ['admin'],
  summary: 'Save a mortgage rate',
  description: 'The rate’s own id must match the path. Was `admin` action `set_rate`.',
  security,
  request: {
    params: ratePath,
    body: { required: true, content: json(rateBody) },
  },
  responses: { 200: writeResponse, ...writeErrors },
})

const deleteRate = createRoute({
  method: 'delete',
  path: '/api/admin/rates/{id}',
  tags: ['admin'],
  summary: 'Delete a rate row',
  description: 'Seeds the published table first. Was `admin` action `delete_rate`.',
  security,
  request: { params: ratePath },
  responses: { 200: deletedResponse, ...writeErrors },
})

const loadRates = createRoute({
  method: 'post',
  path: '/api/admin/rates/load-published',
  tags: ['admin'],
  summary: 'Load the published rates',
  description: 'Was `admin` action `load_published_rates`.',
  security,
  responses: { 200: loadResponse, ...authenticatedErrors, 403: forbidden },
})

const restoreRate = createRoute({
  method: 'post',
  path: '/api/admin/rates/{id}/restore',
  tags: ['admin'],
  summary: 'Restore a rate to the published figures',
  description: 'Was `admin` action `restore_published_rate`.',
  security,
  request: { params: ratePath },
  responses: { 200: writeResponse, ...writeErrors },
})

const listOverrides = createRoute({
  method: 'get',
  path: '/api/admin/catalogue-overrides',
  tags: ['admin'],
  summary: 'Reworded goals and needs',
  description: 'Was `admin` action `catalogue_overrides`.',
  security,
  responses: {
    200: ok('Every override there is.', catalogueOverridesSchema.openapi('CatalogueOverrides')),
    ...authenticatedErrors,
    403: forbidden,
  },
})

const setOverride = createRoute({
  method: 'put',
  path: '/api/admin/catalogue-overrides/{kind}/{entryId}',
  tags: ['admin'],
  summary: 'Reword a goal or need, or switch it off',
  description:
    'Checked against the compiled catalogue first: an unknown entry, milestone or check-in is refused. ' +
    'Was `admin` action `set_catalogue_override`.',
  security,
  request: {
    params: overridePath,
    body: { required: true, content: json(overrideBody) },
  },
  responses: {
    200: writeResponse,
    ...writeErrors,
    404: errorResponse('No goal or need has that id.'),
  },
})

const clearOverride = createRoute({
  method: 'delete',
  path: '/api/admin/catalogue-overrides/{kind}/{entryId}',
  tags: ['admin'],
  summary: 'Go back to the compiled wording',
  description: 'Was `admin` action `clear_catalogue_override`.',
  security,
  request: { params: overridePath },
  responses: {
    200: ok(
      'The override is gone.',
      z.object({ cleared: z.literal(true) }).openapi('CatalogueOverrideCleared'),
    ),
    ...writeErrors,
  },
})

export const catalogueRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listProducts, async (c) => c.json(await c.get('admin').catalogue.listProducts(), 200))
  // `load-published` is a literal and has one segment fewer than `{id}/restore`; no clash.
  .openapi(loadProducts, async (c) =>
    c.json(await c.get('admin').catalogue.loadPublishedProducts(), 200),
  )
  .openapi(setProduct, async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    return c.json(await c.get('admin').catalogue.setProduct(id, body.product, body.enabled), 200)
  })
  .openapi(deleteProduct, async (c) => {
    await c.get('admin').catalogue.deleteProduct(c.req.valid('param').id)
    return c.json({ deleted: true as const }, 200)
  })
  .openapi(restoreProduct, async (c) =>
    c.json(await c.get('admin').catalogue.restoreProduct(c.req.valid('param').id), 200),
  )
  .openapi(listRates, async (c) => c.json(await c.get('admin').catalogue.listRates(), 200))
  .openapi(loadRates, async (c) => c.json(await c.get('admin').catalogue.loadPublishedRates(), 200))
  .openapi(setRate, async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    return c.json(await c.get('admin').catalogue.setRate(id, body.rate, body.enabled), 200)
  })
  .openapi(deleteRate, async (c) => {
    await c.get('admin').catalogue.deleteRate(c.req.valid('param').id)
    return c.json({ deleted: true as const }, 200)
  })
  .openapi(restoreRate, async (c) =>
    c.json(await c.get('admin').catalogue.restoreRate(c.req.valid('param').id), 200),
  )
  .openapi(listOverrides, async (c) => c.json(await c.get('admin').catalogue.listOverrides(), 200))
  .openapi(setOverride, async (c) => {
    const { kind, entryId } = c.req.valid('param')
    const body = c.req.valid('json')
    return c.json(await c.get('admin').catalogue.setOverride({ kind, entryId, ...body }), 200)
  })
  .openapi(clearOverride, async (c) => {
    const { kind, entryId } = c.req.valid('param')
    await c.get('admin').catalogue.clearOverride(kind, entryId)
    return c.json({ cleared: true as const }, 200)
  })
