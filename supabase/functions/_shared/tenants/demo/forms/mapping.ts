import type { Product } from '../../../domain/journey.ts'
import { LOAN_PREFILL, SUPERSAVER_PREFILL, type Prefill } from './prefill.ts'

/**
 * Which of the bank's digital forms completes which product journey.
 *
 * One table, so adding the next form is one line here plus its snapshot. The product is Saoirse's
 * own vocabulary and the form id is the bank's: keeping the join in one place is what stops a
 * form id appearing in the conversation layer or a product id appearing in a packet.
 *
 * A product with no entry has no form yet. That is the normal state for most of the catalogue
 * and it is not an error: the case still runs through Saoirse's own journey, there is simply no
 * published definition to map it onto.
 */

export type FormMapping = {
  readonly formId: string
  readonly prefill: readonly Prefill[]
}

const BY_PRODUCT: Partial<Readonly<Record<Product, FormMapping>>> = {
  savings: { formId: '1833', prefill: SUPERSAVER_PREFILL },
  personal_loan: { formId: '1940', prefill: LOAN_PREFILL },
}

export function formForProduct(product: Product): FormMapping | null {
  return BY_PRODUCT[product] ?? null
}

/** Products that have a form, for the console's own listing. */
export function productsWithForms(): readonly Product[] {
  return Object.keys(BY_PRODUCT) as Product[]
}
