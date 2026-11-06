import type { Journey, Product } from '../journey.ts'
import { mortgage } from './mortgage.ts'
import { currentAccount } from './current-account.ts'
import { jointAccount } from './joint-account.ts'
import { creditCard } from './credit-card.ts'
import { personalLoan } from './personal-loan.ts'
import { protection } from './protection.ts'
import { savings } from './savings.ts'

/**
 * Every supported journey, keyed by product (§7). All are `draft` until matched against their
 * recording, at which point `status` becomes `final` and `source` names the file and timestamp.
 */
export const journeys = {
  mortgage,
  current_account: currentAccount,
  joint_account: jointAccount,
  credit_card: creditCard,
  personal_loan: personalLoan,
  protection,
  savings,
} as const satisfies Record<Product, Journey>

export function journeyFor(product: Product): Journey {
  return journeys[product]
}

export const ALL_JOURNEYS: readonly Journey[] = Object.values(journeys)

export { mortgage, currentAccount, jointAccount, creditCard, personalLoan, protection, savings }
