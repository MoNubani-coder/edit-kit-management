import { randomUUID } from 'node:crypto'

import {
  AssetStatus,
  AuditAction,
  BookingStatus,
  IssueSeverity,
  IssueStatus,
  IssueType,
  KitStatus,
  MaintenanceStatus,
  UserRole,
} from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { UnauthorizedError } from '@/server/auth/errors'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'

/**
 * Dashboard assembly against a real database. Each test runs inside a
 * rolled-back transaction: it measures the dashboard before adding fixtures,
 * adds a known set of kits, bookings, issues, assets and audit rows, and
 * asserts the deltas. Nothing survives the test.
 *
 * `now` is fixed at 21:00 UTC on 3 Sep 2026 - 01:00 on 4 Sep in Dubai - so
 * that "today" differs between UTC and the business time zone.
 */

let currentSession: Session | null = null
vi.mock('@/server/auth/auth', () => ({ auth: vi.fn(async () => currentSession) }))

const { buildDashboard, loadDashboard, DASHBOARD_LIMITS } = await import('@/server/services/dashboard.service')

const DUBAI = 'Asia/Dubai'
const NOW = new Date('2026-09-03T21:00:00.000Z')
const H = 60 * 60 * 1000

function at(iso: string): Date {
  return new Date(iso)
}

interface Fixtures {
  admin: TestUser
  engineer: TestUser
  viewer: TestUser
  editorA: TestUser
  editorB: TestUser
  editorNoProfile: TestUser
  bookingIds: Record<string, string>
}

async function seedFixtures(tx: Db): Promise<Fixtures> {
  const category = await tx.equipmentCategory.findFirstOrThrow({ select: { id: true } })
  const engineerProfile = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })

  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  const viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  const editorA = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true, tag: 'editor-a' })
  const editorB = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true, tag: 'editor-b' })
  const editorNoProfile = await createTestUser(tx, { role: UserRole.EDITOR, tag: 'editor-none' })

  // --- kits: 2 available, 1 reserved, 3 checked out, 1 maintenance, 1 retired, 1 inactive
  const kitSpecs: Array<[string, KitStatus, boolean]> = [
    ['A1', KitStatus.AVAILABLE, true],
    ['A2', KitStatus.AVAILABLE, true],
    ['R1', KitStatus.RESERVED, true],
    ['C1', KitStatus.CHECKED_OUT, true],
    ['C2', KitStatus.CHECKED_OUT, true],
    ['C3', KitStatus.CHECKED_OUT, true],
    ['M1', KitStatus.MAINTENANCE, true],
    ['X1', KitStatus.RETIRED, true],
    ['I1', KitStatus.AVAILABLE, false], // inactive: must not count
  ]
  const kits: Record<string, string> = {}
  for (const [code, status, isActive] of kitSpecs) {
    const kit = await tx.kit.create({
      data: { kitCode: `TEST-${code}-${randomUUID().slice(0, 6)}`, name: `Test kit ${code}`, status, isActive },
      select: { id: true },
    })
    kits[code] = kit.id
  }

  // --- assets: 2 in maintenance, one with an IN_PROGRESS record, one ON_HOLD
  const assetIds: string[] = []
  for (let index = 0; index < 2; index += 1) {
    const asset = await tx.asset.create({
      data: {
        assetCode: `AST-TEST-${randomUUID().slice(0, 8)}`,
        categoryId: category.id,
        name: `Test asset ${index}`,
        status: AssetStatus.MAINTENANCE,
      },
      select: { id: true },
    })
    assetIds.push(asset.id)
  }
  await tx.maintenanceRecord.create({
    data: {
      maintenanceNumber: `MNT-TEST-${randomUUID().slice(0, 8)}`,
      assetId: assetIds[0],
      type: 'REPAIR',
      status: MaintenanceStatus.IN_PROGRESS,
      title: 'Test repair',
      startedAt: NOW,
      createdById: admin.id,
    },
  })
  await tx.maintenanceRecord.create({
    data: {
      maintenanceNumber: `MNT-TEST-${randomUUID().slice(0, 8)}`,
      assetId: assetIds[1],
      type: 'CALIBRATION',
      status: MaintenanceStatus.ON_HOLD,
      title: 'Awaiting probe',
      createdById: admin.id,
    },
  })

  // --- issues: 2 open, 1 under investigation, 1 resolved
  const issueSpecs: IssueStatus[] = [IssueStatus.OPEN, IssueStatus.OPEN, IssueStatus.UNDER_INVESTIGATION, IssueStatus.RESOLVED]
  for (const [index, status] of issueSpecs.entries()) {
    await tx.issue.create({
      data: {
        issueNumber: `ISS-TEST-${randomUUID().slice(0, 8)}`,
        type: IssueType.DAMAGED,
        severity: IssueSeverity.MEDIUM,
        status,
        title: `Test issue ${index}`,
        description: 'fixture',
        assetId: assetIds[index % 2],
        kitId: kits.C1,
        reportedById: engineer.id,
        reportedAt: new Date(NOW.getTime() - index * H),
      },
    })
  }

  // --- bookings
  const bookingIds: Record<string, string> = {}
  async function booking(
    key: string,
    kit: string,
    editorProfileId: string,
    status: BookingStatus,
    start: Date,
    expectedReturn: Date,
    extra: { collectionDate?: Date } = {},
  ) {
    const row = await tx.booking.create({
      data: {
        bookingNumber: `BK-TEST-${randomUUID().slice(0, 12)}`,
        kitId: kits[kit],
        editorId: editorProfileId,
        engineerId: engineerProfile.id,
        status,
        bookingStart: start,
        bookingEnd: expectedReturn,
        expectedReturnDate: expectedReturn,
        collectionDate: extra.collectionDate ?? null,
        createdById: engineer.id,
      },
      select: { id: true },
    })
    bookingIds[key] = row.id
  }

  const a = editorA.editorProfileId!
  const b = editorB.editorProfileId!

  // Overdue by time (checked out, due 2 h ago) - editor A
  await booking('overdueByTime', 'C1', a, BookingStatus.CHECKED_OUT, at('2026-08-30T05:00:00.000Z'), new Date(NOW.getTime() - 2 * H))
  // Flagged OVERDUE by the sweep - editor B
  await booking('overdueFlagged', 'R1', b, BookingStatus.OVERDUE, at('2026-08-28T05:00:00.000Z'), at('2026-09-01T13:00:00.000Z'))
  // Upcoming returns, deliberately created out of order - editor B, then A
  await booking('upcomingLate', 'C3', b, BookingStatus.CHECKED_OUT, at('2026-09-01T05:00:00.000Z'), new Date(NOW.getTime() + 30 * H))
  await booking('upcomingSoon', 'C2', a, BookingStatus.CHECKED_OUT, at('2026-09-02T05:00:00.000Z'), new Date(NOW.getTime() + 5 * H))
  // Today (Dubai 4 Sep): starts 00:30 Dubai = 20:30 UTC 3 Sep - editor A
  await booking('todayEarly', 'A1', a, BookingStatus.RESERVED, at('2026-09-03T20:30:00.000Z'), at('2026-09-06T13:00:00.000Z'))
  // NOT today: 23:30 Dubai on 3 Sep = 19:30 UTC 3 Sep (UTC would call this "today")
  await booking('yesterdayLate', 'A2', b, BookingStatus.RESERVED, at('2026-09-03T19:30:00.000Z'), at('2026-09-05T13:00:00.000Z'))
  // Today but cancelled: excluded
  await booking('todayCancelled', 'M1', b, BookingStatus.CANCELLED, at('2026-09-04T06:00:00.000Z'), at('2026-09-07T13:00:00.000Z'))
  // Tomorrow (5 Sep Dubai): 20:30 UTC on 4 Sep - editor A
  await booking('tomorrow', 'X1', a, BookingStatus.RESERVED, at('2026-09-04T20:30:00.000Z'), at('2026-09-08T13:00:00.000Z'))

  // --- audit rows: 12 operational + 2 authentication. Stamped just ahead of the
  // real clock (not the fixed NOW) so they always outrank whatever genuine audit
  // rows the development database has accumulated; the transaction rolls back.
  const auditBase = Date.now() + 60_000
  for (let index = 0; index < 12; index += 1) {
    await tx.auditLog.create({
      data: {
        action: AuditAction.BOOKING_CREATED,
        entityType: 'Booking',
        entityId: `fixture-${index}`,
        actorName: 'Fixture Engineer',
        summary: `Fixture activity ${index}`,
        createdAt: new Date(auditBase - (index + 1) * 60_000),
        // A payload that must never reach the dashboard.
        newValue: { secret: 'payload' },
        ipAddress: '10.0.0.99',
        userAgent: 'fixture-agent',
      },
    })
  }
  await tx.auditLog.create({
    data: {
      action: AuditAction.LOGIN_SUCCESS,
      entityType: 'User',
      actorName: 'Fixture Admin',
      summary: 'fixture-admin signed in',
      createdAt: new Date(auditBase - 30_000),
    },
  })
  await tx.auditLog.create({
    data: {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      actorName: 'nobody@example.test',
      summary: 'Sign-in failed: unknown account',
      createdAt: new Date(auditBase - 20_000),
    },
  })

  return { admin, engineer, viewer, editorA, editorB, editorNoProfile, bookingIds }
}

afterAll(async () => {
  await testDb.$disconnect()
})

describe('dashboard access', () => {
  it('requires authentication', async () => {
    currentSession = null
    await expect(loadDashboard(NOW)).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('ADMIN dashboard', () => {
  it('aggregates every section with counts that match the database', async () => {
    await withRollback(async (tx) => {
      const probe = await createTestUser(tx, { role: UserRole.ADMIN, tag: 'probe' })
      const before = await buildDashboard(tx, actorFor(probe), { now: NOW, timeZone: DUBAI })
      const fx = await seedFixtures(tx)
      const after = await buildDashboard(tx, actorFor(fx.admin), { now: NOW, timeZone: DUBAI })

      // Kits: stored status, active + not deleted only (inactive and retired handled).
      expect(after.kits!.available - before.kits!.available).toBe(2)
      expect(after.kits!.reserved - before.kits!.reserved).toBe(1)
      expect(after.kits!.checkedOut - before.kits!.checkedOut).toBe(3)
      expect(after.kits!.maintenance - before.kits!.maintenance).toBe(1)
      expect(after.kits!.total - before.kits!.total).toBe(7) // retired excluded from total

      // Maintenance: asset status + active records.
      expect(after.maintenance!.assetsInMaintenance - before.maintenance!.assetsInMaintenance).toBe(2)
      expect(after.maintenance!.activeRecords! - before.maintenance!.activeRecords!).toBe(2)

      // Issues: OPEN + UNDER_INVESTIGATION.
      expect(after.issues!.count - before.issues!.count).toBe(3)
      expect(after.issues!.rows.every((row) => row.status === 'OPEN' || row.status === 'UNDER_INVESTIGATION')).toBe(true)

      // Overdue: one by time, one by flag.
      expect(after.overdue!.count - before.overdue!.count).toBe(2)
      const overdueIds = after.overdue!.rows.map((row) => row.id)
      expect(overdueIds).toEqual(expect.arrayContaining([fx.bookingIds.overdueByTime, fx.bookingIds.overdueFlagged]))
      expect(overdueIds).not.toContain(fx.bookingIds.upcomingSoon)

      // Quick actions for someone who can create bookings and issues.
      expect(after.quickActions.map((action) => action.href)).toEqual(['/bookings', '/kits', '/assets', '/issues'])
      expect(after.myBookings).toBeNull()
    })
  })

  it("computes today's bookings on the Asia/Dubai calendar, not UTC", async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.admin), { now: NOW, timeZone: DUBAI })
      const ids = data.todaysBookings!.map((row) => row.id)

      // 01:00 Dubai on 4 Sep: the 00:30 Dubai collection is today ...
      expect(ids).toContain(fx.bookingIds.todayEarly)
      // ... the 23:30 Dubai (19:30 UTC) booking was yesterday ...
      expect(ids).not.toContain(fx.bookingIds.yesterdayLate)
      // ... tomorrow is tomorrow, and cancelled bookings are noise.
      expect(ids).not.toContain(fx.bookingIds.tomorrow)
      expect(ids).not.toContain(fx.bookingIds.todayCancelled)

      // The same instant evaluated on a UTC calendar would call 19:30 UTC "today".
      const utcView = await buildDashboard(tx, actorFor(fx.admin), { now: NOW, timeZone: 'UTC' })
      expect(utcView.todaysBookings!.map((row) => row.id)).toContain(fx.bookingIds.yesterdayLate)
    })
  })

  it('orders upcoming returns nearest first and excludes overdue ones', async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.admin), { now: NOW, timeZone: DUBAI })
      const upcoming = data.upcomingReturns!

      const soonIndex = upcoming.findIndex((row) => row.id === fx.bookingIds.upcomingSoon)
      const lateIndex = upcoming.findIndex((row) => row.id === fx.bookingIds.upcomingLate)
      expect(soonIndex).toBeGreaterThanOrEqual(0)
      expect(lateIndex).toBeGreaterThan(soonIndex)
      expect(upcoming.map((row) => row.id)).not.toContain(fx.bookingIds.overdueByTime)

      for (let index = 1; index < upcoming.length; index += 1) {
        expect(upcoming[index].expectedReturnDate.getTime()).toBeGreaterThanOrEqual(
          upcoming[index - 1].expectedReturnDate.getTime(),
        )
      }
      expect(upcoming.length).toBeLessThanOrEqual(DASHBOARD_LIMITS.upcomingReturns)
    })
  })

  it('limits recent activity, orders it newest first and includes sign-in events for auditors', async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.admin), { now: NOW, timeZone: DUBAI })
      const activity = data.recentActivity!

      expect(activity).toHaveLength(DASHBOARD_LIMITS.recentActivity)
      for (let index = 1; index < activity.length; index += 1) {
        expect(activity[index].createdAt.getTime()).toBeLessThanOrEqual(activity[index - 1].createdAt.getTime())
      }
      // The two newest rows are the authentication events, visible to admin.audit.read.
      expect(activity[0].action).toBe('LOGIN_FAILED')
      expect(activity[1].action).toBe('LOGIN_SUCCESS')
    })
  })

  it('never exposes sensitive fields', async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.admin), { now: NOW, timeZone: DUBAI })
      const serialised = JSON.stringify(data)

      for (const forbidden of ['passwordHash', 'previousValue', 'newValue', 'metadata', 'ipAddress', 'userAgent', 'secret', '10.0.0.99', 'fixture-agent', 'email']) {
        expect(serialised, forbidden).not.toContain(forbidden)
      }
      const activityKeys = Object.keys(data.recentActivity![0]).sort()
      expect(activityKeys).toEqual(['action', 'actorName', 'createdAt', 'entityId', 'entityType', 'id', 'summary'])
    })
  })
})

describe('ENGINEER dashboard', () => {
  it('has the operational sections but no authentication events in the feed', async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.engineer), { now: NOW, timeZone: DUBAI })

      expect(data.kits).not.toBeNull()
      expect(data.overdue!.count).toBeGreaterThanOrEqual(2)
      expect(data.todaysBookings).not.toBeNull()
      expect(data.upcomingReturns).not.toBeNull()
      expect(data.issues!.count).toBeGreaterThanOrEqual(3)
      expect(data.maintenance!.activeRecords).not.toBeNull()
      expect(data.myBookings).toBeNull()
      expect(data.quickActions.length).toBe(4)

      const actions = data.recentActivity!.map((row) => row.action)
      expect(actions).not.toContain('LOGIN_SUCCESS')
      expect(actions).not.toContain('LOGIN_FAILED')
      expect(actions).not.toContain('LOGOUT')
      expect(actions).toContain('BOOKING_CREATED')
    })
  })
})

describe('VIEWER dashboard', () => {
  it('is read-only: bookings and kits, no issues, no maintenance detail, no shortcuts', async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.viewer), { now: NOW, timeZone: DUBAI })

      expect(data.kits).not.toBeNull()
      expect(data.overdue).not.toBeNull()
      expect(data.todaysBookings).not.toBeNull()
      expect(data.upcomingReturns).not.toBeNull()
      expect(data.maintenance).toEqual({ assetsInMaintenance: expect.any(Number), activeRecords: null })
      expect(data.issues).toBeNull()
      expect(data.myBookings).toBeNull()
      expect(data.quickActions).toEqual([])
      expect(data.recentActivity!.map((row) => row.action)).not.toContain('LOGIN_SUCCESS')
    })
  })
})

describe('EDITOR dashboard', () => {
  it('receives only their own bookings and none of the store-wide sections', async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.editorA), { now: NOW, timeZone: DUBAI })

      expect(data.kits).toBeNull()
      expect(data.overdue).toBeNull()
      expect(data.todaysBookings).toBeNull()
      expect(data.upcomingReturns).toBeNull()
      expect(data.issues).toBeNull()
      expect(data.maintenance).toBeNull()
      expect(data.recentActivity).toBeNull()
      expect(data.quickActions).toEqual([])

      const mine = data.myBookings!
      const ownIds = [
        fx.bookingIds.overdueByTime,
        fx.bookingIds.upcomingSoon,
        fx.bookingIds.todayEarly,
        fx.bookingIds.tomorrow,
      ]
      const otherIds = [
        fx.bookingIds.overdueFlagged,
        fx.bookingIds.upcomingLate,
        fx.bookingIds.yesterdayLate,
        fx.bookingIds.todayCancelled,
      ]
      const historyIds = mine.history.map((row) => row.id)
      expect(historyIds).toEqual(expect.arrayContaining(ownIds))
      for (const id of otherIds) expect(historyIds).not.toContain(id)
      expect(mine.history.every((row) => row.editorName === fx.editorA.name)).toBe(true)

      // The most urgent live booking is the one collected earliest.
      expect(mine.current?.id).toBe(fx.bookingIds.overdueByTime)
    })
  })

  it('handles an editor with no profile or bookings without crashing (empty states)', async () => {
    await withRollback(async (tx) => {
      const fx = await seedFixtures(tx)
      const data = await buildDashboard(tx, actorFor(fx.editorNoProfile), { now: NOW, timeZone: DUBAI })
      expect(data.myBookings).toEqual({ current: null, history: [] })
    })
  })
})

describe('empty database sections', () => {
  it('returns zero counts and empty lists rather than failing when a scope matches nothing', async () => {
    await withRollback(async (tx) => {
      const probe = await createTestUser(tx, { role: UserRole.ADMIN, tag: 'probe' })
      // A far-future "now" makes every booking historical: nothing today, nothing upcoming.
      const farFuture = new Date('2090-01-01T00:00:00.000Z')
      const data = await buildDashboard(tx, actorFor(probe), { now: farFuture, timeZone: DUBAI })
      expect(data.todaysBookings).toEqual([])
      expect(data.upcomingReturns).toEqual([])
      expect(typeof data.overdue!.count).toBe('number')
      expect(Array.isArray(data.recentActivity)).toBe(true)
    })
  })
})
