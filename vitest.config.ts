import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  // TEMPORARY: mirrors the branch-badge `define` block in vite.config.ts so any test that
  // renders Providers can resolve them. Remove alongside BuildBadge.
  define: {
    __BUILD_BRANCH__: JSON.stringify('test'),
    __BUILD_SHA__: JSON.stringify('0000000'),
    __BUILD_TIME__: JSON.stringify('2026-10-01T00:00:00.000Z'),
  },
  resolve: {
    alias: {
      '@': resolve('./src'),
      // shadcn generates `import { cn } from "cn"`; keep ui/ identical to upstream.
      cn: resolve('./src/lib/utils.ts'),
      '@domain': resolve('./supabase/functions/_shared/domain'),
      '@contracts': resolve('./supabase/functions/_shared/contracts'),
      '@db': resolve('./supabase/functions/_shared/db'),
      '@llm': resolve('./supabase/functions/_shared/llm'),
      '@tenants': resolve('./supabase/functions/_shared/tenants'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/functions/_shared/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/_shared/domain/**', 'src/**'],
    },
  },
})
