/**
 * Runs the real gate against the adversarial set (§22, §24, §47).
 *
 * This calls the live classifier — it is the only way to know whether domain enforcement
 * actually holds, because the gate's whole premise is that it does not depend on asking the
 * main model nicely (§25). CLAUDE.md requires 100% on both sets before any presentation.
 *
 *   npm run eval:guardrails              every case
 *   npm run eval:guardrails -- --only=inj   just the injection cases
 */
import { readFileSync } from 'node:fs'
import { demoDomainConfig } from '../../supabase/functions/_shared/tenants/demo/domain-config.ts'
import { runGate } from '../../supabase/functions/_shared/llm/gate.ts'
import { createClassifier } from '../../supabase/functions/_shared/llm/classifier.ts'

type Case = {
  id: string
  input: string
  expect: 'block' | 'allow'
  why: string
  section: string
  previousAssistantTurn?: string
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set. Try: node --env-file=.env evals/guardrails/run.ts')
  process.exit(1)
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)

const cases: Case[] = readFileSync(new URL('./cases.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Case)
  .filter((c) => (only ? c.id.includes(only) : true))

const classify = createClassifier({
  apiKey,
  model: process.env.GATE_MODEL ?? 'claude-haiku-4-5-20251001',
  domainConfig: demoDomainConfig,
})

type Result = {
  testCase: Case
  passed: boolean
  category: string
  detail: string
}

async function runCase(testCase: Case): Promise<Result> {
  try {
    const result = await runGate(testCase.input, {
      classify: (message) =>
        classify({
          message,
          ...(testCase.previousAssistantTurn
            ? { previousAssistantTurn: testCase.previousAssistantTurn }
            : {}),
        }),
      domainConfig: demoDomainConfig,
      killSwitch: false,
      timeoutMs: 15_000,
    })

    const blocked = !result.allowed
    const passed = blocked === (testCase.expect === 'block')

    return {
      testCase,
      passed,
      category: result.category,
      detail: result.allowed
        ? `allowed${result.suppressHumour ? ' (sensitive)' : ''}${result.profanity ? ' (profanity)' : ''}`
        : `blocked: ${result.response.slice(0, 60)}…`,
    }
  } catch (error) {
    return {
      testCase,
      passed: false,
      category: 'error',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Small concurrency: enough to be quick, low enough not to trip rate limits. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        const item = items[index]
        if (item === undefined) continue
        results[index] = await fn(item)
      }
    }),
  )

  return results
}

const started = Date.now()
const results = await mapWithLimit(cases, 5, runCase)

const failures = results.filter((r) => !r.passed)
const blockSet = results.filter((r) => r.testCase.expect === 'block')
const allowSet = results.filter((r) => r.testCase.expect === 'allow')
const rate = (set: Result[]) =>
  set.length === 0
    ? '—'
    : `${((set.filter((r) => r.passed).length / set.length) * 100).toFixed(0)}%`

for (const result of results) {
  const mark = result.passed ? '  ok  ' : ' FAIL '
  console.log(
    `${mark} ${result.testCase.id.padEnd(22)} ${result.testCase.section.padEnd(6)} ` +
      `${result.category.padEnd(18)} ${result.detail}`,
  )
}

console.log(
  `\nmust block: ${rate(blockSet)} (${blockSet.filter((r) => r.passed).length}/${blockSet.length})` +
    `   must allow: ${rate(allowSet)} (${allowSet.filter((r) => r.passed).length}/${allowSet.length})` +
    `   ${((Date.now() - started) / 1000).toFixed(1)}s`,
)

if (failures.length > 0) {
  console.log('\nFailures:')
  for (const failure of failures) {
    console.log(
      `  ${failure.testCase.id}: expected to ${failure.testCase.expect}. ${failure.testCase.why}.` +
        `\n    got ${failure.category} — ${failure.detail}` +
        `\n    input: ${failure.testCase.input}`,
    )
  }
  process.exit(1)
}

console.log('\n100% on both sets.')
