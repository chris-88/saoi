import { defineConfig, devices } from '@playwright/test'

/**
 * The §55 film sequence, end to end, at iPhone viewport, against the local stack with
 * LLM_PROVIDER=fixture. Includes a second browser context for the partner.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'iphone',
      // iPhone 14 geometry and touch emulation, but driven by Chromium rather than WebKit:
      // WebKit needs system libraries this machine cannot install without root. Revisit if
      // iOS-specific behaviour (PWA storage partitioning, §30) needs real WebKit.
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },
  ],
  // Point E2E_BASE_URL at a deployed environment to run against it instead of a local dev
  // server: `E2E_BASE_URL=https://app.saoi.ie npm run e2e`.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
})
