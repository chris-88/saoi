import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The shared domain, contracts and prompts, and the schema-drift test. `services/api` has its own
 * Vitest config and runs in its own CI job.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@domain': resolve('./supabase/functions/_shared/domain'),
      '@contracts': resolve('./supabase/functions/_shared/contracts'),
      '@db': resolve('./supabase/functions/_shared/db'),
      '@llm': resolve('./supabase/functions/_shared/llm'),
      '@tenants': resolve('./supabase/functions/_shared/tenants'),
    },
  },
  test: {
    environment: 'node',
    include: ['supabase/functions/_shared/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/_shared/domain/**'],
    },
  },
})
