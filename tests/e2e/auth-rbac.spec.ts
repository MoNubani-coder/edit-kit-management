import { expect, test } from '@playwright/test'

import { E2E_USERS } from '../../scripts/e2e/prepare'
import { signIn, signOut } from './helpers'

/**
 * Signing in, being turned away, and signing out - through the browser.
 *
 * The unit and integration suites prove the gate and the matrix in detail.
 * This file proves the pieces are wired together on a real page: a wrong
 * password is refused with a sentence and no hint, an anonymous request is
 * sent to login and comes back afterwards, a role is stopped at a route it
 * cannot hold, and the account menu really does end the session.
 */

test.describe('authentication', () => {
  test('an anonymous visitor is sent to login and returned to the page they wanted', async ({ page }) => {
    await page.goto('/kits')
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fkits/)

    await page.getByLabel('Email address').fill(E2E_USERS.engineer.email)
    await page.getByLabel('Password', { exact: true }).fill(E2E_USERS.engineer.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/kits$/, { timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/kits/i)
  })

  test('a wrong password is refused with one sentence and no hint about which part was wrong', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(E2E_USERS.engineer.email)
    await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 60_000 })
    await expect(alert).not.toContainText(/password is wrong|user not found|no such/i)
    await expect(page).toHaveURL(/\/login/)
  })

  test('the account menu signs out and the session is gone', async ({ page }) => {
    await signIn(page, 'viewer')
    await signOut(page)

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('the login page sends a signed-in user straight to the dashboard without looping', async ({ page }) => {
    await signIn(page, 'viewer')
    await page.goto('/login')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('roles', () => {
  test('a viewer is stopped at the issues area and at administration', async ({ page }) => {
    await signIn(page, 'viewer')

    await page.goto('/issues')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)

    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  })

  test('a viewer can read the reports area but not the reports whose data they may not see', async ({ page }) => {
    await signIn(page, 'viewer')

    await page.goto('/reports')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/reports/i)
    await expect(page.getByRole('link', { name: /currently checked out/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^issues$/i })).toHaveCount(0)

    await page.goto('/reports/issues')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  })

  test('an editor sees their own bookings and nothing operational', async ({ page }) => {
    await signIn(page, 'editor')

    await page.goto('/bookings')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.goto('/kits')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()

    await page.goto('/reports')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  })

  test('an administrator reaches administration', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/users/i)
  })

  test('the API refuses an anonymous document request with 401 and no detail', async ({ request }) => {
    const response = await request.get('/api/documents/handover/anything')
    expect(response.status()).toBe(401)
    const body = await response.json()
    expect(body).toEqual({ error: 'unauthorized', message: 'Authentication required.' })
  })
})
