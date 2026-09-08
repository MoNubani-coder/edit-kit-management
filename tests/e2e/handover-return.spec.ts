import { expect, type Page, test } from '@playwright/test'

import { acceptConfirms, drawSignature, signIn } from './helpers'

/**
 * The roadmap's end-to-end journey: a booking goes out and comes back.
 *
 * One engineer, one seeded kit, one external editor who signs on the
 * engineer's screen. The story runs in order through the real pages - the
 * booking form and its pickers, the lifecycle buttons, the handover's four
 * steps with both signatures drawn on the canvas, the signed document and its
 * PDF, then the return with every item accounted for and the receiving
 * engineer's signature - and ends with the booking completed and the kit back
 * in service. Each step asserts what the previous one promised, so a failure
 * points at the step that broke the chain.
 *
 * It runs against the E2E database only. See playwright.config.ts.
 */

test.describe.configure({ mode: 'serial' })

let bookingUrl = ''
let bookingNumber = ''

/**
 * Answers every radio of one kind.
 *
 * The controls are visually a row of buttons: the radio itself is
 * screen-reader-only inside a styled label. `check({ force: true })` clicks the
 * input the label points at, which is what a tap on the label does, and unlike
 * clicking the label it cannot miss when the row re-renders under it.
 */
async function setEveryRadio(page: Page, namePrefix: string, value: string): Promise<number> {
  const radios = page.locator(`input[type="radio"][name^="${namePrefix}"][value="${value}"]`)
  const count = await radios.count()
  for (let index = 0; index < count; index += 1) {
    await radios.nth(index).check({ force: true })
  }
  return count
}

test('1. the engineer books the kit for the editor', async ({ page }) => {
  await signIn(page, 'engineer')
  await page.goto('/bookings/new')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/new booking/i)

  // Editor first: the kit search is offered once an editor is chosen.
  await page.getByLabel('Search editors').fill('Omar')
  await page.getByLabel('Search editors').press('Enter')
  await page.getByRole('link', { name: /^select$/i }).first().click()
  await expect(page).toHaveURL(/editorId=/)

  await page.getByLabel('Search kits').fill('MBP-02')
  await page.getByLabel('Search kits').press('Enter')
  await page.getByRole('link', { name: /^select$/i }).first().click()
  await expect(page).toHaveURL(/kitId=/)

  await page.getByLabel('Purpose').fill('End-to-end journey')

  // The form pre-fills a valid window an hour from now. Reserve on it.
  const reserve = page.getByRole('button', { name: 'Reserve kit' })
  await expect(reserve).toBeEnabled()
  await reserve.click()

  await expect(page).toHaveURL(/\/bookings\/[a-z0-9]+$/i, { timeout: 60_000 })
  bookingUrl = new URL(page.url()).pathname
  bookingNumber = (await page.getByText(/BK-\d{4}-\d{6}/).first().textContent())?.match(/BK-\d{4}-\d{6}/)?.[0] ?? ''
  expect(bookingNumber).toMatch(/^BK-\d{4}-\d{6}$/)
  await expect(page.getByText(/reserved/i).first()).toBeVisible()
})

test('2. the engineer sets the kit aside for handover', async ({ page }) => {
  acceptConfirms(page)
  await signIn(page, 'engineer')
  await page.goto(bookingUrl)

  await page.getByRole('button', { name: 'Mark ready for handover' }).click()
  await expect(page.getByText(/ready for handover/i).first()).toBeVisible({ timeout: 60_000 })
})

test('3. the handover is verified, signed by both parties and completed', async ({ page }) => {
  await signIn(page, 'engineer')
  await page.goto(`${bookingUrl}/handover`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/handover/i)

  await page.getByRole('button', { name: 'Start handover' }).click()
  await expect(page.getByRole('button', { name: 'Save equipment verification' })).toBeVisible({ timeout: 60_000 })

  // Equipment: everything goes into the case as it is.
  const conditions = page.locator('select[name^="asset."][name$=".status"]')
  const lineCount = await conditions.count()
  expect(lineCount).toBeGreaterThan(0)
  for (let index = 0; index < lineCount; index += 1) await conditions.nth(index).selectOption('INCLUDED')
  await page.getByRole('button', { name: 'Save equipment verification' }).click()
  await expect(page.getByRole('button', { name: 'Save equipment verification' })).toBeEnabled({ timeout: 60_000 })

  // Checklist and software: every check passes, every application is installed.
  const passed = await setEveryRadio(page, 'check.', 'PASS')
  expect(passed).toBeGreaterThan(0)
  expect(await page.locator('input[type="radio"][name^="check."][value="PASS"]:checked').count()).toBe(passed)
  const software = page.locator('select[name^="software."][name$=".status"]')
  const softwareCount = await software.count()
  for (let index = 0; index < softwareCount; index += 1) await software.nth(index).selectOption('INSTALLED')
  await page.getByRole('button', { name: 'Save checklist and software' }).click()
  await expect(page.getByRole('button', { name: 'Save checklist and software' })).toBeEnabled({ timeout: 60_000 })

  // Read the page back from the server rather than trusting the client's own
  // idea of what was saved: what matters is what the next request sees.
  await page.reload()
  await expect(page.getByText(/required checks? (has|have) not been answered/)).toHaveCount(0)

  // Both signatures, on this device.
  await drawSignature(page, /^Editor signature pad/)
  await page.getByRole('button', { name: 'Save signature' }).first().click()
  await expect(page.getByText(/^Signed by/).first()).toBeVisible({ timeout: 60_000 })

  await drawSignature(page, /^Engineer signature pad/)
  await page.getByRole('button', { name: 'Save signature' }).first().click()
  await expect(page.getByText(/^Signed by/).nth(1)).toBeVisible({ timeout: 60_000 })

  // Complete.
  await page.reload()
  const confirm = page.getByRole('checkbox')
  await expect(confirm).toBeEnabled({ timeout: 60_000 })
  await confirm.check()
  await page.getByRole('button', { name: 'Complete handover' }).click()

  await expect(page).toHaveURL(new RegExp(`${bookingUrl}$`), { timeout: 60_000 })
  await expect(page.getByText(/checked out/i).first()).toBeVisible()
})

test('4. the signed handover document and its PDF can be read', async ({ page, request }) => {
  await signIn(page, 'engineer')
  await page.goto(bookingUrl)
  await expect(page.getByText(/signed documents/i)).toBeVisible()

  await page.goto(`${bookingUrl}/document/handover`)
  // Two level-one headings here: the page's own and the printed sheet's.
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(bookingNumber)
  await expect(page.getByText('MBP-02').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /download pdf/i })).toBeVisible()

  // The PDF route, with the browser's own session.
  const cookies = await page.context().cookies()
  const pdf = await request.get(`/api/documents/handover/${bookingUrl.split('/').pop()}`, {
    headers: { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') },
  })
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toContain('application/pdf')
  expect(pdf.headers()['cache-control']).toContain('no-store')
  const body = await pdf.body()
  expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
})

test('5. the return is accounted for, signed by the receiving engineer and completed', async ({ page }) => {
  await signIn(page, 'engineer')
  await page.goto(`${bookingUrl}/return`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/return/i)

  await page.getByRole('button', { name: 'Start return inspection' }).click()
  await expect(page.getByRole('button', { name: 'Save what came back' })).toBeVisible({ timeout: 60_000 })

  // Every item that went out came back.
  const answered = await setEveryRadio(page, 'asset.', 'INCLUDED')
  expect(answered).toBeGreaterThan(0)
  const accessories = page.locator('select[name^="accessory."][name$=".status"]')
  const accessoryCount = await accessories.count()
  for (let index = 0; index < accessoryCount; index += 1) await accessories.nth(index).selectOption('INCLUDED')
  await page.getByRole('button', { name: 'Save what came back' }).click()
  await expect(page.getByRole('button', { name: 'Save what came back' })).toBeEnabled({ timeout: 60_000 })
  await page.reload()
  await expect(page.getByText(/no return answer/)).toHaveCount(0)

  // Return checks, if the template has any. The return phase renders each
  // check as a select rather than the handover's row of buttons.
  if ((await page.getByRole('button', { name: 'Save return checks' }).count()) > 0) {
    const checks = page.locator('select[name^="check."][name$=".status"]')
    const checkCount = await checks.count()
    expect(checkCount).toBeGreaterThan(0)
    for (let index = 0; index < checkCount; index += 1) await checks.nth(index).selectOption('PASS')
    await page.getByRole('button', { name: 'Save return checks' }).click()
    await expect(page.getByRole('button', { name: 'Save return checks' })).toBeEnabled({ timeout: 60_000 })
    await page.reload()
    await expect(page.getByText(/required return checks? (has|have) not been answered/)).toHaveCount(0)
  }

  // The receiving engineer signs; the editor's signature is optional here.
  await drawSignature(page, /^Engineer receiving the kit pad/)
  await page.getByRole('button', { name: 'Save signature' }).first().click()
  await expect(page.getByText(/^Signed by/).first()).toBeVisible({ timeout: 60_000 })

  await page.reload()
  const confirm = page.getByRole('checkbox')
  await expect(confirm).toBeEnabled({ timeout: 60_000 })
  await confirm.check()
  await page.getByRole('button', { name: 'Complete return' }).click()

  await expect(page).toHaveURL(new RegExp(`${bookingUrl}$`), { timeout: 60_000 })
  await expect(page.getByText(/completed/i).first()).toBeVisible()
})

test('6. the booking is complete, the kit is back in service and both documents exist', async ({ page }) => {
  await signIn(page, 'engineer')

  await page.goto(bookingUrl)
  await expect(page.getByText(/completed/i).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /return sheet|return document|return/i }).first()).toBeVisible()

  await page.goto(`${bookingUrl}/document/return`)
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(bookingNumber)
  await expect(page.getByText(/returned/i).first()).toBeVisible()

  await page.goto('/kits')
  const row = page.getByRole('row', { name: /MBP-02/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText(/available/i)

  await page.goto('/reports/handover-return-records')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/handover and return records/i)
  await expect(page.getByText(bookingNumber).first()).toBeVisible()
})

test('7. another editor cannot reach the booking or its signed documents', async ({ page }) => {
  // The booking belongs to an external editor with no account. The internal
  // E2E editor is somebody else, so the booking is not theirs to read - and
  // a booking they may not see is answered as one that does not exist, which
  // gives away less than a refusal would.
  await signIn(page, 'editor')

  await page.goto(bookingUrl)
  await expect(page.getByRole('heading', { name: /page not found|access denied/i })).toBeVisible()
  await expect(page.getByText(bookingNumber)).toHaveCount(0)

  await page.goto(`${bookingUrl}/document/handover`)
  await expect(page.getByRole('heading', { name: /page not found|access denied/i })).toBeVisible()
  await expect(page.getByText(bookingNumber)).toHaveCount(0)
})
