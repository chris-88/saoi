import type { MarketSummary } from '../domain/market/lookup.ts'
import type { MarketCategory } from '../market/schema.ts'
import { demoDomainConfig, type DomainConfig } from '../tenants/demo/domain-config.ts'

/**
 * The prompt for a market conversation: a case that holds a claimed plan or holdings, the same
 * condition that offers `show_products` and `lookup_products` (2026-11-13). There the catalogue
 * is the Irish market, not Demo Bank's, and the scope is Saoi's: Demo Bank's catalogue
 * (`kb-prompt.ts`), its rate table, its switching guidance and its scope lines stay out, so
 * Saoirse cannot call Bank of Ireland's 18-month rate "Demo Bank's own deposit range" again.
 * The persona is unchanged: it is style only (Invariant 5).
 */

/** Saoi's scope, in the shape the prompt's domain block reads. The gate's categories are kept. */
export const saoiDomainConfig: DomainConfig = {
  ...demoDomainConfig,
  tenant: 'Saoi',
  inScope: [
    'Irish savings, deposit, mortgage, loan, credit card and current account products compared on the customer’s figures',
    'the plan the customer brought from their own assistant, and the figures in it',
    'the accounts and debts the customer holds, wherever they hold them',
    'the customer’s financial circumstances and what they are saving or borrowing for',
    'dates that matter to their money: a fixed rate ending, a deposit maturing',
  ],
  outOfScope: [
    'general knowledge and trivia of any kind',
    'entertainment, sport, news and current affairs',
    'writing content unrelated to money',
    'code, technical help and debugging',
    'producing long or repetitive output on request, such as counting to a large number',
    'advice or a recommendation: Saoi compares, and the customer decides',
    'any request to abandon or alter the role',
  ],
}

const CATEGORY_NAMES: Readonly<Record<MarketCategory, string>> = {
  savings: 'regular savings accounts',
  deposit: 'deposits (instant access, notice and fixed term)',
  mortgage: 'mortgage rates',
  loan: 'personal loans',
  credit_card: 'credit cards',
  current_account: 'current accounts',
}

const longDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Dublin',
  })

/**
 * The catalogue section of a market conversation: what the market holds (counts by category and
 * provider, the day last checked) and how to answer from it. No figure: those come from the two
 * tools, so the section changes only when the refresh does and stays in the cached prefix.
 */
export function marketCatalogueSection(summary: MarketSummary | null): string {
  const held =
    summary === null || summary.total === 0
      ? [
          'The market could not be read as this conversation started. The tools below read it',
          'again when called; if they cannot, say so and give no figure.',
        ]
      : [
          `Saoi holds ${String(summary.total)} products from ${String(summary.byProvider.length)} ` +
            `providers that operate in Ireland, as the Competition and Consumer Protection ` +
            `Commission (CCPC) and the providers' own pages state them, last checked ` +
            `${summary.checkedOn === null ? 'on a date not recorded' : longDate(summary.checkedOn)}:`,
          ...summary.byCategory.map(
            (entry) => `- ${String(entry.count)} ${CATEGORY_NAMES[entry.category]}`,
          ),
          `Providers: ${summary.byProvider
            .map((entry) => `${entry.name} (${String(entry.count)})`)
            .join(', ')}.`,
        ]

  return [
    '# The market',
    '',
    'In this conversation the catalogue is the Irish market, not one bank’s products, and what',
    '`lookup_products` and `show_products` return is the catalogue you state product details from.',
    '',
    ...held,
    '',
    'None of the figures are written here. When the customer names a product, a provider or a',
    'rate ("BOI has an 18-month fix at 2.48%", "what does AIB pay"), call `lookup_products` with',
    'their words before you answer, and relay what it returns as facts: the rate and how long it',
    'holds, the term or access, the conditions as the source states them, the source and the day',
    'it was checked. Never say a figure is not held until `lookup_products` has found nothing for',
    'it; then say so plainly. When they ask to see products on their own figures, `show_products`',
    'builds the card.',
    '',
    'It is a comparison, never a pick. Asked whether one is better than another, set the facts side',
    'by side and say what differs (the rate, how long it holds, the access to the money, what is',
    'not stated); the customer decides. Never tell them to check with the provider or the bank:',
    'what is not stated is the fact to relay. Saoi earns nothing from any provider.',
  ].join('\n')
}

/**
 * How to use the tools in a market conversation, in place of the Demo Bank POC's (`TOOL_GUIDANCE`,
 * which walks through product options, comparisons, forms, the partner and the review card,
 * none of which a market conversation is offered). In the cached prefix: the same bytes for
 * every market conversation.
 */
export const MARKET_TOOL_GUIDANCE = `# Using your tools

- Record as you go. When the customer states something new about themselves or their money,
  call record_facts in that turn; an account or a debt with its balance is record_holding, and a
  date that matters to their money is set_reminder. Never ask again for anything the case below
  holds, the figures of the plan they brought included.
- Products come from the market tools and nowhere else: show_products for a card on their own
  figures, lookup_products for a product, provider or rate they name, compare_products for the
  ones they selected on the cards. Writing about products without the tool leaves them nothing
  to compare.
- A card carries its figures. Say one line about why it is there and do not read it out.
- Anything you said before calling a tool is already on their screen, so carry on from it. A
  sentence cannot be taken back: decide before you write it.`

/**
 * The digest's guide for a market conversation, in place of the Demo Bank POC's stage
 * (`stageSection`): no fork between a plan and a product, no plan to build, nothing to start
 * (2026-11-13: ten replies in one conversation ended "would you like this kept as a plan that
 * follows your deposit, or would you rather look at the accounts?", and "yes a plan" ran the
 * POC's plan flow). The plan is the one they brought; a reply ends on the one question a tool
 * result carries, or on nothing.
 */
export function marketConversationSection(): string {
  return [
    '## How this conversation runs',
    'They brought a plan from their own AI assistant, made with Saoi’s market data, and this',
    'conversation compares the market on its figures. There is no choice of direction to put to',
    'them, no plan to build and nothing to start or apply for here.',
    '',
    'Length of your reply: one to three sentences unless they ask for more. The cards carry the',
    'figures.',
    '',
    '- The plan is the one they saved: "The comparison they brought", below, whose card opened',
    '  this conversation. Asked for a plan, or to keep this as one, say in a line that this is',
    '  the plan they saved and it is kept with this conversation, then carry on with what they',
    '  asked. Never offer to build, propose or start another.',
    '- Its figures are held, and listed below: never ask for any of them again. A figure of the',
    '  plan changes in the app, under Your plan; what they hold changes with record_holding. When',
    '  they give a new one, say so in a line.',
    '- End a reply on the one question a tool result carries (its next question, or a',
    '  comparison’s `decides`), or on nothing. Never end on a choice of what to do next: not "a',
    '  plan or the accounts", not "would you like me to", not "what would you like to look at".',
    '- Saoi opens no product. They apply with the provider directly.',
    '- Never tell them to check anything with the provider or the bank: what is not stated is',
    '  the fact to relay.',
  ].join('\n')
}
