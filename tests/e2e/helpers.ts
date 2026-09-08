import { expect, type Page } from '@playwright/test'

import { E2E_USERS } from '../../scripts/e2e/prepare'

/** Signs in through the real login form and waits for the destination. */
export async function signIn(page: Page, who: keyof typeof E2E_USERS): Promise<void> {
  const user = E2E_USERS[who]
  await page.goto('/login')
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 })
}

/** Signs out through the account menu. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account:/ }).click()
  await page.getByRole('menuitem', { name: /sign out/i }).click()
  await expect(page).toHaveURL(/\/login/, { timeout: 60_000 })
}

/**
 * Draws on a signature canvas with the mouse, the way a stylus does.
 * The pad only enables its save button once it has ink.
 */
export async function drawSignature(page: Page, padLabel: RegExp): Promise<void> {
  const canvas = page.getByRole('img', { name: padLabel })
  await expect(canvas).toBeVisible()
  // `hover` scrolls the pad into view and places the pointer inside it; the raw
  // mouse API does neither, and a drag measured from a stale box lands on
  // whatever happens to be at those coordinates.
  const box = (await canvas.boundingBox()) ?? null
  if (!box) throw new Error('The signature pad has no box to draw in.')
  await canvas.hover({ position: { x: box.width * 0.2, y: box.height / 2 } })
  await page.mouse.down()
  for (const step of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    await canvas.hover({ position: { x: box.width * step, y: box.height / 2 + (step > 0.5 ? -18 : 18) } })
  }
  await page.mouse.up()
  // The pad draws a dot on pointer-down, so any registered contact shows ink.
  await expect(canvas.locator('xpath=..').getByText('Sign here with a finger')).toHaveCount(0)
}

/** Accepts every window.confirm, which is how the lifecycle buttons ask. */
export function acceptConfirms(page: Page): void {
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
}
