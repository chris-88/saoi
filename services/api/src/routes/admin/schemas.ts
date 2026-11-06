import { adminRequestSchema, type AdminRequest } from '@shared/contracts/admin.ts'
import type { z } from 'zod'

type Option = (typeof adminRequestSchema.options)[number]
type Named<A extends AdminRequest['action']> = Extract<
  Option,
  { shape: { action: z.ZodLiteral<A> } }
>
type BodyOf<A extends AdminRequest['action']> = z.ZodObject<
  Extract<Omit<Named<A>['shape'], 'action'>, z.core.$ZodShape>,
  z.core.$strip
>

/**
 * The body of one admin action, as the contract already defines it, without the `action`
 * discriminator (the URL says what to do). Keeps `_shared/contracts/admin.ts` the single
 * description of every request. Use `.extend(...)` to add fields and `.omit(...)` to drop the
 * ones the URL carries.
 */
export function actionBody<A extends AdminRequest['action']>(name: A): BodyOf<A> {
  const option = adminRequestSchema.options.find(
    (candidate) => candidate.shape.action.value === name,
  )
  if (option === undefined) throw new Error(`No admin action called ${name}`)
  const omit = option.omit.bind(option) as (mask: { action: true }) => unknown
  return omit({ action: true }) as BodyOf<A>
}
