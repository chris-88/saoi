/**
 * What Demo Bank sets out about switching a mortgage to it.
 *
 * Read from the switcher page, the Cashback Plus page, the documentation checklist and the
 * Mortgage Switcher Guide brochure (37-1385R.15, 07/26) on 2026-10-20. None of it is invented
 * and none of it is a rate: rates come from the rate table. This is the process, the costs, the
 * limits and the documents, so Saoirse can say what a switch involves rather than "right here, no
 * forms" (case eb37e9b5).
 *
 * Tenant data, injected (Invariant 11). The domain's `compareSwitch` takes the costs as an
 * argument; the prompt section is composed from these lines.
 */

export const SWITCHING_VERIFIED = '2026-10-20'

export const SWITCHING_SOURCES = [
  'https://www.demo-bank.example/borrow/mortgages/switch/',
  'https://www.demo-bank.example/borrow/mortgages/switcher/cashback-plus/',
  'https://www.demo-bank.example/borrow/mortgages/documentation-checklist/',
  'https://www.demo-bank.example/app/uploads/7597740-Mortgage-Switcher-brochure-37-1385R_15-07_26-Digital-EAA-V2.pdf',
] as const

/** A cost the customer pays to switch. Amounts are the published ones, ranges where published. */
export type SwitchingCost = {
  readonly label: string
  /** As the bank states it: a figure, a range, or who sets it. */
  readonly amount: string
  readonly note: string | null
}

export const SWITCHING_COSTS: readonly SwitchingCost[] = [
  {
    label: 'Your solicitor',
    amount: 'Agreed with your solicitor',
    note: 'Needed to transfer the title and repay the old mortgage. The bank does not cover it.',
  },
  {
    label: 'Valuation',
    amount: '€150 to €250 plus VAT',
    note: 'By a valuer from the bank’s panel, paid directly to the valuer.',
  },
  {
    label: 'Accountable trust receipt',
    amount: '€63',
    note: 'Paid when your solicitor requests the title deeds from your current lender.',
  },
  {
    label: 'Break fee from your current lender',
    amount: 'Depends on your current deal',
    note: 'Only if you leave a fixed rate before it ends. Ask your lender for the redemption figure.',
  },
]

/** The eight steps, as the brochure numbers them. */
export const SWITCHING_STEPS: readonly string[] = [
  'Check the saving: the switcher line (01 555 0100) or the calculator.',
  'Start the application online, by phone or in a branch.',
  'Provide documents: ID and address, income, six months of statements, twelve months of mortgage statements.',
  'Appoint a solicitor and arrange a valuation by a panel valuer.',
  'Approval in principle, valid for six months. Not a loan offer.',
  'Buildings insurance and mortgage protection in place, or existing policies assigned to the bank.',
  'The loan offer letter.',
  'Your solicitor repays the old mortgage and the new one goes live.',
]

/** The commitments and limits the bank publishes, as single facts. */
export const SWITCHING_FACTS: readonly string[] = [
  'The bank acknowledges an application within 3 business days and gives a decision within 10 business days of having everything.',
  'Borrowing is generally up to 3.5 times gross annual income and up to 90% of the property’s value.',
  'Cashback: 2% of the amount drawn down, paid within 45 days, and a further 1% after five years if the loan is still owing, every payment was on time and the home is still lived in. Not on the High Value fixed rate or the standard variable rate. Minimum loan €15,000.',
  'Extra borrowing for renovations can be added to a switch, subject to criteria.',
  'Existing mortgage protection and buildings policies can usually be kept and assigned rather than replaced.',
]

/** The documents the published checklist asks a PAYE switcher for. */
export const SWITCHING_DOCUMENTS: readonly string[] = [
  'Passport or driving licence, and a utility bill from the last six months',
  'Last six months of current account statements, and of savings account statements',
  'Statements showing the last twelve repayments on the existing mortgage',
  'Last two payslips and a salary certificate from the employer',
  'Proof of PPSN',
]

export const SWITCHER_LINE = '01 555 0100'

/**
 * The switching section of the prompt, in the cached prefix.
 *
 * Process, documents, costs and limits, so Saoirse can say what a switch involves. No rates: those
 * are the rate table's, and a figure here would be a second copy to drift.
 */
export function switchingSection(): string {
  return [
    '# Switching a mortgage to us',
    '',
    `What Demo Bank sets out about moving an existing mortgage here, verified ${SWITCHING_VERIFIED}. State it as the process; never as an offer or a decision.`,
    '',
    'The eight steps:',
    ...SWITCHING_STEPS.map((step, index) => `${String(index + 1)}. ${step}`),
    '',
    'What the customer pays. List these when the saving comes up; never subtract a guess from the saving:',
    ...SWITCHING_COSTS.map(
      (cost) => `- ${cost.label}: ${cost.amount}.${cost.note === null ? '' : ` ${cost.note}`}`,
    ),
    '',
    'Facts:',
    ...SWITCHING_FACTS.map((fact) => `- ${fact}`),
    '',
    'Documents a PAYE switcher is asked for:',
    ...SWITCHING_DOCUMENTS.map((document) => `- ${document}`),
    '',
    'How to handle a switch:',
    '- It is not a purchase. There is no deposit, no first-time-buyer question and no rent. Ask who the mortgage is with, what is left on it, the rate and when it ends, how many years remain, and what the home is worth now.',
    '- When they have a rate in hand, theirs or an offer to stay, call show_mortgage_rates with compareWith and let the card do the arithmetic. Compare total cost over the fixed period, cashback counted once. Cashback is not the same as the lowest cost.',
    '- "Where do I apply" means: it starts here and continues with a solicitor, a valuation and insurance. Say that. Do not say there are no forms or that it is all done in the conversation.',
    `- The switcher line is ${SWITCHER_LINE} for anyone who would rather talk it through.`,
  ].join('\n')
}
