import { describe, expect, it } from 'vitest'
import { demoDomainConfig } from '../tenants/demo/domain-config.ts'
import { knowledgeBaseSection } from '../tenants/demo/kb-prompt.ts'
import { withdraw, type StreamEvent } from '../contracts/stream.ts'
import {
  runSaoirseTurn,
  WITHDRAWAL_NOTE,
  type SaoirseTurnOptions,
  type ToolOutcome,
} from './saoirse.ts'
import { fixtureProvider, fixtureTurnSchema } from './fixture-provider.ts'
import type { ModelProvider, ModelRequest } from './model.ts'
import { slidersFor } from './persona.ts'
import type { PromptInput } from './prompt.ts'

/**
 * One round's reply, as these tests have always described it: the text it streams plus
 * whatever tool it asks for. Mapped onto the fixture provider, so the tests here exercise the
 * same replay that drives a scripted conversation end to end.
 */
type Round = {
  readonly text: string
  readonly tool?: string
  readonly input?: unknown
  /** Several calls in one round, where the test needs them. Takes precedence over `tool`. */
  readonly tools?: readonly { readonly name: string; readonly input?: unknown }[]
  /** A round cut off by the output ceiling, which finishes neither its text nor its tool call. */
  readonly truncated?: boolean
}

function providerReturning(rounds: readonly Round[]): ModelProvider {
  return fixtureProvider(
    fixtureTurnSchema.parse({
      rounds: rounds.map((round) => ({
        deltas: [round.text],
        // Tool input is validated before anything runs, so a card only appears when a round
        // supplies input the schema accepts.
        toolUses:
          round.tools?.map((use) => ({ name: use.name, input: use.input ?? {} })) ??
          (round.tool === undefined ? [] : [{ name: round.tool, input: round.input ?? {} }]),
        ...(round.truncated === true ? { stopReason: 'max_tokens' } : {}),
      })),
    }),
  )
}

/** The same provider, with every request it is sent kept for inspection. */
function observing(inner: ModelProvider, seen: ModelRequest[]): ModelProvider {
  return {
    stream: (request) => {
      seen.push(request)
      return inner.stream(request)
    },
  }
}

const prompt: PromptInput = {
  domainConfig: demoDomainConfig,
  productCatalogue: knowledgeBaseSection(),
  sliders: slidersFor('default'),
  digest: {
    customerName: 'Aoife',
    authLevel: 'authenticated',
    facts: [],
    applications: [],
    declinedProducts: [],
    advisories: [],
    partner: null,
    eventsSinceLastSeen: [],
  },
}

function options(rounds: readonly Round[], withCard = false): SaoirseTurnOptions {
  return {
    provider: providerReturning(rounds),
    model: 'test-model',
    prompt,
    history: [{ role: 'user', content: 'I want to buy my first home' }],
    executeTool: () =>
      Promise.resolve(
        withCard
          ? { result: 'Status shown.', card: { type: 'status', applications: [] } as never }
          : { result: 'Options shown.' },
      ),
    enabledTools: ['show_product_options', 'record_facts'],
  }
}

async function textOf(rounds: readonly Round[], withCard = false): Promise<string> {
  let text = ''
  for await (const event of runSaoirseTurn(options(rounds, withCard))) {
    if (event.type === 'text_delta') text += event.text
  }
  return text
}

/**
 * Caching is invisible until the bill arrives, so it is asserted on the request rather than
 * inferred from behaviour. Every one of these is a line item.
 */
describe('prompt caching', () => {
  const paramsOf = async (history: SaoirseTurnOptions['history']) => {
    const seen: ModelRequest[] = []
    const base = options([{ text: 'Right.' }])

    for await (const _ of runSaoirseTurn({
      ...base,
      provider: observing(base.provider, seen),
      history,
    })) {
      /* drain */
    }
    return seen[0]
  }

  it('caches the stable prefix for an hour, and nothing after it', async () => {
    const params = await paramsOf([{ role: 'user', content: 'hello' }])
    const system = params?.system ?? []

    expect(system).toHaveLength(2)
    // An hour because the prefix is shared by every case: one write covers a whole session.
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(system[1]?.cache_control).toBeUndefined()
    expect(system[0]?.text).toContain('# Products')
  })

  it('caches the conversation so far, at the last message', async () => {
    const params = await paramsOf([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
    const messages = params?.messages ?? []

    // Everything before the marker is read at a tenth of the price; only the newest message
    // is written. Without it the whole window was re-read at full price, every round.
    expect(messages[0]?.content).toBe('first')
    expect(messages[1]?.content).toBe('second')
    expect(messages[2]?.content).toEqual([
      { type: 'text', text: 'third', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('leaves a history of one alone rather than breaking on nothing', async () => {
    const params = await paramsOf([{ role: 'user', content: 'only' }])
    const messages = params?.messages ?? []

    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toEqual([
      { type: 'text', text: 'only', cache_control: { type: 'ephemeral' } },
    ])
  })
})

describe('runSaoirseTurn', () => {
  it('breaks between what the model said before a tool ran and what it said after', async () => {
    // Input the schema accepts: a call it refuses is withdrawn now, which is the other test.
    const text = await textOf([
      {
        text: 'Let me pull those up.',
        tool: 'show_product_options',
        input: { products: [{ product: 'mortgage', reason: 'They said they are buying.' }] },
      },
      { text: 'Mortgage first is usually the sensible order.' },
    ])

    // Without the break these arrive as "...pull those up.Mortgage first...".
    expect(text).toBe('Let me pull those up.\n\nMortgage first is usually the sensible order.')
  })

  it('does not open with a break when the model says nothing before the tool', async () => {
    const text = await textOf([
      { text: '', tool: 'show_product_options' },
      { text: 'Here are the two worth looking at.' },
    ])

    expect(text).toBe('Here are the two worth looking at.')
  })

  it('leaves a single round untouched', async () => {
    expect(await textOf([{ text: 'A mortgage is the place to start.' }])).toBe(
      'A mortgage is the place to start.',
    )
  })

  /**
   * Seen once in testing: every round spent calling a tool the server refused, and the customer
   * got an empty bubble. Silence is the one reply that cannot be recovered from — nothing to
   * read and nothing to tap.
   */
  it('says something when every round went on tools and none on words', async () => {
    const text = await textOf([
      { text: '', tool: 'show_product_options' },
      { text: '', tool: 'show_product_options' },
      { text: '', tool: 'show_product_options' },
    ])

    expect(text).toMatch(/say that again/i)
  })

  it('stays quiet when a card carries the turn', async () => {
    // A card on its own is terse, not broken, so nothing is added to it.
    const text = await textOf(
      [
        {
          text: '',
          tool: 'show_product_options',
          input: { products: [{ product: 'mortgage', reason: 'They said they are buying.' }] },
        },
        { text: '' },
      ],
      true,
    )

    expect(text).toBe('')
  })
})

/**
 * Running out of output tokens mid-answer (§47).
 *
 * The ceiling was 1,024, which was enough for a short question and not enough for a customer
 * who arrives with everything at once — a mortgage, a savings account, a switch, two children,
 * income, rent and a timeframe in one message. Saoirse would write prose, a dozen facts and a
 * product card, hit the ceiling inside the tool call, and end the turn having said nothing and
 * recorded nothing. Three customers in a row were told "Sorry — I lost my thread there" for
 * giving it more to work with than a one-liner.
 */
describe('running out of room', () => {
  const ceilingsUsed = async (rounds: readonly Round[]) => {
    const seen: ModelRequest[] = []
    const base = options(rounds)

    const said: string[] = []
    const rejected: { name: string; error: string }[] = []
    for await (const event of runSaoirseTurn({
      ...base,
      provider: observing(base.provider, seen),
      onToolRejected: (rejection) => rejected.push(rejection),
    })) {
      if (event.type === 'text_delta') said.push(event.text)
    }
    return { ceilings: seen.map((request) => request.max_tokens), said: said.join(''), rejected }
  }

  it('goes again with double the room when a round produces nothing at all', async () => {
    const run = await ceilingsUsed([{ text: '', truncated: true }, { text: 'Right, two kids.' }])

    expect(run.ceilings).toEqual([3_072, 6_144])
    // Nothing reached the customer from the truncated round, so nothing is said twice.
    expect(run.said).toBe('Right, two kids.')
  })

  it('reports the truncation even when the retry rescues the turn', async () => {
    const run = await ceilingsUsed([{ text: '', truncated: true }, { text: 'Right.' }])

    expect(run.rejected).toHaveLength(1)
    expect(run.rejected[0]?.name).toBe('model')
    expect(run.rejected[0]?.error).toContain('output tokens')
  })

  it('gives up after one retry rather than spending a third round', async () => {
    const run = await ceilingsUsed([
      { text: '', truncated: true },
      { text: '', truncated: true },
      { text: 'Never reached.' },
    ])

    expect(run.ceilings).toEqual([3_072, 6_144])
    expect(run.said).toContain('lost my thread')
  })

  it('does not retry once words are already on screen', async () => {
    // Retrying here would repeat the sentence the customer has already read.
    const run = await ceilingsUsed([{ text: 'Renting at €3,500 with two kids' }])

    expect(run.ceilings).toEqual([3_072])
    expect(run.said).toBe('Renting at €3,500 with two kids')
  })
})

/**
 * Words about something that is not there.
 *
 * The model speaks, calls a tool, and speaks again about what came back. When the server
 * refuses the tool, the first sentence has already reached the customer and the reply
 * contradicts itself: "Payslip first, then. Send it in as a photo" and, a paragraph later,
 * "there's no document I can ask you for". Four times in one live conversation. So a round
 * that spoke and then had a tool refused is withdrawn: a `retract` takes its words off the
 * screen and out of the record, the refusal tells the model so, and the model writes again
 * from the results.
 */
describe('a round whose tool was refused', () => {
  /** The reply as both consumers build it: deltas appended, each retract applied as it arrives. */
  const shownText = (events: readonly StreamEvent[]): string => {
    let text = ''
    for (const event of events) {
      if (event.type === 'text_delta') text += event.text
      if (event.type === 'retract') text = withdraw(text, event.length)
    }
    return text
  }

  const retractLengths = (events: readonly StreamEvent[]): number[] =>
    events.flatMap((event) => (event.type === 'retract' ? [event.length] : []))

  /**
   * Every tool result the model was sent, in order. The loop passes one messages array by
   * reference to every request, so the last request holds the whole conversation.
   */
  const resultsSent = (seen: readonly ModelRequest[]): string[] =>
    (seen.at(-1)?.messages ?? []).flatMap((message) =>
      typeof message.content === 'string'
        ? []
        : message.content.flatMap((block) =>
            block.type === 'tool_result' && typeof block.content === 'string'
              ? [block.content]
              : [],
          ),
    )

  /** Runs the turn with each tool call answered by the next scripted outcome, or thrown. */
  const run = async (rounds: readonly Round[], outcomes: readonly (ToolOutcome | Error)[]) => {
    const seen: ModelRequest[] = []
    const base = options(rounds)
    const events: StreamEvent[] = []
    let call = 0

    for await (const event of runSaoirseTurn({
      ...base,
      provider: observing(base.provider, seen),
      executeTool: () => {
        const outcome = outcomes[call] ?? new Error('More tool calls than outcomes scripted.')
        call += 1
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
      },
    })) {
      events.push(event)
    }

    return { events, text: shownText(events), results: resultsSent(seen) }
  }

  const option = { product: 'mortgage', reason: 'They said they are buying.' }

  it('takes back exactly what the round said, and the model writes again from the result', async () => {
    const said = 'Payslip first, then. Send it in as a photo.'
    const turn = await run(
      [
        { text: said, tool: 'show_product_options', input: { products: [option] } },
        { text: 'There is no document I can ask you for yet.' },
      ],
      [{ result: 'No open request to show.', refused: true }],
    )

    expect(turn.events.map((event) => event.type)).toEqual(['text_delta', 'retract', 'text_delta'])
    expect(retractLengths(turn.events)).toEqual([said.length])
    // The rewrite opens the message rather than continuing one that is no longer there.
    expect(turn.text).toBe('There is no document I can ask you for yet.')
    expect(turn.results).toEqual([`No open request to show. ${WITHDRAWAL_NOTE}`])
  })

  it('includes the paragraph break when something said earlier still stands', async () => {
    const withdrawnWords = 'I will put the invitation up so she can do that.'
    const turn = await run(
      [
        { text: 'Right.', tool: 'show_product_options', input: { products: [option] } },
        { text: withdrawnWords, tool: 'show_product_options', input: { products: [option] } },
        { text: 'Hannah has already joined, so there is nothing to send.' },
      ],
      [{ result: 'Options shown.' }, { result: 'Already joined.', refused: true }],
    )

    expect(retractLengths(turn.events)).toEqual(['\n\n'.length + withdrawnWords.length])
    // Back to the first round's words, with a fresh break before the rewrite.
    expect(turn.text).toBe('Right.\n\nHannah has already joined, so there is nothing to send.')
    expect(turn.results).toEqual(['Options shown.', `Already joined. ${WITHDRAWAL_NOTE}`])
  })

  it('keeps its words when the tool did what was asked', async () => {
    const turn = await run(
      [
        {
          text: 'Let me pull those up.',
          tool: 'show_product_options',
          input: { products: [option] },
        },
        { text: 'Mortgage first is usually the sensible order.' },
      ],
      [{ result: 'Options shown.' }],
    )

    expect(retractLengths(turn.events)).toEqual([])
    expect(turn.text).toBe('Let me pull those up.\n\nMortgage first is usually the sensible order.')
    expect(turn.results).toEqual(['Options shown.'])
  })

  it('withdraws a round where one call was refused and another was not', async () => {
    const turn = await run(
      [
        {
          text: 'Here are the options, and the invitation for Hannah.',
          tools: [
            { name: 'show_product_options', input: { products: [option] } },
            { name: 'show_product_options', input: { products: [option] } },
          ],
        },
        { text: 'Here are the options. Hannah has already joined.' },
      ],
      [
        { result: 'Options shown.', card: { type: 'status', applications: [] } as never },
        { result: 'Hannah has already joined.', refused: true },
      ],
    )

    expect(retractLengths(turn.events)).toHaveLength(1)
    expect(turn.text).toBe('Here are the options. Hannah has already joined.')
    // The card that was shown still arrives, and only the refused result carries the note.
    expect(turn.events.filter((event) => event.type === 'card')).toHaveLength(1)
    expect(turn.results).toEqual([
      'Options shown.',
      `Hannah has already joined. ${WITHDRAWAL_NOTE}`,
    ])
  })

  it('withdraws a show call the schema refused, since nothing was shown', async () => {
    const turn = await run(
      [
        { text: 'Here they are.', tool: 'show_product_options', input: { products: 'none' } },
        { text: 'Tell me a little more first.' },
      ],
      [],
    )

    expect(retractLengths(turn.events)).toEqual(['Here they are.'.length])
    expect(turn.text).toBe('Tell me a little more first.')
    expect(turn.results).toHaveLength(1)
    expect(turn.results[0]).toContain(WITHDRAWAL_NOTE)
  })

  it('treats a show tool that threw as one that refused', async () => {
    const turn = await run(
      [
        { text: 'Here they are.', tool: 'show_product_options', input: { products: [option] } },
        { text: 'I could not bring those up. Tell me a little more first.' },
      ],
      [new Error('products: unavailable')],
    )

    expect(retractLengths(turn.events)).toEqual(['Here they are.'.length])
    expect(turn.text).toBe('I could not bring those up. Tell me a little more first.')
    expect(turn.results).toEqual([`products: unavailable ${WITHDRAWAL_NOTE}`])
  })

  /**
   * Withholding a tool is the enforcement the stages and a market conversation rest on
   * (2026-11-13), so a call to one the turn does not offer is refused and withdrawn, never run,
   * whatever the provider sends.
   */
  it('refuses and withdraws a call to a tool the turn does not offer', async () => {
    const turn = await run(
      [
        { text: 'Plan it is.', tool: 'propose_plan', input: {} },
        { text: 'The plan is the one you saved.' },
      ],
      [new Error('propose_plan ran')],
    )

    expect(retractLengths(turn.events)).toEqual(['Plan it is.'.length])
    expect(turn.text).toBe('The plan is the one you saved.')
    expect(turn.results[0]).toContain('propose_plan is not offered in this conversation.')
    expect(turn.events.some((event) => event.type === 'card')).toBe(false)
  })

  /**
   * The text written alongside a fact round is usually right whether or not every fact was
   * taken, and saying it again would cost output for nothing. So neither a partial rejection
   * nor a schema failure on the recording tools takes anything back.
   */
  it('does not withdraw on a record_facts call that took some facts and not others', async () => {
    const turn = await run(
      [
        {
          text: 'Two kids and a mortgage, noted.',
          tool: 'record_facts',
          input: { facts: [{ key: 'income.annualBasic', value: 52_000 }] },
        },
        { text: 'What does Hannah earn?' },
      ],
      [{ result: 'Recorded 1 of 2. Rejected household.children: not a number.' }],
    )

    expect(retractLengths(turn.events)).toEqual([])
    expect(turn.text).toBe('Two kids and a mortgage, noted.\n\nWhat does Hannah earn?')
    expect(turn.results).toEqual(['Recorded 1 of 2. Rejected household.children: not a number.'])
  })

  it('keeps the words beside a record_facts call the schema refused', async () => {
    const turn = await run(
      [
        { text: 'Two kids, noted.', tool: 'record_facts', input: { facts: 'not a list' } },
        { text: 'What do you both earn?' },
      ],
      [],
    )

    expect(retractLengths(turn.events)).toEqual([])
    expect(turn.text).toBe('Two kids, noted.\n\nWhat do you both earn?')
    expect(turn.results).toHaveLength(1)
    expect(turn.results[0]).not.toContain(WITHDRAWAL_NOTE)
  })

  it('has nothing to take back from a round that only called the tool', async () => {
    const turn = await run(
      [
        { text: '', tool: 'show_product_options', input: { products: [option] } },
        { text: 'Hannah has already joined.' },
      ],
      [{ result: 'Already joined.', refused: true }],
    )

    expect(retractLengths(turn.events)).toEqual([])
    expect(turn.text).toBe('Hannah has already joined.')
    // Nothing was withdrawn, so the model is not told that something was.
    expect(turn.results).toEqual(['Already joined.'])
  })
})

/**
 * A refusal the handler chose used to be the one kind of failed call that left no row: six
 * refused offers in one live conversation read as `refused: 0` in the console. Now it reports
 * through the same callback as a schema failure.
 */
describe('a refusal the handler chose', () => {
  it('is reported like any other call that came to nothing', async () => {
    const rejected: { name: string; error: string }[] = []
    const base = options([
      {
        text: 'Here they are.',
        tool: 'show_product_options',
        input: { products: [{ product: 'mortgage', reason: 'They said so.' }] },
      },
      { text: 'Tell me a little more first.' },
    ])

    for await (const _event of runSaoirseTurn({
      ...base,
      onToolRejected: (rejection) => rejected.push(rejection),
      executeTool: () => Promise.resolve({ result: 'Too early to offer anything.', refused: true }),
    })) {
      // Drained for its side effects.
    }

    expect(rejected).toEqual([
      { name: 'show_product_options', error: 'Too early to offer anything.' },
    ])
  })
})
