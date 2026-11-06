import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // GitHub Pages has no rewrites: `/<repo>/` unless a custom domain is configured.
  const raw = env.VITE_BASE_PATH?.trim() || '/'
  const base = raw.endsWith('/') ? raw : `${raw}/`

  return {
    base,
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
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // `start_url`/`scope` follow base so the installed PWA works under /<repo>/.
        manifest: {
          name: 'Saoirse',
          short_name: 'Saoirse',
          description: 'A personal banker for everyone.',
          /**
           * Installed, it opens straight into the conversation.
           *
           * `/` is the conversation now (the marketing landing lives at saoi.ie). `scope` stays
           * at the base so the service worker still covers every route.
           */
          start_url: `${base}#/`,
          scope: base,
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#002F32',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          /*
           * The push handlers, added to the generated worker rather than replacing it.
           *
           * `injectManifest` would mean hand-writing the whole service worker, and this one
           * already precaches the shell, falls back for navigations, never caches the API and
           * cleans up after a deploy. Two event listeners are not worth putting that at risk.
           */
          importScripts: ['push-sw.js'],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Each deploy renames every hashed file, so without this the precache keeps every
          // build it has ever seen and grows until the browser evicts the lot.
          cleanupOutdatedCaches: true,
          navigateFallback: `${base}index.html`,
          // Never cache API responses (CLAUDE.md > GitHub Pages).
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/.*/i,
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      sourcemap: true,
      target: 'es2023',
    },
    server: {
      port: 5173,
    },
  }
})
