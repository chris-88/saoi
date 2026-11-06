// Bundles the service and the shared server code it imports from
// `supabase/functions/_shared` into one file. The shared files sit outside this package, so
// their bare imports (`zod`) are resolved from this package's node_modules.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

await build({
  entryPoints: [here('../src/server.ts')],
  outfile: here('../dist/server.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // The package tsconfig maps every bare import into node_modules for the type checker, which
  // would make esbuild treat packages as local files and bundle them.
  tsconfigRaw: '{}',
  alias: { '@shared': here('../../../supabase/functions/_shared') },
  nodePaths: [here('../node_modules')],
  // Real packages stay external and are installed in the image; only our own code is bundled.
  packages: 'external',
  logLevel: 'info',
})
