import 'server-only'

import { businessDayRange, DEFAULT_TIME_ZONE } from '@/lib/datetime'
import { env } from '@/lib/env'
import { can, canAny, type Permission } from '@/server/auth/permissions'
import { type Actor, requirePermission } from '@/server/auth/session'
import { visibilityFor } from '@/server/dal/bookings.dal'
import {
  countActiveMaintenanceRecords,
  countAssetsInMaintenance,
  countKitsByStatus,
  countOpenIssues,
  countOverdueBookings,
  type DashboardActivityRow,
  type DashboardBookingRow,
  type DashboardIssueRow,
  findBookingHistory,
  findCurrentBooking,
  findOpenIssues,
  findOverdueBookings,
  findRecentActivity,
  findTodaysBookings,
  findUpcomingReturns,
} from '@/server/dal/dashboard.dal'
import { prisma } from '@/server/db/prisma'
import type { Db } from '@/server/db/prisma'

/**
 * Dashboard assembly.
 *
 * `buildDashboard` decides *what the actor may see* with the permission matrix
 * and asks the DAL only for that. Sections the actor may not see are `null`,
 * not empty, so the page can tell "nothing to show" from "not yours to see"
 * and never has to reason about roles itself.
 *
 * All permitted queries run concurrently - roughly ten small indexed queries
 * for an administrator, three for an editor - and the whole thing is one
 * round-trip wide.
 */

export const DASHBOARD_LIMITS = {
  todaysBookings: 8,
  upcomingReturns: 6,
  overdueBookings: 8,
  openIssues: 6,
  recentActivity: 10,
  bookingHistory: 8,
} as const

export interface DashboardKitCounts {
  available: number
  reserved: number
  checkedOut: number
  maintenance: number
  damaged: number
  /** Live, active kits of every status except RETIRED. */
  total: number
}

export interface DashboardMaintenance {
  assetsInMaintenance: number
  /** IN_PROGRESS + ON_HOLD records; null without maintenance.read. */
  activeRecords: number | null
}

export interface DashboardOverdue {
  count: number
  rows: DashboardBookingRow[]
}

export interface DashboardIssues {
  count: number
  rows: DashboardIssueRow[]
}

export interface DashboardMyBookings {
  current: DashboardBookingRow | null
  history: DashboardBookingRow[]
}

export type QuickActionIcon = 'bookings' | 'kits' | 'assets' | 'issues'

export interface QuickAction {
  label: string
  description: string
  href: string
  icon: QuickActionIcon
}

export interface DashboardData {
  generatedAt: Date
  timeZone: string
  /** kit.read */
  kits: DashboardKitCounts | null
  /** asset.read (activeRecords additionally needs maintenance.read) */
  maintenance: DashboardMaintenance | null
  /** booking.read */
  overdue: DashboardOverdue | null
  /** booking.read */
  todaysBookings: DashboardBookingRow[] | null
  /** booking.read */
  upcomingReturns: DashboardBookingRow[] | null
  /** issue.read */
  issues: DashboardIssues | null
  /** Everyone except own-only editors; auth events need admin.audit.read. */
  recentActivity: DashboardActivityRow[] | null
  /** booking.readOwn without booking.read (internal editors). */
  myBookings: DashboardMyBookings | null
  quickActions: QuickAction[]
}

export interface BuildDashboardOptions {
  /** Injected by tests; defaults to the wall clock. */
  now?: Date
  timeZone?: string
}

/**
 * Only links to routes that exist today. "New booking" and "Report issue"
 * arrive with their phases; until then the shortcuts go to the lists.
 */
const QUICK_ACTIONS: ReadonlyArray<QuickAction & { permission: Permission }> = [
  { permission: 'booking.read', label: 'Bookings', description: 'Reservations, handovers and returns', href: '/bookings', icon: 'bookings' },
  { permission: 'kit.read', label: 'Kits', description: 'Kit availability and contents', href: '/kits', icon: 'kits' },
  { permission: 'asset.read', label: 'Equipment', description: 'Assets, accessories and maintenance', href: '/assets', icon: 'assets' },
  { permission: 'issue.read', label: 'Issues', description: 'Missing, damaged and faulty equipment', href: '/issues', icon: 'issues' },
]

export function quickActionsFor(actor: Actor): QuickAction[] {
  // Shortcuts are for people who *do* things; a read-only viewer has the sidebar.
  if (!canAny(actor, ['booking.create', 'issue.create'])) return []

  return QUICK_ACTIONS.filter((action) => can(actor, action.permission)).map(
    ({ label, description, href, icon }) => ({ label, description, href, icon }),
  )
}

async function loadMyBookings(
  db: Db,
  scope: ReturnType<typeof visibilityFor>,
): Promise<DashboardMyBookings> {
  const [current, history] = await Promise.all([
    findCurrentBooking(db, scope),
    findBookingHistory(db, scope, DASHBOARD_LIMITS.bookingHistory),
  ])
  return { current, history }
}

export async function buildDashboard(
  db: Db,
  actor: Actor,
  options: BuildDashboardOptions = {},
): Promise<DashboardData> {
  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE

  const readsAllBookings = can(actor, 'booking.read')
  const readsOwnBookingsOnly = !readsAllBookings && can(actor, 'booking.readOwn')
  const bookingScope = readsAllBookings || readsOwnBookingsOnly ? visibilityFor(actor) : null

  const readsKits = can(actor, 'kit.read')
  const readsAssets = can(actor, 'asset.read')
  const readsMaintenance = can(actor, 'maintenance.read')
  const readsIssues = can(actor, 'issue.read')
  const readsAuthEvents = can(actor, 'admin.audit.read')

  const today = businessDayRange(now, timeZone)
  const operational = readsAllBookings && bookingScope !== null

  const [
    kitCounts,
    assetsInMaintenance,
    activeRecords,
    overdueCount,
    overdueRows,
    todaysBookings,
    upcomingReturns,
    openIssueCount,
    openIssueRows,
    recentActivity,
    myBookings,
  ] = await Promise.all([
    readsKits ? countKitsByStatus(db) : null,
    readsAssets ? countAssetsInMaintenance(db) : null,
    readsAssets && readsMaintenance ? countActiveMaintenanceRecords(db) : null,
    operational ? countOverdueBookings(db, bookingScope, now) : null,
    operational ? findOverdueBookings(db, bookingScope, now, DASHBOARD_LIMITS.overdueBookings) : null,
    operational ? findTodaysBookings(db, bookingScope, today, DASHBOARD_LIMITS.todaysBookings) : null,
    operational ? findUpcomingReturns(db, bookingScope, now, DASHBOARD_LIMITS.upcomingReturns) : null,
    readsIssues ? countOpenIssues(db) : null,
    readsIssues ? findOpenIssues(db, DASHBOARD_LIMITS.openIssues) : null,
    // An own-only editor gets their booking history instead of the store feed.
    readsOwnBookingsOnly
      ? null
      : findRecentActivity(db, { includeAuthEvents: readsAuthEvents, limit: DASHBOARD_LIMITS.recentActivity }),
    readsOwnBookingsOnly && bookingScope ? loadMyBookings(db, bookingScope) : null,
  ])

  return {
    generatedAt: now,
    timeZone,
    kits: kitCounts
      ? {
          available: kitCounts.AVAILABLE,
          reserved: kitCounts.RESERVED,
          checkedOut: kitCounts.CHECKED_OUT,
          maintenance: kitCounts.MAINTENANCE,
          damaged: kitCounts.DAMAGED,
          total:
            kitCounts.AVAILABLE +
            kitCounts.RESERVED +
            kitCounts.CHECKED_OUT +
            kitCounts.MAINTENANCE +
            kitCounts.DAMAGED,
        }
      : null,
    maintenance:
      assetsInMaintenance === null ? null : { assetsInMaintenance, activeRecords },
    overdue: overdueCount === null || overdueRows === null ? null : { count: overdueCount, rows: overdueRows },
    todaysBookings,
    upcomingReturns,
    issues: openIssueCount === null || openIssueRows === null ? null : { count: openIssueCount, rows: openIssueRows },
    recentActivity,
    myBookings,
    quickActions: quickActionsFor(actor),
  }
}

/**
 * The dashboard for the signed-in user. Throws `UnauthorizedError` without a
 * session and `ForbiddenError` without `dashboard.view`; the page translates
 * those through the page guards, route handlers through `withApiAuth`.
 */
export async function loadDashboard(now?: Date): Promise<{ actor: Actor; data: DashboardData }> {
  const actor = await requirePermission('dashboard.view')
  const data = await buildDashboard(prisma, actor, { now, timeZone: env.APP_TIMEZONE })
  return { actor, data }
}
