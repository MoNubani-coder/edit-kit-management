import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration.
 *
 * - `tsconfigPaths: true` resolves the `@/*` alias from tsconfig.json.
 * - `server-only` is aliased to an empty module: the real package throws when
 *   imported outside a React Server Components bundle, and the modules under
 *   test legitimately carry that guard.
 * - `next-auth` and `@auth/core` are inlined so Vite resolves their bare
 *   `next/server` / `next/headers` imports the way Next's bundler does; loaded
 *   natively by Node those extension-less specifiers fail.
 * - Test files run one at a time (`fileParallelism: false`) because the
 *   integration suites share one local PostgreSQL database.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: ['default'],
    server: {
      deps: {
        inline: ['next-auth', '@auth/core'],
      },
    },
  },
})
