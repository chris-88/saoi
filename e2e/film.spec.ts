import { expect, test, type Page } from '@playwright/test'

/**
 * The structural half of the §55 film sequence.
 *
 * Deliberately not a conversation test: every turn costs a live model call and takes fifteen
 * seconds, so asserting on what Saoirse says would be slow, expensive and flaky. What this guards
 * is the scaffolding the film runs on — that each beat's screen exists, carries the control
 * the presenter reaches for, and is reachable from the one before. Those are what broke in
 * practice, and none of them need a model.
 *
 *   E2E_BASE_URL=https://app.saoi.ie npm run e2e
 */

function scriptErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      errors.push(message.text())
    }
  })
  return errors
}

test('beat 3 — the public site offers the conversation before any product', async ({ page }) => {
  const errors = scriptErrors(page)
  await page.goto('/#/')

  // The composer is the entry point, not a chat bubble in the corner (§31).
  await expect(page.getByPlaceholder(/trying to do/i).first()).toBeVisible()

  // Openers are situations, not a product menu: a menu makes the customer pick the answer
  // before anyone has worked out the question.
  const openers = page.getByRole('button', { name: /buy a home|credit card|personal loan/i })
  expect(await openers.count()).toBe(0)

  expect(errors).toEqual([])
})

test('beat 7 — signing in is reachable and says it is simulated', async ({ page }) => {
  await page.goto('/#/app/login')
  await expect(page.getByText(/simulated sign-in for demonstration/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('beats 8 and 20 — the app shell carries Saoirse in the middle of the navigation', async ({
  page,
}) => {
  const errors = scriptErrors(page)
  await page.goto('/#/app')

  // Saoirse in the centre of the tab bar is the proposition in one piece of UI.
  await expect(page.getByRole('link', { name: 'Saoirse', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /your applications/i })).toBeVisible()

  expect(errors).toEqual([])
})

test('beat 15 — an invalid invite is refused rather than rendering a partner page', async ({
  page,
}) => {
  await page.goto('/#/join/not-a-real-token')
  await expect(page.getByText(/invitation link isn.{0,3}t valid/i)).toBeVisible()
})

test('beats 17 and 18 — the console is where the bank moves and notifies', async ({ page }) => {
  const errors = scriptErrors(page)
  await page.goto('/#/admin')

  // Behind a real sign-in: the console is not part of the customer's surface (§47).
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  await expect(page.getByLabel(/email/i)).toBeVisible()

  expect(errors).toEqual([])
})

test('the demo entry starts the public conversation rather than a product page', async ({
  page,
}) => {
  // §55 opens on the public website while §67 ends with the bank moving an application, so
  // the presenter's link has to land in the conversation for both halves to share a case.
  await page.goto('/#/?demo=1')
  await expect(page.getByPlaceholder(/trying to do/i).last()).toBeVisible()
})
