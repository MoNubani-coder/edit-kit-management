import type { UserRole } from '@prisma/client'

/** Display names for roles. The role itself is never shown raw in the UI. */
export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  ADMIN: 'Administrator',
  ENGINEER: 'Engineer',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = {
  ADMIN: 'Full access, including user accounts, reference data and settings.',
  ENGINEER: 'Runs bookings, handovers, returns and issues. No administration.',
  EDITOR: 'Sees and signs for their own bookings only.',
  VIEWER: 'Read-only view of bookings, kits, equipment and reports.',
}
