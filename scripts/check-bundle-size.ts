/**
 * Fails if a first visit got heavier.
 *
 * Two budgets, both gzipped, both measured on `dist/`:
 *
 *  - the entry chunk (`assets/index-*.js`): what every visitor parses before anything renders.
 *  - everything `index.html` loads up front (the entry script plus its `modulepreload` chunks).
 *
 * The numbers are the build before the explainer pages were removed, plus 10%. Deleting pages
 * once made the entry chunk grow by half, because the bundler had merged code the deleted lazy
 * chunks used to share into it. A page that is needed on the first visit belongs in the budget;
 * everything else belongs behind `lazy()` (see `src/app/lazyAdmin.tsx`, `lazySurfaces.tsx`).
 *
 *   npm run check:bundle
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist'
const ASSETS = join(DIST, 'assets')

/** 138.8 kB before the change, plus 10%. */
const ENTRY_BUDGET = 152_600
/** 455.5 kB before the change, plus 10%. */
const UPFRONT_BUDGET = 501_000

if (!existsSync(ASSETS)) {
  console.error(`No ${ASSETS}/ directory. Run the build first.`)
  process.exit(1)
}

const gz = (file: string): number => gzipSync(readFileSync(file)).length
const kb = (n: number): string => `${(n / 1000).toFixed(1)} kB`

const entry = readdirSync(ASSETS).find((f) => /^index-.*\.js$/.test(f))
if (!entry) {
  console.error('No entry chunk (assets/index-*.js) in dist/.')
  process.exit(1)
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const upfront = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].flatMap((m) =>
  m[1] ? [join(DIST, m[1])] : [],
)

const entrySize = gz(join(ASSETS, entry))
const upfrontSize = upfront.reduce((sum, file) => sum + gz(file), 0)

const failures: string[] = []
if (entrySize > ENTRY_BUDGET) {
  failures.push(`entry chunk ${entry} is ${kb(entrySize)} gzipped; budget ${kb(ENTRY_BUDGET)}`)
}
if (upfrontSize > UPFRONT_BUDGET) {
  failures.push(
    `index.html loads ${kb(upfrontSize)} of script up front (${String(upfront.length)} files); ` +
      `budget ${kb(UPFRONT_BUDGET)}`,
  )
}

if (failures.length > 0) {
  console.error('BUNDLE BUDGET EXCEEDED:')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('\nMove what the first visit does not need behind lazy().')
  process.exit(1)
}

console.log(
  `Bundle budget ok: entry ${kb(entrySize)} of ${kb(ENTRY_BUDGET)}, ` +
    `up front ${kb(upfrontSize)} of ${kb(UPFRONT_BUDGET)}.`,
)
