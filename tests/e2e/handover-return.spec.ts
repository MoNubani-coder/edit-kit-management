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

test('1. the engineer books the kit for a requester, typed in by hand', async ({ page }) => {
  await signIn(page, 'engineer')
  await page.goto('/bookings/new')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/new booking/i)

  // Kit first. There is no editor picker any more: the requester is typed in.
  await page.getByLabel('Search kits').fill('MBP-02')
  await page.getByLabel('Search kits').press('Enter')
  await page.getByRole('link', { name: /^select$/i }).first().click()
  await expect(page).toHaveURL(/kitId=/)
  await expect(page.getByLabel('Search editors')).toHaveCount(0)

  // Who it is for: manual fields, kept on the booking as its own record.
  // A required field's label carries an aria-hidden asterisk, so the role's
  // accessible name is what distinguishes "Name" from "Project name".
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Omar Farouk')
  await page.getByLabel('Staff ID').fill('EXT-5001')
  await page.getByLabel('Mobile number').fill('+971 55 000 1001')
  await page.getByLabel('Project name').fill('Ramadan documentary')
  await page.getByLabel('Work order').fill('WO-2044-0017')
  await page.getByLabel('Purpose').fill('End-to-end journey')

  // Prepared by is shown from the signed-in account and cannot be typed.
  await expect(page.getByText(/prepared by/i).first()).toBeVisible()
  await expect(page.getByText('Khalid Al Mansoori').first()).toBeVisible()
  await expect(page.locator('input[name="preparedBy"]')).toHaveCount(0)

  // The form pre-fills a valid window an hour from now. Reserve on it.
  const reserve = page.getByRole('button', { name: 'Reserve kit' })
  await expect(reserve).toBeEnabled()
  await reserve.click()

  await expect(page).toHaveURL(/\/bookings\/[a-z0-9]+$/i, { timeout: 60_000 })
  bookingUrl = new URL(page.url()).pathname
  bookingNumber = (await page.getByText(/BK-\d{4}-\d{6}/).first().textContent())?.match(/BK-\d{4}-\d{6}/)?.[0] ?? ''
  expect(bookingNumber).toMatch(/^BK-\d{4}-\d{6}$/)
  await expect(page.getByText(/reserved/i).first()).toBeVisible()
  await expect(page.getByText('Omar Farouk').first()).toBeVisible()
  await expect(page.getByText('WO-2044-0017').first()).toBeVisible()
})

test('2. the checklist is prepared before the kit is set aside', async ({ page }) => {
  acceptConfirms(page)
  await signIn(page, 'engineer')
  await page.goto(bookingUrl)

  // Setting the kit aside is refused while the checklist is incomplete.
  await page.getByRole('button', { name: 'Mark ready for handover' }).click()
  await expect(page.getByText(/cannot be set aside for handover until its checklist is complete/i)).toBeVisible({ timeout: 60_000 })

  // Prepare it on the booking's own Checklist tab.
  await page.goto(`${bookingUrl}?tab=checklist`)
  const passed = await setEveryRadio(page, 'check.', 'PASS')
  expect(passed).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Save checklist' }).click()
  await expect(page.getByText(/checklist complete/i).first()).toBeVisible({ timeout: 60_000 })

  // Now the kit can be set aside.
  await page.goto(bookingUrl)
  await page.getByRole('button', { name: 'Mark ready for handover' }).click()
  await expect(page.getByText(/ready for handover/i).first()).toBeVisible({ timeout: 60_000 })
})

/** Clicks a "Save signature" button and waits for the server action's response, so a reload reads the committed row. */
async function saveSignature(page: Page, which: 'first' | 'last') {
  const button = page.getByRole('button', { name: 'Save signature' })[which]()
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.status() < 400, { timeout: 60_000 }),
    button.click(),
  ])
  await page.reload()
}

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

  // The checklist arrives already prepared: this step is a review, with no
  // software section and nothing left to answer.
  await expect(page.getByRole('heading', { name: /checklist review/i })).toBeVisible()
  await expect(page.locator('select[name^="software."]')).toHaveCount(0)
  await expect(page.getByText(/required checks? (has|have) not been answered/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Amend answers' })).toBeVisible()

  // The recipient enters their name and mobile, then signs. The fields are
  // pre-filled from the booking and can be corrected.
  await expect(page.getByLabel('Recipient name')).toHaveValue('Omar Farouk')
  await page.getByLabel('Recipient name').fill('Omar Farouk')
  await page.getByLabel('Mobile number').fill('+971 55 000 1001')
  await drawSignature(page, /^Recipient signature pad/)
  await saveSignature(page, 'first')
  await expect(page.getByText(/^Signed by/).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Omar Farouk').first()).toBeVisible()

  // The recipient's typed identity is what was stored, mobile included.
  await expect(page.getByText('+971 55 000 1001').first()).toBeVisible()

  // The engineer pad has no name field at all: the name comes from the account.
  await expect(page.locator('input[name="recipientName"]')).toHaveCount(0)

  await drawSignature(page, /^Engineer signature pad/)
  await saveSignature(page, 'last')
  await expect(page.getByText(/^Signed by/).nth(1)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Khalid Al Mansoori').first()).toBeVisible()

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

  // The Return Kit button on the checked-out booking is the way in.
  await page.goto(bookingUrl)
  await page.getByRole('link', { name: 'Return Kit' }).click()
  await expect(page).toHaveURL(new RegExp(`${bookingUrl}/return$`))
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

  // The receiving engineer signs, as the account; the returning person's
  // signature is optional here.
  await drawSignature(page, /^Engineer receiving the kit pad/)
  await saveSignature(page, 'first')
  await expect(page.getByText(/^Signed by/).first()).toBeVisible({ timeout: 60_000 })

  // Received by is the signed-in engineer, shown not typed; the date is the
  // server's; who returned it is typed.
  await expect(page.getByText(/received by/i).first()).toBeVisible()
  await expect(page.getByText('Khalid Al Mansoori').first()).toBeVisible()
  await expect(page.getByText(/set by the server/i)).toBeVisible()
  await expect(page.locator('input[name="receivedBy"]')).toHaveCount(0)
  await page.getByLabel('Staff who returned the kit').fill('Omar Farouk')

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
  // The frozen return names who returned it and who received it.
  await expect(page.getByText(/returned by/i).first()).toBeVisible()
  await expect(page.getByText('Omar Farouk').first()).toBeVisible()
  await expect(page.getByText('Khalid Al Mansoori').first()).toBeVisible()

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
