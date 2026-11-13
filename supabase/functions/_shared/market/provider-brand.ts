/**
 * Each market provider's brand colour, for the monogram a card draws when there is no logo:
 * `bg` is the brand's primary colour (the dominant colour of its icon or wordmark where it has no
 * single one), `fg` the initials on it: white when white reaches 3:1 against `bg`, else black
 * (`textOn`). Copied from saoi-admin's `src/admin/marketBrand.ts` (2026-11-13) so the products
 * card (`market_products` rows' `brand`) and the console read one table; saoi-admin syncs to this
 * copy with `shared:sync`.
 *
 * 3:1 is the floor, not WCAG AA for text (4.5:1). The monogram stands in for the provider's logo,
 * and logotypes are exempt from 1.4.3; the provider's name sits beside it in full contrast, so
 * the tile never carries the name alone. That lets white sit on the brands that use it (PTSB,
 * EBS, Bankinter, An Post, Raisin) as their own marks do.
 *
 * Every id the market can carry: `provider-names.ts` and `raisin`, the platform. A provider not
 * listed here keeps the neutral monogram (`brandOf` gives null).
 *
 * Sources, all read 2026-11-13. "favicon" is the provider's own site icon as served by Google's
 * favicon service (https://www.google.com/s2/favicons?domain=<domain>&sz=128), so the colour is
 * read off the brand's icon without requesting the provider's site; "Wikipedia logo" is the
 * logo file in the article's infobox. The hex is the icon's most common opaque, non-white pixel.
 * Pure.
 */

export type Brand = { readonly bg: string; readonly fg: '#fff' | '#000' }

export const MARKET_BRANDS: Readonly<Record<string, Brand>> = {
  // favicon aib.ie (the purple of the AIB mark); Wikipedia logo
  // https://en.wikipedia.org/wiki/File:Allied_Irish_Banks_logo.svg has the same purples.
  aib: { bg: '#6a2d7a', fg: '#fff' },
  // favicon bankofireland.com; Wikipedia logo https://en.wikipedia.org/wiki/File:Bank_of_Ireland.svg
  // fills #00f, the same blue.
  boi: { bg: '#0000ff', fg: '#fff' },
  // Wikipedia logo https://en.wikipedia.org/wiki/File:PTSB_logo_2023.png (the orange wordmark;
  // the favicon permanenttsb.ie is the same orange on near-black).
  ptsb: { bg: '#fc4c02', fg: '#fff' },
  // favicon ebs.ie (the red); Wikipedia logo https://en.wikipedia.org/wiki/File:EBS_Limited_Logo.jpg
  // is a deeper red, #cf0721.
  ebs: { bg: '#ee1c25', fg: '#fff' },
  // favicon bunq.com: a rainbow of stripes with no one primary; its first and widest, the green.
  bunq: { bg: '#008145', fg: '#fff' },
  // favicon moco.ie (the mint of the house mark).
  moco: { bg: '#2ed2ae', fg: '#000' },
  // favicon revolut.com; the black wordmark of Wikipedia logo
  // https://commons.wikimedia.org/wiki/File:Revolut_logo.svg.
  revolut: { bg: '#000000', fg: '#fff' },
  // favicon anpost.com; Wikipedia logo https://en.wikipedia.org/wiki/File:An_Post_Logo.svg fills
  // #00b065, a near match.
  an_post_money: { bg: '#00a76a', fg: '#fff' },
  // favicon avantmoney.ie (the near-black mark).
  avant_money: { bg: '#202020', fg: '#fff' },
  // favicon havenmortgages.ie (the green of the "h").
  haven: { bg: '#00cd0c', fg: '#000' },
  // favicon icsmortgages.ie (the crimson behind the mark).
  ics_mortgages: { bg: '#d0023c', fg: '#fff' },
  // nuamoney.com's touch icon (public/logos/nua_money.png, from `npm run logos:fetch`): the
  // dark green behind the mark. Google's favicon service has no icon for the domain.
  nua_money: { bg: '#01241e', fg: '#fff' },
  // favicon statesavings.ie (the green harp).
  state_savings: { bg: '#73bf44', fg: '#000' },
  // favicon bankinter.com; Wikipedia logo https://commons.wikimedia.org/wiki/File:Bankinter.svg
  // fills #f76900, a near match.
  bankinter: { bg: '#f35f00', fg: '#fff' },
  // Raisin Bank AG fronts the Raisin platform under its brand: favicon raisin.ie ("Raisin Blue",
  // the arrow; https://www.raisin.com/en/corporate/press/raisin-launches-new-brand-look/).
  raisin_bank: { bg: '#3096ff', fg: '#fff' },
  raisin: { bg: '#3096ff', fg: '#fff' },
  // favicon www.bancacfplus.it (the white CF+ on navy; the bare domain's is a stock piggy bank).
  banca_cf: { bg: '#0d1c2f', fg: '#fff' },
  // favicon nordax.com (the navy behind the mint N).
  nordax: { bg: '#09264e', fg: '#fff' },
  // favicon creditplus.de (the teal, with red and dark green beside it).
  creditplus: { bg: '#00aab8', fg: '#000' },
  // favicon iblbanca.it (the navy, with yellow beside it).
  ibl_banca: { bg: '#004882', fg: '#fff' },
  // favicon aareal-bank.com (the navy); Wikipedia logo
  // https://en.wikipedia.org/wiki/File:Aareal_Bank_Logo.svg has a lighter blue square, #005fa9.
  aareal: { bg: '#002a5f', fg: '#fff' },
  // The Irish League of Credit Unions: favicon creditunion.ie (the teal of the hands mark).
  credit_union: { bg: '#00728f', fg: '#fff' },
  credit_union_mortgages: { bg: '#00728f', fg: '#fff' },
}

/** The provider's brand colours, or null for the neutral monogram. */
export function brandOf(provider: string): Brand | null {
  return Object.hasOwn(MARKET_BRANDS, provider) ? (MARKET_BRANDS[provider] ?? null) : null
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`)
  const channel = (at: number): number => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG 2 contrast ratio between two `#rrggbb` (or `#fff`/`#000`) colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(expand(a)), luminance(expand(b))]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The contrast floor for a monogram's initials: a logotype stand-in, not body text. */
export const MONOGRAM_MIN_CONTRAST = 3

/** The monogram's initials on `bg`: white when it reaches 3:1, else black. */
export function textOn(bg: string): '#fff' | '#000' {
  return contrastRatio(bg, '#fff') >= MONOGRAM_MIN_CONTRAST ? '#fff' : '#000'
}

const expand = (hex: string): string =>
  /^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
