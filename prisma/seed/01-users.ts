import { randomBytes } from 'node:crypto'

import { PrismaClient, UserRole, UserStatus } from '@prisma/client'

import { hashPassword, MIN_PASSWORD_LENGTH } from '../../src/server/auth/password'

export interface SeededCredential {
  role: string
  email: string
  /** Present only when the account was created in this run. */
  password: string | null
  /** True when the password was randomly generated in this run. */
  generated: boolean
  /** True when the account already existed and its password was left untouched. */
  existing: boolean
}

/**
 * Resolves a seed password.
 *
 * A committed default password is how internal tools end up with `admin/admin`
 * in production, so there isn't one. If the environment does not supply a
 * password we generate a strong random one and return it for printing - once,
 * to the operator running the seed.
 */
function resolvePassword(envVar: string): { password: string; generated: boolean } {
  const fromEnv = process.env[envVar]

  if (fromEnv && fromEnv.length > 0) {
    if (fromEnv.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`${envVar} must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    }
    return { password: fromEnv, generated: false }
  }

  // 24 URL-safe chars.
  return { password: randomBytes(18).toString('base64url'), generated: true }
}

interface UserSpec {
  emailEnvVar: string
  defaultEmail: string
  passwordEnvVar: string
  name: string
  staffId: string
  phone?: string
  role: UserRole
}

/**
 * Creates the user if missing; otherwise re-asserts role/status and leaves the
 * password alone. Re-running the seed must never silently rotate a password
 * somebody has already changed - and must never *claim* to have set a password
 * it did not set, which is why the credential reports `existing`.
 */
async function ensureUser(prisma: PrismaClient, spec: UserSpec) {
  // Every sign-in path lower-cases the name before looking the account up, so
  // a mixed-case SEED_*_EMAIL has to be stored the way it will be searched for.
  const email = (process.env[spec.emailEnvVar] ?? spec.defaultEmail).trim().toLowerCase()

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })

  if (existing) {
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { role: spec.role, status: UserStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    })

    const credential: SeededCredential = {
      role: spec.role,
      email,
      password: null,
      generated: false,
      existing: true,
    }

    return { user, credential }
  }

  const { password, generated } = resolvePassword(spec.passwordEnvVar)

  const user = await prisma.user.create({
    data: {
      email,
      name: spec.name,
      staffId: spec.staffId,
      phone: spec.phone,
      role: spec.role,
      status: UserStatus.ACTIVE,
      // Same function the application and the reset script use (bcrypt, cost 12).
      passwordHash: await hashPassword(password),
    },
    select: { id: true },
  })

  const credential: SeededCredential = {
    role: spec.role,
    email,
    password,
    generated,
    existing: false,
  }

  return { user, credential }
}

export async function seedUsers(prisma: PrismaClient): Promise<SeededCredential[]> {
  const credentials: SeededCredential[] = []

  // --- Administrator ---------------------------------------------------------
  const admin = await ensureUser(prisma, {
    emailEnvVar: 'SEED_ADMIN_EMAIL',
    defaultEmail: 'admin@example.ae',
    passwordEnvVar: 'SEED_ADMIN_PASSWORD',
    name: 'System Administrator',
    staffId: 'ADM-0001',
    role: UserRole.ADMIN,
  })
  credentials.push(admin.credential)

  // --- Engineer (internal staff, always has an account) ----------------------
  const engineer = await ensureUser(prisma, {
    emailEnvVar: 'SEED_ENGINEER_EMAIL',
    defaultEmail: 'engineer@example.ae',
    passwordEnvVar: 'SEED_ENGINEER_PASSWORD',
    name: 'Khalid Al Mansoori',
    staffId: 'ENG-1043',
    phone: '+971 50 000 0001',
    role: UserRole.ENGINEER,
  })
  credentials.push(engineer.credential)

  await prisma.engineerProfile.upsert({
    where: { userId: engineer.user.id },
    update: { isActive: true, deletedAt: null },
    create: {
      userId: engineer.user.id,
      fullName: 'Khalid Al Mansoori',
      staffId: 'ENG-1043',
      email: engineer.credential.email,
      contactNumber: '+971 50 000 0001',
      department: 'Broadcast Engineering',
    },
  })

  // --- Internal editor (has an account AND an editor profile) ----------------
  const editor = await ensureUser(prisma, {
    emailEnvVar: 'SEED_EDITOR_EMAIL',
    defaultEmail: 'editor@example.ae',
    passwordEnvVar: 'SEED_EDITOR_PASSWORD',
    name: 'Layla Hassan',
    staffId: 'EDT-2210',
    phone: '+971 50 000 0002',
    role: UserRole.EDITOR,
  })
  credentials.push(editor.credential)

  await prisma.editorProfile.upsert({
    where: { userId: editor.user.id },
    update: { isActive: true, deletedAt: null },
    create: {
      userId: editor.user.id,
      fullName: 'Layla Hassan',
      staffId: 'EDT-2210',
      email: editor.credential.email,
      contactNumber: '+971 50 000 0002',
      department: 'Post Production',
      isExternal: false,
    },
  })

  // --- Viewer (read-only management account) ---------------------------------
  const viewer = await ensureUser(prisma, {
    emailEnvVar: 'SEED_VIEWER_EMAIL',
    defaultEmail: 'viewer@example.ae',
    passwordEnvVar: 'SEED_VIEWER_PASSWORD',
    name: 'Noura Al Suwaidi',
    staffId: 'VWR-3301',
    role: UserRole.VIEWER,
  })
  credentials.push(viewer.credential)

  // --- External editors (NO login account) -----------------------------------
  // These exercise the case the schema was designed around: a freelance editor
  // who appears on bookings and signs handovers but has no user record.
  const externalEditors = [
    {
      staffId: 'EXT-5001',
      fullName: 'Omar Farouk',
      contactNumber: '+971 55 000 1001',
      company: 'Independent',
    },
    {
      staffId: 'EXT-5002',
      fullName: 'Priya Nair',
      contactNumber: '+971 55 000 1002',
      company: 'Skyline Post Services',
    },
  ]

  for (const profile of externalEditors) {
    await prisma.editorProfile.upsert({
      where: { staffId: profile.staffId },
      update: { isActive: true, deletedAt: null },
      create: { ...profile, isExternal: true },
    })
  }

  return credentials
}
