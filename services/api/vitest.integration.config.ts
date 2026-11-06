import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Specs that run the real app against `supabase start`. Not part of `npm test`. */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: here('../../supabase/functions/_shared') },
      { find: /^zod$/, replacement: here('./node_modules/zod') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/integration/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One database, and the audience-cap spec changes what a "full" project looks like.
    fileParallelism: false,
    server: { deps: { inline: [/@hono\/zod-openapi/, /@asteasolutions/] } },
  },
})
