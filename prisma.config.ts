import 'dotenv/config'

import path from 'node:path'

import { defineConfig, env } from 'prisma/config'

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 no longer reads the `prisma` key from package.json and no longer
 * loads `.env` implicitly - hence the `dotenv/config` import above, which must
 * stay first so `env()` below can see the file.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  datasource: {
    url: env('DATABASE_URL'),
  },

  migrations: {
    seed: 'tsx prisma/seed/index.ts',
  },
})
