import { randomUUID } from 'node:crypto'

import { AuditAction, UserRole } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS, AUDIT_DEFAULT_PAGE_SIZE, AUDIT_ENTITY_TYPES, AUDIT_GROUP_ACTIONS, auditLogHref, type AuditListParams, parseAuditListParams } from '@/lib/validation/audit'
import { auditLogSpan, listAuditActors, listAuditLogPage } from '@/server/dal/audit.dal'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, type TestUser, withRollback } from '../helpers/db'

/**
 * The audit log workspace, against the real database inside rolled-back
 * transactions.
 *
 * The log is append-only, so the tests are about reading it: that the filters
 * narrow it server-side, that paging and sorting are the database's work, that
 * an entity id becomes the reference people quote, and - the one that matters
 * most - that the JSON columns a row carries never reach the page.
 *
 * Every test writes its own audit rows inside a transaction that is rolled
 * back, which is the only way to test this table: the trigger that makes it
 * append-only means a test cannot clean up after itself.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const TZ = 'Asia/Dubai'

const params = (overrides: Partial<AuditListParams> = {}): AuditListParams => ({
  group: 'all',
  sort: 'createdAt',
  dir: 'desc',
  page: 1,
  pageSize: AUDIT_DEFAULT_PAGE_SIZE,
  ...overrides,
})

interface Written {
  actor: TestUser
  other: TestUser
  bookingId: string
  bookingNumber: string
  assetId: string
  assetCode: string
  marker: string
}

/**
 * A handful of entries by two actors, about a booking and an asset, carrying
 * the JSON a real call site would write. `marker` makes them findable among
 * whatever the development database already holds.
 */
async function write(tx: Db): Promise<Written> {
  const marker = `AUDIT-${tag()}`
  const actor = await createTestUser(tx, { role: UserRole.ADMIN, tag: 'aud-a' })
  const other = await createTestUser(tx, { role: UserRole.ENGINEER, tag: 'aud-b' })

  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } })
  const engineer = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
  const kit = await tx.kit.create({ data: { kitCode: `AUD-${tag()}`, name: `Audit kit ${marker}` }, select: { id: true } })
  const editor = await tx.editorProfile.create({ data: { fullName: `Audit editor ${marker}`, isExternal: true }, select: { id: true } })
  const asset = await tx.asset.create({
    data: { assetCode: `AUD-${tag()}`, categoryId: category.id, name: `Audit asset ${marker}` },
    select: { id: true, assetCode: true },
  })
  const booking = await tx.booking.create({
    data: {
      bookingNumber: `AUD-BK-${tag()}`,
      kitId: kit.id,
      editorId: editor.id,
      engineerId: engineer.id,
      bookingStart: new Date('2044-05-01T06:00:00.000Z'),
      bookingEnd: new Date('2044-05-04T06:00:00.000Z'),
      expectedReturnDate: new Date('2044-05-04T06:00:00.000Z'),
      createdById: actor.id,
    },
    select: { id: true, bookingNumber: true },
  })

  const base = { actorName: actor.name, actorRole: actor.role, actorUserId: actor.id }

  await tx.auditLog.createMany({
    data: [
      {
        ...base,
        action: AuditAction.LOGIN_SUCCESS,
        entityType: 'User',
        entityId: actor.id,
        summary: `${marker} signed in`,
        createdAt: new Date('2044-05-01T04:00:00.000Z'),
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      },
      {
        ...base,
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        entityId: actor.id,
        summary: `${marker} sign-in refused`,
        createdAt: new Date('2044-05-01T04:05:00.000Z'),
        ipAddress: '203.0.113.9',
      },
      {
        ...base,
        action: AuditAction.BOOKING_CREATED,
        entityType: 'Booking',
        entityId: booking.id,
        summary: `${marker} created ${booking.bookingNumber}`,
        createdAt: new Date('2044-05-02T06:00:00.000Z'),
        // What a real call site writes, and what must never reach the page.
        previousValue: { secret: 'before' },
        newValue: { secret: 'after', passwordHash: '$2b$12$notarealhash' },
        metadata: { detail: 'reserved on the kit', sessionToken: 'tok_should_never_render' },
      },
      {
        ...base,
        action: AuditAction.ASSET_STATUS_CHANGED,
        entityType: 'Asset',
        entityId: asset.id,
        summary: `${marker} moved ${asset.assetCode} to DAMAGED`,
        createdAt: new Date('2044-05-03T06:00:00.000Z'),
      },
      {
        actorName: other.name,
        actorRole: other.role,
        actorUserId: other.id,
        action: AuditAction.KIT_STATUS_CHANGED,
        entityType: 'Kit',
        entityId: kit.id,
        summary: `${marker} set the kit to MAINTENANCE`,
        createdAt: new Date('2044-05-04T06:00:00.000Z'),
      },
      {
        actorName: 'System',
        actorRole: null,
        actorUserId: null,
        action: AuditAction.EXPORT_GENERATED,
        entityType: 'Booking',
        entityId: null,
        summary: `${marker} nightly export`,
        createdAt: new Date('2044-05-05T06:00:00.000Z'),
      },
    ],
  })

  return { actor, other, bookingId: booking.id, bookingNumber: booking.bookingNumber, assetId: asset.id, assetCode: asset.assetCode, marker }
}

/** Only the rows this test wrote. */
const mine = (rows: readonly { summary: string | null }[], marker: string) => rows.filter((row) => row.summary?.includes(marker))

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

describe('the audit log list', () => {
  it('returns the newest entry first, with the actor, the action and the summary', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker }), TZ)

      expect(page.total).toBe(6)
      expect(page.rows).toHaveLength(6)
      expect(page.rows[0].summary).toContain('nightly export')
      expect(page.rows[0].action).toBe(AuditAction.EXPORT_GENERATED)
      expect(page.rows.at(-1)?.action).toBe(AuditAction.LOGIN_SUCCESS)
      expect(page.rows.at(-1)?.actorName).toBe(written.actor.name)
      expect(page.rows.at(-1)?.actorRole).toBe(UserRole.ADMIN)
    })
  })

  it('never returns the before-and-after JSON a row carries', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker }), TZ)

      for (const row of page.rows) {
        expect(row).not.toHaveProperty('previousValue')
        expect(row).not.toHaveProperty('newValue')
        expect(row).not.toHaveProperty('metadata')
      }

      // Belt and braces: nothing anywhere in what the page receives.
      const serialised = JSON.stringify(page)
      expect(serialised).not.toContain('passwordHash')
      expect(serialised).not.toContain('notarealhash')
      expect(serialised).not.toContain('tok_should_never_render')
      expect(serialised).not.toContain('secret')
    })
  })

  it('resolves a booking id into the number people quote, and links to it', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker, entityType: 'Booking' }), TZ)
      const created = page.rows.find((row) => row.action === AuditAction.BOOKING_CREATED)

      expect(created?.reference).toBe(written.bookingNumber)
      expect(created?.href).toBe(`/bookings/${written.bookingId}`)
    })
  })

  it('resolves an asset and a kit, and leaves an account without a page unlinked', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker }), TZ)

      const asset = page.rows.find((row) => row.entityType === 'Asset')
      expect(asset?.reference).toContain(written.assetCode)
      expect(asset?.href).toBe(`/assets/${written.assetId}`)

      const kit = page.rows.find((row) => row.entityType === 'Kit')
      expect(kit?.reference).toContain('Audit kit')
      expect(kit?.href).toMatch(/^\/kits\//)

      const account = page.rows.find((row) => row.entityType === 'User')
      expect(account?.reference).toContain(written.actor.name)
      expect(account?.href).toBeNull()
    })
  })

  it('leaves a row with no entity id without a reference rather than inventing one', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker }), TZ)
      const exported = page.rows.find((row) => row.action === AuditAction.EXPORT_GENERATED)

      expect(exported?.entityId).toBeNull()
      expect(exported?.reference).toBeNull()
      expect(exported?.href).toBeNull()
    })
  })

  it('resolves nothing for an entity that has since been deleted, and still returns the row', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      await tx.auditLog.create({
        data: { action: AuditAction.DELETE, entityType: 'Asset', entityId: 'no-such-asset-id', actorName: written.actor.name, actorUserId: written.actor.id, summary: `${written.marker} removed something gone` },
      })
      const page = await listAuditLogPage(tx, params({ q: written.marker }), TZ)
      const removed = page.rows.find((row) => row.action === AuditAction.DELETE)

      expect(removed).toBeDefined()
      expect(removed?.reference).toBeNull()
      expect(removed?.href).toBeNull()
    })
  })

  it('keeps the actor name recorded at the time, not the account as it is now', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      await tx.user.update({ where: { id: written.actor.id }, data: { name: 'Renamed Afterwards' } })

      const page = await listAuditLogPage(tx, params({ q: written.marker }), TZ)
      const signIn = page.rows.find((row) => row.action === AuditAction.LOGIN_SUCCESS)
      expect(signIn?.actorName).toBe(written.actor.name)
      expect(signIn?.actorName).not.toBe('Renamed Afterwards')
    })
  })
})

// -----------------------------------------------------------------------------
// Filtering, sorting, paging - all server-side
// -----------------------------------------------------------------------------

describe('filters', () => {
  it('filters by a single action', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker, action: 'LOGIN_FAILED' }), TZ)

      expect(page.total).toBe(1)
      expect(page.rows[0].action).toBe(AuditAction.LOGIN_FAILED)
      expect(page.rows[0].ipAddress).toBe('203.0.113.9')
    })
  })

  it('filters by area, which is a group of actions', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const auth = await listAuditLogPage(tx, params({ q: written.marker, group: 'auth' }), TZ)
      expect(auth.rows.map((row) => row.action).sort()).toEqual([AuditAction.LOGIN_FAILED, AuditAction.LOGIN_SUCCESS])

      const equipment = await listAuditLogPage(tx, params({ q: written.marker, group: 'equipment' }), TZ)
      expect(equipment.rows.map((row) => row.action).sort()).toEqual([AuditAction.ASSET_STATUS_CHANGED, AuditAction.KIT_STATUS_CHANGED])
    })
  })

  it('lets an explicit action win over the area it does not belong to', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker, group: 'auth', action: 'BOOKING_CREATED' }), TZ)
      expect(page.rows.map((row) => row.action)).toEqual([AuditAction.BOOKING_CREATED])
    })
  })

  it('filters by actor, including only that actor', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker, actorId: written.other.id }), TZ)

      expect(page.total).toBe(1)
      expect(page.rows[0].actorName).toBe(written.other.name)
      expect(page.rows[0].action).toBe(AuditAction.KIT_STATUS_CHANGED)
    })
  })

  it('filters by what the entry is about', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker, entityType: 'User' }), TZ)
      expect(page.total).toBe(2)
      expect(page.rows.every((row) => row.entityType === 'User')).toBe(true)
    })
  })

  it('reads a date range in the business time zone, with the end day included', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)

      // 2 May in Dubai starts at 20:00 UTC on 1 May, so the two sign-ins on
      // 1 May at 04:00 UTC fall outside it.
      const fromSecond = await listAuditLogPage(tx, params({ q: written.marker, from: '2044-05-02' }), TZ)
      expect(fromSecond.total).toBe(4)

      const justTheThird = await listAuditLogPage(tx, params({ q: written.marker, from: '2044-05-03', to: '2044-05-03' }), TZ)
      expect(justTheThird.rows.map((row) => row.action)).toEqual([AuditAction.ASSET_STATUS_CHANGED])

      const upToTheSecond = await listAuditLogPage(tx, params({ q: written.marker, to: '2044-05-02' }), TZ)
      expect(upToTheSecond.rows.map((row) => row.action)).toContain(AuditAction.BOOKING_CREATED)
      expect(upToTheSecond.rows.map((row) => row.action)).not.toContain(AuditAction.KIT_STATUS_CHANGED)
    })
  })

  it('searches the summary, the actor and the entity id', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)

      const bySummary = await listAuditLogPage(tx, params({ q: 'nightly export' }), TZ)
      expect(mine(bySummary.rows, written.marker)).toHaveLength(1)

      const byActor = await listAuditLogPage(tx, params({ q: written.other.name }), TZ)
      expect(mine(byActor.rows, written.marker)).toHaveLength(1)

      const byId = await listAuditLogPage(tx, params({ q: written.bookingId }), TZ)
      expect(mine(byId.rows, written.marker)).toHaveLength(1)
    })
  })

  it('searches case-insensitively', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: 'NIGHTLY EXPORT' }), TZ)
      expect(mine(page.rows, written.marker)).toHaveLength(1)
    })
  })

  it('combines a filter with a search rather than replacing it', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker, group: 'auth', actorId: written.other.id }), TZ)
      expect(page.total).toBe(0)
      expect(page.rows).toEqual([])
    })
  })
})

describe('sorting and paging', () => {
  it('sorts oldest first when asked', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const page = await listAuditLogPage(tx, params({ q: written.marker, dir: 'asc' }), TZ)
      expect(page.rows[0].action).toBe(AuditAction.LOGIN_SUCCESS)
      expect(page.rows.at(-1)?.action).toBe(AuditAction.EXPORT_GENERATED)
    })
  })

  it('sorts by action, by what it is about, and by who did it', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)

      // PostgreSQL orders an enum column by its declaration order, not
      // alphabetically, which groups related actions together - the sign-ins
      // next to each other rather than scattered through the alphabet.
      const byAction = await listAuditLogPage(tx, params({ q: written.marker, sort: 'action', dir: 'asc' }), TZ)
      const positions = byAction.rows.map((row) => AUDIT_ACTIONS.indexOf(row.action as (typeof AUDIT_ACTIONS)[number]))
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      expect(positions.every((position) => position >= 0)).toBe(true)

      const byEntity = await listAuditLogPage(tx, params({ q: written.marker, sort: 'entityType', dir: 'asc' }), TZ)
      const entities = byEntity.rows.map((row) => row.entityType)
      expect(entities).toEqual([...entities].sort())

      const byActor = await listAuditLogPage(tx, params({ q: written.marker, sort: 'actorName', dir: 'asc' }), TZ)
      const names = byActor.rows.map((row) => row.actorName)
      expect(names).toEqual([...names].sort())
    })
  })

  it('pages server-side and reports the count of everything that matched', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)

      const first = await listAuditLogPage(tx, params({ q: written.marker, pageSize: 10, page: 1 }), TZ)
      expect(first.total).toBe(6)
      expect(first.rows).toHaveLength(6)
      expect(first.pageCount).toBe(1)

      // The floor is 10, so a smaller page size is not honoured; page two of a
      // six-row result is therefore empty, and says so honestly.
      const second = await listAuditLogPage(tx, params({ q: written.marker, pageSize: 10, page: 2 }), TZ)
      expect(second.total).toBe(6)
      expect(second.rows).toEqual([])
      expect(second.page).toBe(2)
    })
  })
})

describe('filter options', () => {
  it('offers the actors who appear in the log, by name', async () => {
    await withRollback(async (tx) => {
      const written = await write(tx)
      const actors = await listAuditActors(tx)
      const ids = actors.map((actor) => actor.id)

      expect(ids).toContain(written.actor.id)
      expect(ids).toContain(written.other.id)
      // A system entry has no actor to offer.
      expect(actors.every((actor) => actor.id.length > 0)).toBe(true)
      expect(actors.map((actor) => actor.name)).toEqual([...actors.map((actor) => actor.name)].sort((a, b) => a.localeCompare(b)))
    })
  })

  it('reports how much the log holds and when it starts', async () => {
    await withRollback(async (tx) => {
      const before = await auditLogSpan(tx)
      await write(tx)
      const after = await auditLogSpan(tx)

      expect(after.total).toBe(before.total + 6)
      expect(after.latest).not.toBeNull()
      expect(after.earliest).not.toBeNull()
    })
  })
})

// -----------------------------------------------------------------------------
// The words, the URL and the permission
// -----------------------------------------------------------------------------

describe('labels and parameters', () => {
  it('has a label for every action the schema declares', () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(Object.values(AuditAction).sort())
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy()
      expect(AUDIT_ACTION_LABELS[action]).not.toMatch(/_/)
    }
  })

  it('puts every action in at most one area, and only real actions in areas', () => {
    const seen = new Set<string>()
    for (const actions of Object.values(AUDIT_GROUP_ACTIONS)) {
      for (const action of actions) {
        expect(AUDIT_ACTIONS).toContain(action)
        expect(seen.has(action)).toBe(false)
        seen.add(action)
      }
    }
  })

  it('drops a filter the log does not offer instead of half-applying it', () => {
    const parsed = parseAuditListParams({ action: 'NOT_AN_ACTION', entityType: 'Nonsense', group: 'invented', sort: 'password', dir: 'sideways', page: '-4', pageSize: '9999' })
    expect(parsed.action).toBeUndefined()
    expect(parsed.entityType).toBeUndefined()
    expect(parsed.group).toBe('all')
    expect(parsed.sort).toBe('createdAt')
    expect(parsed.dir).toBe('desc')
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(AUDIT_DEFAULT_PAGE_SIZE)
  })

  it('keeps a malformed date out of the query', () => {
    expect(parseAuditListParams({ from: 'last Tuesday', to: '2044-13-99x' }).from).toBeUndefined()
    expect(parseAuditListParams({ from: '2044-05-01' }).from).toBe('2044-05-01')
  })

  it('accepts every entity type the application writes about', () => {
    for (const entityType of AUDIT_ENTITY_TYPES) {
      expect(parseAuditListParams({ entityType }).entityType).toBe(entityType)
    }
  })

  it('turns the parameters back into a URL, and leaves the defaults out of it', () => {
    expect(auditLogHref(params())).toBe('/admin/audit-logs')
    expect(auditLogHref(params(), { page: 3 })).toBe('/admin/audit-logs?page=3')
    expect(auditLogHref(params({ q: 'signed in', action: 'LOGIN_FAILED', from: '2044-05-01' }))).toBe('/admin/audit-logs?q=signed+in&action=LOGIN_FAILED&from=2044-05-01')
    expect(auditLogHref(params({ sort: 'actorName', dir: 'asc' }))).toBe('/admin/audit-logs?sort=actorName&dir=asc')
  })

  it('round-trips a URL back into the same parameters', () => {
    const original = params({ q: 'kit', group: 'equipment', entityType: 'Kit', from: '2044-05-01', to: '2044-05-09', sort: 'actorName', dir: 'asc', page: 2, pageSize: 100 })
    const query = Object.fromEntries(new URL(`http://x${auditLogHref(original)}`).searchParams)
    expect(parseAuditListParams(query)).toEqual(original)
  })
})

describe('who may read the log', () => {
  it('is administration only, and refuses everybody else', async () => {
    const { can } = await import('@/server/auth/permissions')
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: 'aud-p1' }))
      const engineer = actorFor(await createTestUser(tx, { role: UserRole.ENGINEER, tag: 'aud-p2' }))
      const viewer = actorFor(await createTestUser(tx, { role: UserRole.VIEWER, tag: 'aud-p3' }))
      const editor = actorFor(await createTestUser(tx, { role: UserRole.EDITOR, tag: 'aud-p4' }))

      expect(can(admin, 'admin.audit.read')).toBe(true)
      expect(can(engineer, 'admin.audit.read')).toBe(false)
      expect(can(viewer, 'admin.audit.read')).toBe(false)
      expect(can(editor, 'admin.audit.read')).toBe(false)
    })
  })

  it('the page loader refuses a caller without the permission', async () => {
    vi.resetModules()
    let session: { expires: string; user: { id: string; name: string; email: string; role: UserRole } } | null = null
    vi.doMock('@/server/auth/auth', () => ({ auth: vi.fn(async () => session) }))

    const { loadAuditLogPage } = await import('@/server/services/audit-logs.service')
    const { ForbiddenError, UnauthorizedError } = await import('@/server/auth/errors')

    // Anonymous.
    await expect(loadAuditLogPage(params())).rejects.toBeInstanceOf(UnauthorizedError)

    // Signed in, wrong role. The engineer exists in the seeded database.
    const { testDb } = await import('../helpers/db')
    const engineer = await testDb.user.findFirstOrThrow({ where: { role: UserRole.ENGINEER, deletedAt: null }, select: { id: true, name: true, email: true } })
    session = { expires: new Date(Date.now() + 60_000).toISOString(), user: { ...engineer, role: UserRole.ENGINEER } }
    await expect(loadAuditLogPage(params())).rejects.toBeInstanceOf(ForbiddenError)

    vi.doUnmock('@/server/auth/auth')
    vi.resetModules()
  })
})
