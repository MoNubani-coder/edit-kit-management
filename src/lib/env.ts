import { z } from 'zod'

/**
 * Environment validation.
 *
 * Parsed once at module load. A missing or malformed variable fails the process
 * at startup with a readable message, rather than surfacing as `undefined`
 * somewhere deep in a request three days later.
 *
 * This module is server-only by convention: it is imported by `server/` code and
 * by the seed scripts. It must never be imported from a Client Component - only
 * `NEXT_PUBLIC_*` values may cross that boundary, and there are none here.
 */

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // --- Database --------------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a PostgreSQL connection string',
    ),

  // --- Authentication --------------------------------------------------------
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'),
  AUTH_URL: z.url().optional(),
  AUTH_TRUST_HOST: booleanish.default(false),

  // --- Session policy --------------------------------------------------------
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(28_800),
  SESSION_UPDATE_AGE_SECONDS: z.coerce.number().int().positive().default(900),

  // --- Local account lockout -------------------------------------------------
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // --- Application -----------------------------------------------------------
  APP_NAME: z.string().min(1).default('Edit Kit Management System'),
  APP_ORG_NAME: z.string().min(1).default('Engineering & Editing Department'),
  APP_TIMEZONE: z.string().min(1).default('Asia/Dubai'),
  /** Window for the bookings "Due soon" filter and dashboard upcoming returns. */
  BOOKING_DUE_SOON_HOURS: z.coerce.number().int().positive().default(48),

  // --- Storage ---------------------------------------------------------------
  STORAGE_PROVIDER: z.enum(['LOCAL', 'AZURE_BLOB']).default('LOCAL'),
  STORAGE_LOCAL_PATH: z.string().min(1).default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    )
  }

  // AZURE_BLOB is a documented seam, not an implementation. Fail loudly rather
  // than silently writing files to the local disk of a container.
  if (parsed.data.STORAGE_PROVIDER === 'AZURE_BLOB') {
    throw new Error(
      'STORAGE_PROVIDER=AZURE_BLOB is not implemented yet. Use LOCAL until the ' +
        'Azure Blob driver lands (see docs/ARCHITECTURE.md, AD-4).',
    )
  }

  return parsed.data
}

export const env = loadEnv()

export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'
export const isTest = env.NODE_ENV === 'test'
