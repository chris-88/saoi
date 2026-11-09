/**
 * Which deposit guarantee covers each provider Saoi compares for savings and deposits, read from
 * primary pages: the provider's own depositor information sheet or terms, the Central Bank of
 * Ireland's Credit Institutions Register, depositguarantee.ie, statesavings.ie. Each entry
 * names the page and the day it was read. A provider not listed here is unknown, and the
 * comparison says so; nothing is assumed.
 *
 * Checked 2026-11-09. Where a provider's own site refused automated reads (aib.ie, ptsb.ie,
 * bankinter.ie, avantmoney.ie), the entry cites the provider's own document as published and
 * was confirmed against the register; re-read them by hand at the next review.
 *
 * The engine reads this in `domain/market/normalise.ts`.
 */

export type GuaranteeRecord = {
  /** The scheme's name; null where the provider's money is not covered by any scheme. */
  readonly scheme: string | null
  readonly country: string
  /** Per person per institution; null where no limit applies or none is covered. */
  readonly coverEur: number | null
  readonly note: string | null
  readonly sourceUrl: string
  readonly checkedOn: string
}

const CHECKED = '2026-11-09'
const IRISH_DGS = 'Deposit Guarantee Scheme (Ireland, run by the Central Bank of Ireland)'
const CBI_REGISTER = 'https://registers.centralbank.ie/prerenderedreports/2.pdf'

export const DEPOSIT_GUARANTEES: Readonly<Record<string, GuaranteeRecord>> = {
  aib: {
    scheme: IRISH_DGS,
    country: 'Ireland',
    coverEur: 100_000,
    note: null,
    sourceUrl:
      'https://www.aib.ie/content/dam/aib/personal/docs/help-and-guidance/aib-depositor-information-sheet.pdf',
    checkedOn: CHECKED,
  },
  boi: {
    scheme: IRISH_DGS,
    country: 'Ireland',
    coverEur: 100_000,
    note: null,
    sourceUrl: 'https://personalbanking.bankofireland.com/?p=27570',
    checkedOn: CHECKED,
  },
  ptsb: {
    scheme: IRISH_DGS,
    country: 'Ireland',
    coverEur: 100_000,
    note: null,
    sourceUrl:
      'https://www.ptsb.ie/globalassets/pdf-documents/broker24/signature-deposits/deposit-guarantee-scheme-dgs1.pdf',
    checkedOn: CHECKED,
  },
  ebs: {
    scheme: IRISH_DGS,
    country: 'Ireland',
    coverEur: 100_000,
    note: 'EBS d.a.c. holds its own banking licence (Central Bank register), so its €100,000 is separate from AIB’s.',
    sourceUrl: CBI_REGISTER,
    checkedOn: CHECKED,
  },
  credit_union: {
    scheme: IRISH_DGS,
    country: 'Ireland',
    coverEur: 100_000,
    note: 'Each credit union is covered separately.',
    sourceUrl:
      'https://www.depositguarantee.ie/en/what-we-cover/protected-depositors-covered-institutions',
    checkedOn: CHECKED,
  },
  state_savings: {
    scheme: 'Guaranteed by the Irish State (State Savings, managed by the NTMA)',
    country: 'Ireland',
    coverEur: null,
    note: 'A direct obligation of the State, not the deposit guarantee scheme; no limit is stated.',
    sourceUrl: 'https://www.statesavings.ie/',
    checkedOn: CHECKED,
  },
  bunq: {
    scheme: 'Dutch Deposit Guarantee Scheme (De Nederlandsche Bank)',
    country: 'Netherlands',
    coverEur: 100_000,
    note: 'bunq B.V. is a Dutch bank with an Irish branch.',
    sourceUrl:
      'https://www.bunq.com/en-ie/blog/understanding-deposit-guarantee-in-european-banking',
    checkedOn: CHECKED,
  },
  revolut: {
    scheme: 'Lithuanian Deposit and Investment Insurance (Indėlių ir investicijų draudimas)',
    country: 'Lithuania',
    coverEur: 100_000,
    note: 'Revolut Bank UAB, Irish branch.',
    sourceUrl:
      'https://cdn.revolut.com/terms_and_conditions/pdf/deposit_information_sheet_751448c1_1.3.1_1781247455_en.pdf',
    checkedOn: CHECKED,
  },
  moco: {
    scheme: 'Austrian deposit guarantee (Einlagensicherung AUSTRIA)',
    country: 'Austria',
    coverEur: 100_000,
    note: 'MoCo is a trading name of BAWAG P.S.K. (Irish branch); the €100,000 is shared across BAWAG’s brands.',
    sourceUrl:
      'https://www.moco.ie/resource/blob/107468/bedec0b9ce4be4800c611c57f4114991/moco-depositor-information-sheet-july-2025-data.pdf',
    checkedOn: CHECKED,
  },
  an_post_money: {
    scheme: null,
    country: 'Ireland',
    coverEur: null,
    note: 'An Post is not a credit institution: current account funds are safeguarded, not covered by the deposit guarantee scheme.',
    sourceUrl: 'https://www.anpost.com/Money/Current-Account/Current-Account-Terms-Conditions',
    checkedOn: CHECKED,
  },
  bankinter: {
    scheme: 'Spanish Deposit Guarantee Fund (Fondo de Garantía de Depósitos)',
    country: 'Spain',
    coverEur: 100_000,
    note: 'Bankinter S.A., Irish branch; Avant Money is the same bank, so the €100,000 is shared.',
    sourceUrl:
      'https://www.bankinter.ie/file_sourcept/ireretail/privada/Deposit_Guarantee_Scheme.pdf',
    checkedOn: CHECKED,
  },
  avant_money: {
    scheme: 'Spanish Deposit Guarantee Fund (Fondo de Garantía de Depósitos)',
    country: 'Spain',
    coverEur: 100_000,
    note: 'Avant Money is a business name of Bankinter S.A.; the €100,000 is shared with Bankinter.',
    sourceUrl:
      'https://www.avantmoney.ie/documents/7251793/7255077/BKILHO-350-0326+Terms+of+Business.pdf',
    checkedOn: CHECKED,
  },
  raisin_bank: {
    scheme: 'German statutory deposit guarantee (Entschädigungseinrichtung deutscher Banken)',
    country: 'Germany',
    coverEur: 100_000,
    note: null,
    sourceUrl:
      'https://eu-assets.contentstack.com/v3/assets/blt4a5ee0113ab335fb/blt79f990c96e34fa0a/68ef6776c7d89a02761e27ae/Raisin_Starter_Account_PIS.pdf',
    checkedOn: CHECKED,
  },
}
