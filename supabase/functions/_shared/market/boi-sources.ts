import type { MarketCategory } from './schema.ts'

/**
 * The Bank of Ireland pages market data is read from: one public product page per product Saoi
 * models, plus the deposit-rates page that names the current rate sheet.
 *
 * The rate sheet itself is a PDF, and Bank of Ireland's robots.txt disallows `/*.pdf$`, so the
 * figures come from the HTML product pages, which state them in full. Shared rather than kept
 * in the script because the overlay needs the list too: a product listed here that the dataset
 * has no row for shows no rate at all, rather than the catalogue's old figure.
 */

export const BOI_ORIGIN = 'https://personalbanking.bankofireland.com'

const savings = `${BOI_ORIGIN}/save-and-invest/savings`

export const BOI_RATE_SHEET_PAGE = `${savings}/bank-of-ireland-deposit-rates/`

export type MarketSource = {
  readonly productId: string
  readonly category: MarketCategory
  readonly url: string
}

export const BOI_SOURCES: readonly MarketSource[] = [
  {
    productId: 'savings.supersaver',
    category: 'savings',
    url: `${savings}/regular-savings-accounts/supersaver-account/features-and-benefits/`,
  },
  {
    productId: 'savings.goalsaver',
    category: 'savings',
    url: `${savings}/regular-savings-accounts/goalsaver-account/features-and-benefits/`,
  },
  {
    productId: 'savings.mortgagesaver',
    category: 'savings',
    url: `${savings}/regular-savings-accounts/mortgagesaver/`,
  },
  {
    productId: 'savings.instant_access',
    category: 'deposit',
    url: `${savings}/instant-access-and-notice-accounts/demand-deposit-account/features-and-benefits/`,
  },
  {
    productId: 'savings.notice_31_day',
    category: 'deposit',
    url: `${savings}/online-deposits/365-31-day-notice-account/features-and-benefits/`,
  },
  {
    productId: 'savings.advantage_fixed',
    category: 'deposit',
    url: `${savings}/fixed-term-savings-accounts/advantage-deposit-account/features-and-benefits/`,
  },
]

/** The catalogue ids whose figures come from market data and nowhere else. */
export const BOI_MARKET_PRODUCT_IDS: ReadonlySet<string> = new Set(
  BOI_SOURCES.map((source) => source.productId),
)
