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

/** An optional setting that may be present but blank in a .env or compose file. */
const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const optionalText = z.preprocess(blankToUndefined, z.string().trim().min(1).optional())
const optionalSecret = z.preprocess(blankToUndefined, z.string().min(1).optional())

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

  // --- Sign-in methods -------------------------------------------------------
  /** Local email + bcrypt accounts. Keep on for the emergency administrator. */
  AUTH_LOCAL_LOGIN_ENABLED: booleanish.default(true),
  /** Corporate directory (LDAP / Active Directory) sign-in. Off until commissioned. */
  AUTH_LDAP_ENABLED: booleanish.default(false),

  // --- Directory connection (read only when AUTH_LDAP_ENABLED) ---------------
  /** ldaps://host:636 (preferred) or ldap://host:389 with LDAP_STARTTLS=true. */
  LDAP_URL: optionalText,
  LDAP_STARTTLS: booleanish.default(false),
  /** PEM bundle for an internal CA. Certificate validation is always on. */
  LDAP_TLS_CA_FILE: optionalText,
  /** Overrides the host name checked against the certificate, if it differs from the URL. */
  LDAP_TLS_SERVERNAME: optionalText,
  LDAP_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  // --- Directory search ------------------------------------------------------
  LDAP_BASE_DN: optionalText,
  /** Where user objects live; defaults to LDAP_BASE_DN. */
  LDAP_USER_BASE_DN: optionalText,
  /** Service account used to locate the user before verifying their password. */
  LDAP_BIND_DN: optionalText,
  LDAP_BIND_PASSWORD: optionalSecret,
  /** Without a service account the user binds directly as `<username>@<suffix>`. */
  LDAP_UPN_SUFFIX: optionalText,
  /** `{{username}}` is replaced with the escaped sign-in name. */
  LDAP_USER_FILTER: z
    .string()
    .trim()
    .min(1)
    .default('(&(objectClass=user)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))'),

  // --- Directory attributes --------------------------------------------------
  /** The stable identity the local account is linked by. objectGUID never changes. */
  LDAP_ID_ATTRIBUTE: z.string().trim().min(1).default('objectGUID'),
  LDAP_USERNAME_ATTRIBUTE: z.string().trim().min(1).default('sAMAccountName'),
  LDAP_NAME_ATTRIBUTE: z.string().trim().min(1).default('displayName'),
  LDAP_EMAIL_ATTRIBUTE: z.string().trim().min(1).default('mail'),
  /** Optional, e.g. employeeID. Blank means the directory does not carry a staff number. */
  LDAP_STAFF_ID_ATTRIBUTE: optionalText,
  LDAP_GROUP_ATTRIBUTE: z.string().trim().min(1).default('memberOf'),

  // --- Directory accounts in the application --------------------------------
  /** Create a local account on first successful directory sign-in. Off: an administrator creates it first. */
  LDAP_AUTO_PROVISION: booleanish.default(false),
  /** Role a provisioned account starts with. ADMIN is deliberately not an option. */
  LDAP_DEFAULT_ROLE: z.enum(['ENGINEER', 'EDITOR', 'VIEWER']).default('VIEWER'),
  /** Semicolon-separated group DNs. Blank means the role stays under local administration. */
  LDAP_ROLE_GROUPS_ADMIN: optionalText,
  LDAP_ROLE_GROUPS_ENGINEER: optionalText,
  LDAP_ROLE_GROUPS_EDITOR: optionalText,
  LDAP_ROLE_GROUPS_VIEWER: optionalText,

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

  const directoryProblems = directoryConfigurationProblems(parsed.data)
  if (directoryProblems.length > 0) {
    const details = directoryProblems.map((problem) => `  - ${problem}`).join('\n')
    throw new Error(
      `Invalid directory (LDAP) configuration:\n${details}\n\n` +
        'See .env.example and docs/OPERATIONS.md for the directory sign-in settings.',
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

/**
 * The directory settings only make sense together, which a per-field schema
 * cannot say. Every rule here exists to stop a password going somewhere it
 * should not: over plaintext LDAP, to a server nobody can vouch for, or to a
 * deployment where nobody at all can sign in.
 */
export function directoryConfigurationProblems(values: Env): string[] {
  const problems: string[] = []
  if (!values.AUTH_LOCAL_LOGIN_ENABLED && !values.AUTH_LDAP_ENABLED) {
    problems.push('AUTH_LOCAL_LOGIN_ENABLED and AUTH_LDAP_ENABLED are both off: nobody could sign in.')
  }
  if (!values.AUTH_LDAP_ENABLED) return problems

  if (!values.LDAP_URL) {
    problems.push('LDAP_URL is required when AUTH_LDAP_ENABLED=true.')
  } else {
    let protocol: string | null = null
    try {
      protocol = new URL(values.LDAP_URL).protocol
    } catch {
      problems.push('LDAP_URL must be a URL such as ldaps://dc.example.local:636.')
    }
    if (protocol && protocol !== 'ldaps:' && protocol !== 'ldap:') {
      problems.push('LDAP_URL must start with ldaps:// or ldap://.')
    }
    if (protocol === 'ldap:' && !values.LDAP_STARTTLS) {
      problems.push('LDAP_URL uses ldap:// without LDAP_STARTTLS=true. Corporate passwords are never sent over plaintext LDAP; use ldaps:// or enable StartTLS.')
    }
    if (protocol === 'ldaps:' && values.LDAP_STARTTLS) {
      problems.push('LDAP_URL uses ldaps:// with LDAP_STARTTLS=true. LDAPS is already encrypted from the first byte; StartTLS is for ldap:// on 389. Set one or the other.')
    }
  }
  if (!values.LDAP_USER_BASE_DN && !values.LDAP_BASE_DN) {
    problems.push('LDAP_USER_BASE_DN (or LDAP_BASE_DN) is required so the user search is confined to the right subtree.')
  }
  if (Boolean(values.LDAP_BIND_DN) !== Boolean(values.LDAP_BIND_PASSWORD)) {
    problems.push('LDAP_BIND_DN and LDAP_BIND_PASSWORD must be set together (a service account) or both left blank (direct user bind).')
  }
  if (!values.LDAP_BIND_DN && !values.LDAP_UPN_SUFFIX) {
    problems.push('Without a service account (LDAP_BIND_DN) the user binds directly, which needs LDAP_UPN_SUFFIX (for example corp.example.ae).')
  }
  if (!values.LDAP_USER_FILTER.includes('{{username}}')) {
    problems.push('LDAP_USER_FILTER must contain the {{username}} placeholder.')
  }
  return problems
}

export const env = loadEnv()

/** Whether directory sign-in is switched on. Cheap to read; nothing else about the directory leaves the server. */
export const directorySignInEnabled = env.AUTH_LDAP_ENABLED
export const localSignInEnabled = env.AUTH_LOCAL_LOGIN_ENABLED

export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'
export const isTest = env.NODE_ENV === 'test'
