import { expect, test } from '@playwright/test'

import { signIn } from './helpers'

/**
 * Names the writing tests use. Unique per run, so a second run against a
 * database that was not rebuilt does not collide with the first run's rows on
 * the unique-name constraints.
 */
const RUN = String(Date.now()).slice(-6)

/**
 * The Administration area in a browser.
 *
 * These six pages are the ones a live check found still showing "Arrives in
 * Phase 3". The point of this file is that a placeholder cannot come back
 * unnoticed: every page is opened as an administrator and asserted to render
 * its real workspace, and the phrase itself is asserted to appear nowhere in
 * the section.
 */

const SECTIONS = [
  { path: '/admin/users', heading: /users/i, proof: /accounts, roles and lockouts/i },
  { path: '/admin/categories', heading: /categories/i, proof: /equipment categories/i },
  { path: '/admin/software', heading: /software/i, proof: /applications kits are expected to carry/i },
  { path: '/admin/checklists', heading: /checklist templates/i, proof: /the checks a handover and a return ask for/i },
  { path: '/admin/audit-logs', heading: /audit logs/i, proof: /append-only/i },
  { path: '/admin/settings', heading: /settings/i, proof: /effective configuration/i },
] as const

test.describe('administration', () => {
  test('every section renders a real workspace, and none of them mentions a phase', async ({ page }) => {
    await signIn(page, 'admin')

    for (const section of SECTIONS) {
      await page.goto(section.path)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(section.heading)
      await expect(page.getByText(section.proof).first()).toBeVisible()

      const body = await page.locator('main').innerText()
      expect(body).not.toMatch(/Arrives in Phase/i)
      expect(body).not.toMatch(/will be populated in Phase/i)
      expect(body).not.toMatch(/coming soon/i)
    }
  })

  test('the audit log lists real entries, filters them and pages them', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/audit-logs')

    // Signing in wrote an entry, so the log is not empty.
    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    await expect(table.getByText(/signed in/i).first()).toBeVisible()

    // Filter to sign-in failures: the table narrows, and the URL carries it.
    await page.getByLabel('Action').selectOption('LOGIN_FAILED')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page).toHaveURL(/action=LOGIN_FAILED/)

    // Clear, then sort by who did it.
    await page.getByRole('link', { name: /clear/i }).click()
    await expect(page).toHaveURL(/\/admin\/audit-logs$/)
    await page.getByRole('link', { name: 'Who' }).click()
    await expect(page).toHaveURL(/sort=actorName/)
  })

  test('the audit log never shows the JSON an entry carries', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/audit-logs')

    const body = await page.locator('main').innerText()
    expect(body).not.toContain('passwordHash')
    expect(body).not.toContain('sessionToken')
    expect(body).not.toContain('previousValue')
    expect(body).not.toContain('newValue')
    expect(body).not.toMatch(/\$2b\$/)
  })

  test('an administrator cannot change their own role or suspend themselves', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/users')

    const ownRow = page.getByRole('row', { name: /e2e-admin@example\.test/ })
    await expect(ownRow).toBeVisible()
    await expect(ownRow.getByText('you', { exact: true })).toBeVisible()
    await expect(ownRow.locator('select')).toBeDisabled()
    await expect(ownRow.getByText(/cannot suspend your own account/i)).toBeVisible()
  })

  test('an administrator suspends and reinstates another account', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/users?q=e2e-viewer')

    const row = page.getByRole('row', { name: /e2e-viewer@example\.test/ })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Suspend' }).click()
    await expect(page.getByRole('row', { name: /e2e-viewer@example\.test/ }).getByText('Suspended')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('row', { name: /e2e-viewer@example\.test/ }).getByRole('button', { name: 'Reinstate' }).click()
    await expect(page.getByRole('row', { name: /e2e-viewer@example\.test/ }).getByText('Active')).toBeVisible({ timeout: 30_000 })
  })

  test('an administrator adds an application to the software catalogue and retires it', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/software')

    await page.getByRole('link', { name: 'New application' }).click()
    await page.getByLabel('Name').fill(`End-to-end Encoder ${RUN}`)
    await page.getByLabel('Version').fill('2044.1')
    await page.getByLabel('Vendor').fill('E2E Systems')
    await page.getByRole('button', { name: 'Create application' }).click()

    const row = page.getByRole('row', { name: new RegExp(`End-to-end Encoder ${RUN}`) })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row.getByText('Active')).toBeVisible()

    await row.getByRole('button', { name: 'Deactivate' }).click()
    await expect(page.getByRole('row', { name: new RegExp(`End-to-end Encoder ${RUN}`) }).getByText('Inactive')).toBeVisible({ timeout: 30_000 })
  })

  test('an administrator builds a checklist template and cannot delete a used check', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/checklists')

    // The seeded template is here, and the handover uses it.
    await expect(page.getByRole('table')).toBeVisible()

    await page.getByRole('link', { name: 'New template' }).click()
    await page.getByLabel('Name').fill(`End-to-end template ${RUN}`)
    await page.getByRole('button', { name: 'Create template' }).click()
    await expect(page).toHaveURL(/template=/, { timeout: 30_000 })

    // Two of these on an empty template: the header link and the empty state's.
    await page.getByRole('link', { name: 'Add check' }).first().click()
    // The required marker sits inside the label, so target the field itself.
    await page.locator('input[name="label"]').fill('Everything accounted for')
    await page.getByRole('button', { name: 'Add check' }).click()

    await expect(page.getByText('Everything accounted for')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Required').first()).toBeVisible()

    // A brand-new check no booking has copied can be removed.
    await page.getByRole('button', { name: 'Remove check' }).first().click()
    await expect(page.getByText('Everything accounted for')).toHaveCount(0, { timeout: 30_000 })
  })

  test('settings is honest about which configuration is live', async ({ page }) => {
    await signIn(page, 'admin')
    await page.goto('/admin/settings')

    await expect(page.getByText(/effective configuration/i)).toBeVisible()
    await expect(page.getByText(/Business time zone/)).toBeVisible()
    await expect(page.getByText(/stored settings are not live yet/i)).toBeVisible()

    // No secret, no connection string, no filesystem path.
    const body = await page.locator('main').innerText()
    expect(body).not.toMatch(/postgres(ql)?:\/\//)
    expect(body).not.toMatch(/AUTH_SECRET/)
    expect(body).not.toMatch(/\.\/storage/)
  })

  test('a viewer reaches none of it', async ({ page }) => {
    await signIn(page, 'viewer')
    for (const section of SECTIONS) {
      await page.goto(section.path)
      await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
    }
  })
})
