/**
 * Command-line entry for the end-to-end database.
 *
 * `prepare.ts` is imported by playwright.config.ts, which Playwright loads as
 * CommonJS, so it cannot carry an `import.meta` entry check of its own.
 *
 *   npm run e2e:prepare
 *   npm run e2e:drop
 */

import prepare, { dropDatabase } from './prepare'

const drop = process.argv.includes('--drop')

const task = drop ? dropDatabase().then(() => console.log('  Dropped the end-to-end database.')) : prepare()

task.catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
