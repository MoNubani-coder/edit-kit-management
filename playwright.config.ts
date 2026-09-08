import { defineConfig, devices } from '@playwright/test'

import { e2eDatabaseUrl } from './scripts/e2e/prepare'

/**
 * End-to-end configuration.
 *
 * The suite drives a real browser against a real server against a real
 * database - just not the development one. `npm run e2e:prepare` rebuilds a
 * dedicated `ekms_e2e` database, and the server below is started with that URL,
 * its own build directory and its own storage path, so a run cannot reach
 * development bookings, signatures or photos.
 *
 *   npm run test:e2e            # rebuilds the E2E database, then runs
 *   npm run test:e2e:ui         # watch it happen
 *
 * The database is built by `npm run e2e:prepare`, which the script above runs
 * first: Playwright starts its web server before any global setup, and the
 * server's readiness probe is `/api/health`, which needs the database to be
 * there already.
 *
 * The journey writes signed handovers and returns, which is the point: it is
 * the one test that proves the whole chain from a booking to a signed return
 * document, through the browser, the way an engineer does it at the counter.
 */

const PORT = Number(process.env.E2E_PORT ?? 3210)

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',

  // The journey is one ordered story; running its steps in parallel would be
  // meaningless. Separate spec files still run one after another because they
  // share the one database.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The signature pad is a canvas driven by pointer events.
    hasTouch: false,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `npx next dev --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      NEXT_DIST_DIR: '.next-e2e',
      STORAGE_LOCAL_PATH: './storage-e2e',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
