import { expect, test, type Page } from '@playwright/test'

/**
 * Every surface mounts, renders its own content, and carries the prototype disclosure.
 *
 * Runs against the local dev server by default, or against a deployment:
 *   E2E_BASE_URL=https://app.saoi.ie npm run e2e
 *
 * The list is the surfaces that exist. The replica public site, the simulated login and the
 * audience entry were deleted on 2026-10-06; their routes redirect to Saoirse and are checked as
 * redirects below, not as pages.
 */

const surfaces = [
  { route: '/#/', name: 'Saoirse', expect: /what are you trying to do/i, discloses: false },
  {
    route: '/#/',
    name: 'Saoirse (old address)',
    expect: /what are you trying to do/i,
    discloses: false,
  },
  {
    route: '/#/privacy',
    name: 'privacy notice',
    expect: /not a banking service/i,
    discloses: true,
  },
  {
    route: '/#/ask',
    name: 'questions and collaboration',
    expect: /ask a question/i,
    discloses: true,
  },
  // An invalid invite is refused rather than showing a page: the token is the whole gate.
  {
    route: '/#/join/opaque-token',
    name: 'partner join',
    expect: /invitation link isn.{0,3}t valid/i,
    discloses: false,
  },
  { route: '/#/admin', name: 'presenter console', expect: /sign in/i, discloses: false },
] as const

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    // A refused request logs a browser network error. That is the server doing its job, not
    // the app failing, so only genuine script errors count.
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      errors.push(message.text())
    }
  })
  return errors
}

for (const surface of surfaces) {
  test(`${surface.name} renders with no console errors`, async ({ page }) => {
    const errors = collectErrors(page)

    await page.goto(surface.route)

    // React actually mounted, rather than the shell merely being served.
    await expect(page.locator('#root').locator('*').first()).toBeVisible()
    await expect(page.getByText(surface.expect).first()).toBeVisible()

    expect(errors, `console errors on ${surface.route}`).toEqual([])
  })
}

test('every surface with a footer discloses that it is not a banking service', async ({ page }) => {
  for (const surface of surfaces) {
    if (!surface.discloses) continue
    await page.goto(surface.route)
    await expect(page.getByText(/not a banking service/i).first(), surface.route).toBeVisible()
  }
})

test('the old entry points land on Saoirse rather than breaking', async ({ page }) => {
  for (const route of ['/#/try', '/#/app/login', '/#/app']) {
    await page.goto(route)
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByText(/what are you trying to do/i).first()).toBeVisible()
  }
})

test('an unknown route falls back rather than breaking', async ({ page }) => {
  await page.goto('/#/this-route-does-not-exist')
  await expect(page.getByText(/that page does not exist/i)).toBeVisible()
})
