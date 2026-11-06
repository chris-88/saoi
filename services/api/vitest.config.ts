import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: here('../../supabase/functions/_shared') },
      // The shared server code sits outside this package; its bare imports resolve here, and
      // must be the very same zod instance the OpenAPI layer uses.
      { find: /^zod$/, replacement: here('./node_modules/zod') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // One zod instance for the shared schemas and the OpenAPI layer, or `.openapi()` is missing.
    server: { deps: { inline: [/@hono\/zod-openapi/, /@asteasolutions/] } },
  },
})
