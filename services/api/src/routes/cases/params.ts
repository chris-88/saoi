import { z } from '@hono/zod-openapi'

export const caseParams = z.object({
  caseId: z.uuid().openapi({
    param: { name: 'caseId', in: 'path' },
    example: '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11',
  }),
})
