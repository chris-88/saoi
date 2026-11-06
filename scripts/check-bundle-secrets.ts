/**
 * Fails if a secret reached the published bundle.
 *
 * The site is public, so anything compiled into `dist/` is readable by anyone. Vite only
 * exposes `VITE_`-prefixed variables, which makes the prefix the entire safety boundary —
 * one mis-prefixed secret in a `.env` file would ship to every visitor. This runs after the
 * build, in CI and locally.
 *
 *   npm run check:bundle
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'

/** Shapes of credentials that must never appear, whatever they are named. */
const SECRET_SHAPES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase personal access token', pattern: /\bsbp_[A-Za-z0-9]{20,}/ },
  { name: 'Supabase service role key', pattern: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'Twilio auth token', pattern: /\bAC[a-f0-9]{32}\b/ },
  { name: 'Private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

/**
 * Non-`VITE_` variables that are nonetheless not secrets, and may legitimately appear.
 * The project ref is part of the Supabase URL; the model names and caps are plain config.
 */
const NOT_SECRET = new Set([
  'SUPABASE_PROJECT_REF',
  'SAOI_MODEL',
  'GATE_MODEL',
  'APP_BASE_URL',
  'AUDIENCE_MAX_TURNS',
  'AUDIENCE_MAX_CASES',
  'LLM_PROVIDER',
  'TWILIO_FROM',
])

/** Exact values of every other non-VITE_ variable in .env: these must never appear. */
function secretValuesFromEnv(): readonly { name: string; value: string }[] {
  if (!existsSync('.env')) return []

  const entries: { name: string; value: string }[] = []
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#') || !trimmed.includes('=')) continue

    const index = trimmed.indexOf('=')
    const name = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()

    // VITE_ values are meant to be public. Everything else is, unless allowlisted.
    if (name.startsWith('VITE_')) continue
    if (NOT_SECRET.has(name)) continue
    // Short values would produce false positives against minified code.
    if (value.length < 8) continue

    entries.push({ name, value })
  }
  return entries
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesIn(path) : [path]
  })
}

if (!existsSync(DIST)) {
  console.error(`No ${DIST}/ directory. Run the build first.`)
  process.exit(1)
}

const envSecrets = secretValuesFromEnv()
const failures: string[] = []

for (const file of filesIn(DIST)) {
  const contents = readFileSync(file, 'utf8')

  for (const shape of SECRET_SHAPES) {
    if (shape.pattern.test(contents)) failures.push(`${file}: ${shape.name}`)
  }
  for (const secret of envSecrets) {
    if (contents.includes(secret.value)) failures.push(`${file}: value of ${secret.name}`)
  }
}

if (failures.length > 0) {
  console.error('SECRETS FOUND IN THE PUBLISHED BUNDLE:')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('\nA secret must not carry a VITE_ prefix. Move it to supabase/.env.local.')
  process.exit(1)
}

console.log(
  `No secrets in ${DIST}/ (checked ${String(SECRET_SHAPES.length)} credential shapes and ` +
    `${String(envSecrets.length)} values from .env).`,
)
