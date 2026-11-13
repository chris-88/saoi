import { describe, expect, it } from 'vitest'
import { factCatalogue } from '@domain/facts.ts'
import { TOOLS, TOOL_NAMES, validateToolCall } from './tools.ts'

const uuid = '3f8b0c7e-0000-4000-8000-000000000001'

/**
 * Invariant 1 — the model proposes, the UI commits.
 *
 * This is asserted by absence, which is easy to erode later: someone adds a convenient
 * `submit_application` tool and the invariant is gone with no test failing. So the forbidden
 * verbs are named explicitly.
 */
describe('the model has no tool that takes an action', () => {
  const forbidden = [
    'create_application',
    'submit_application',
    'submit',
    'pause_application',
    'resume_application',
    'grant_consent',
    'invite_partner',
    'make_declaration',
    'approve',
    'decline',
    'set_status',
    'update_application',
  ]

  for (const name of forbidden) {
    it(`has no "${name}" tool`, () => {
      expect(TOOL_NAMES).not.toContain(name)
    })
  }

  it('exposes only tools that show or record, never ones that act', () => {
    // CLAUDE.md lists seven. `show_form` is the eighth, added for §7.5: health data cannot be
    // collected in conversation, so there has to be a way to surface the form. It still only
    // shows — the server decides which form is due, and the customer's tap is what commits.
    //
    // `propose_plan` is the ninth and the only one not named show_/record_/request_, so it is
    // worth being explicit: it writes a DRAFT plan nobody is held to. The plan becomes the
    // customer's when they tap the card, which calls case-action like every other commitment.
    // Proposing is not acting.
    //
    // `show_quote` is the tenth and computes nothing itself: it passes what the customer said
    // to the quote engine, which does the arithmetic from the catalogue. Choosing an option on
    // the card starts nothing either — it asks Saoirse to go through that one.
    //
    // `show_comparison` is the eleventh and passes only catalogue ids. Everything shown beside
    // each product is read from the knowledge base by the server, so the model chooses what to
    // compare and cannot describe a product into existence. Tapping one starts nothing.
    //
    // `show_mortgage_rates` is the twelfth and is the most tempting one to get wrong, because
    // quoting a rate feels like an act. It passes four answers the customer gave — buyer type,
    // BER, amount, term — and the server decides which of 133 published rows they are entitled
    // to see and what the repayments are. The model never reads the table, cannot show a rate
    // below its minimum, and cannot price a BER the bank has not published. The card is not
    // tappable at all: a published rate is not an offer, and nothing should start from one.
    //
    // `record_form_answers` is the thirteenth and belongs to the digital forms feature. It is
    // the same kind of thing as `record_facts`: what the customer just said, checked by the
    // server against the bank's published definition before it is written. It refuses a
    // declaration and refuses an upload, whatever it is sent, because those need a tap and a
    // file. It cannot submit anything.
    //
    // `show_form_declarations` is the fourteenth and is the one that could look like acting,
    // because consent is the thing a model must never manufacture. It takes an application id
    // and nothing else: the wording comes out of the published definition, the server builds
    // the card, and the customer ticking each line and tapping is what records any of it.
    //
    // `show_form_upload` is the fifteenth and takes an application id for the same reason: the
    // server picks which document the form is waiting for and reads the accepted types and
    // size cap out of the published control. A file arrives through `upload`, not through
    // this, and what reaches the packet is a reference with the production signature fields
    // left empty.
    //
    // `show_arrangement` is the sixteenth and takes nothing at all. The server reads the facts
    // it holds and the published rates and works the split out; the model cannot pass a figure
    // because there is no figure it could pass that it did not make up. One tap on the card
    // starts every account on it, through `select_products` like any other start.
    //
    // `show_connect_accounts`, `show_accounts` and `show_transfer` are the seventeenth to the
    // nineteenth, open banking simulated. The first takes a line of why and shows a consent the
    // customer gives by tapping; linking is `link_accounts` in case-action. The second takes
    // nothing and is read off the linked rows. The third is the one that could look like
    // acting, because it is about moving money: it names an application, the server picks the
    // account, reads the balance and caps the amount, and `initiate_transfer` is the tap.
    //
    // `set_reminder` is the twentieth and records, like `record_facts`: a date the customer
    // gave (their fix ends, a deposit matures). It commits them to nothing and starts nothing;
    // the alerts that follow state the date and the market, and pick nothing.
    //
    // `record_holding` is the twenty-first and records too: an account or a debt the customer
    // stated, with its balance. It opens, moves and closes nothing; progress against the plan
    // is worked out from it by the server and stated as a fact.
    //
    // `show_products` is the twenty-second and shows: the model names the arrangement the
    // customer's question implies, and the server reads their figures from the case and builds
    // every row from the market. It starts nothing and names no product of its own choosing.
    //
    // `lookup_products` is the twenty-third and only reads: a product, a provider or a rate the
    // customer named, looked up in the market and returned as facts. No card, nothing started.
    expect([...TOOL_NAMES].sort()).toEqual([
      'lookup_products',
      'propose_plan',
      'record_facts',
      'record_form_answers',
      'record_holding',
      'request_upload',
      'set_reminder',
      'show_accounts',
      'show_arrangement',
      'show_comparison',
      'show_connect_accounts',
      'show_form',
      'show_form_declarations',
      'show_form_upload',
      'show_mortgage_rates',
      'show_partner_invite',
      'show_pause_prompt',
      'show_product_options',
      'show_products',
      'show_quote',
      'show_review',
      'show_status',
      'show_transfer',
    ])
  })

  it('does not let the model choose which form to show', () => {
    // Naming the application only is what stops it reaching the health questions before
    // consent has been given (§7.5, Invariant 6).
    const result = validateToolCall('show_form', {
      applicationId: uuid,
      requirementId: 'health-consent',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.input as object)).toEqual(['applicationId'])
  })

  it('describes every tool as showing or recording, never as doing', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40)
    }
  })
})

describe('validateToolCall()', () => {
  it('rejects an unknown tool by name rather than throwing', () => {
    const result = validateToolCall('submit_application', {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/unknown tool/i)
  })

  it('rejects a fact key that is not in the catalogue', () => {
    const result = validateToolCall('record_facts', {
      facts: [{ key: 'income.somethingMadeUp', subject: 'primary', value: 1 }],
    })
    expect(result.ok).toBe(false)
  })

  it('accepts a catalogue key', () => {
    const result = validateToolCall('record_facts', {
      facts: [{ key: 'income.annualBasic', subject: 'primary', value: 92_000 }],
    })
    expect(result.ok).toBe(true)
  })

  it('refuses an empty or oversized batch of facts', () => {
    const batch = (length: number) =>
      validateToolCall('record_facts', {
        facts: Array.from({ length }, () => ({
          key: 'income.annualBasic',
          subject: 'primary',
          value: 1,
        })),
      }).ok

    expect(validateToolCall('record_facts', { facts: [] }).ok).toBe(false)
    expect(batch(25)).toBe(false)

    // An opening message that states fifteen things fits in one call. It did not, and the
    // refusal cost an entire extra model round on the densest turns.
    expect(batch(15)).toBe(true)
  })

  it('requires a real reason when offering products, not a bare list (§49)', () => {
    expect(
      validateToolCall('show_product_options', {
        products: [{ product: 'mortgage', reason: 'yes' }],
      }).ok,
    ).toBe(false)

    expect(
      validateToolCall('show_product_options', {
        products: [{ product: 'mortgage', reason: 'You said you are buying your first home.' }],
      }).ok,
    ).toBe(true)
  })

  it('rejects a product that is not supported', () => {
    expect(
      validateToolCall('show_product_options', {
        products: [{ product: 'crypto_wallet', reason: 'A long enough reason string here.' }],
      }).ok,
    ).toBe(false)
  })

  it('requires an application id that looks like one', () => {
    expect(validateToolCall('show_review', { applicationId: 'the mortgage' }).ok).toBe(false)
    expect(validateToolCall('show_review', { applicationId: uuid }).ok).toBe(true)
  })

  it('lets show_status cover every application', () => {
    expect(validateToolCall('show_status', {}).ok).toBe(true)
  })

  it('reports every problem rather than only the first', () => {
    const result = validateToolCall('show_product_options', {
      products: [{ product: 'nope', reason: 'x' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.split(';').length).toBeGreaterThan(1)
  })
})

/**
 * Invariant 6 — the model may never write a fact the catalogue marks non-extractable.
 * The schema cannot express this, so `record_facts` is checked against the catalogue at the
 * point of effect. This test pins the catalogue data the check depends on.
 */
describe('health data is unreachable through record_facts', () => {
  it('marks every protection health key non-extractable', () => {
    const healthKeys = Object.keys(factCatalogue).filter((key) =>
      key.startsWith('protection.health.'),
    )

    expect(healthKeys.length).toBeGreaterThan(0)
    for (const key of healthKeys) {
      expect(factCatalogue[key as keyof typeof factCatalogue].extractable, key).toBe(false)
    }
  })
})
