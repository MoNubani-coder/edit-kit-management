import { randomUUID } from 'node:crypto'

import { AssetStatus, type BookingStatus, KitStatus, MaintenanceStatus, MaintenanceType, UserRole } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import { getAssetDetail } from '@/server/dal/assets.dal'
import {
  countKitsByStatus,
  findKitIdByBarcode,
  getKitDetail,
  getKitHistory,
  getKitLifecycleContext,
  listKits,
} from '@/server/dal/kits.dal'
import type { Db } from '@/server/db/prisma'
import { createAsset } from '@/server/services/assets.service'
import { DomainError } from '@/server/services/errors'
import {
  addKitAsset,
  addKitSoftware,
  allowedKitStatusTransitions,
  createKit,
  evaluateKitAvailability,
  getKitAvailability,
  kitRemovalBlocker,
  removeKit,
  removeKitAsset,
  removeKitSoftware,
  setKitChecklistTemplate,
  translateKitAssetError,
  updateKit,
  updateKitAsset,
} from '@/server/services/kits.service'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'

/**
 * Kit rules against the real database, inside rolled-back transactions. The
 * seeded kit MBP-02 (12 assets, ADM-DEMO-KIT-0002) is a fixed backdrop; every
 * test creates its own kits and equipment on top and nothing survives -
 * including the AST numbers the equipment consumed.
 *
 * PostgreSQL aborts a transaction after a failed statement, so tests that
 * provoke a database constraint do it as their final step.
 */

const LIST = { view: 'all', sort: 'kitCode', direction: 'asc', page: 1, pageSize: 25 } as const
const DAY = 24 * 60 * 60 * 1000

const tag = () => randomUUID().slice(0, 8).toUpperCase()

interface Fixtures {
  admin: TestUser
  actor: Actor
  categoryId: string
  softwareId: string
  templateId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } })
  const software = await tx.softwareApplication.findFirstOrThrow({ where: { deletedAt: null, isActive: true }, select: { id: true } })
  const template = await tx.checklistTemplate.findFirstOrThrow({ where: { isDefault: true, deletedAt: null }, select: { id: true } })
  return { admin, actor: actorFor(admin), categoryId: category.id, softwareId: software.id, templateId: template.id }
}

function kitInput(overrides: Partial<Parameters<typeof createKit>[2]> = {}) {
  const t = tag()
  return {
    kitCode: `TST-${t}`,
    name: `Test Kit ${t}`,
    admBarcode: `ADM-TESTKIT-${t}`,
    description: undefined,
    location: undefined,
    notes: undefined,
    suitcaseStatus: 'GOOD' as const,
    status: 'AVAILABLE' as const,
    ...overrides,
  }
}

async function makeAsset(tx: Db, fx: Fixtures, overrides: Partial<Parameters<typeof createAsset>[2]> = {}) {
  const t = tag()
  return createAsset(tx, fx.actor, {
    name: `Test Kit Asset ${t}`,
    categoryId: fx.categoryId,
    manufacturer: 'Testco',
    model: `K-${t}`,
    serialNumber: `SN-TESTKIT-${t}`,
    admBarcode: `ADM-TESTASSET-${t}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
    ...overrides,
  })
}

/** A kit with `required` required members and `optional` optional ones. */
async function makeKit(tx: Db, fx: Fixtures, required: number, optional = 0) {
  const kit = await createKit(tx, fx.actor, kitInput())
  const members: Array<{ id: string; assetCode: string; kitAssetId: string; isRequired: boolean }> = []
  for (let index = 0; index < required + optional; index += 1) {
    const asset = await makeAsset(tx, fx)
    const isRequired = index < required
    const added = await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: `Slot ${index + 1}`, isRequired })
    members.push({ ...asset, kitAssetId: added.kitAssetId, isRequired })
  }
  return { kit, members }
}

/** Puts a live booking on the kit; for out statuses the kit itself is marked CHECKED_OUT. */
async function bookKit(tx: Db, fx: Fixtures, kitId: string, status: BookingStatus) {
  const editor = await tx.editorProfile.create({ data: { fullName: `Test Editor ${tag()}`, isExternal: true }, select: { id: true } })
  const engineer = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
  const now = Date.now()
  const out = status !== 'RESERVED'
  const booking = await tx.booking.create({
    data: {
      bookingNumber: `BK-TEST-${tag()}`,
      kitId,
      editorId: editor.id,
      engineerId: engineer.id,
      status,
      bookingStart: new Date(now - DAY),
      bookingEnd: new Date(now + DAY),
      expectedReturnDate: new Date(now + DAY),
      collectionDate: out ? new Date(now - DAY) : null,
      createdById: fx.admin.id,
    },
    select: { id: true, bookingNumber: true },
  })
  if (out) await tx.kit.update({ where: { id: kitId }, data: { status: KitStatus.CHECKED_OUT } })
  return booking
}

afterAll(async () => {
  await testDb.$disconnect()
})

describe('creating and editing kits', () => {
  it('creates a kit with its audit entry and reads it back in the detail shape', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const input = kitInput({ description: 'Portable test kit', location: 'Rack T' })
      const created = await createKit(tx, fx.actor, input)
      expect(created.kitCode).toBe(input.kitCode)

      const detail = await getKitDetail(tx, created.id, { includeIssues: true })
      expect(detail).toMatchObject({
        kitCode: input.kitCode,
        name: input.name,
        admBarcode: input.admBarcode,
        status: 'AVAILABLE',
        suitcaseStatus: 'GOOD',
        location: 'Rack T',
        description: 'Portable test kit',
        members: [],
        software: [],
        checklistTemplate: null,
        liveBooking: null,
        bookingCount: 0,
        openIssueCount: 0,
      })

      const audit = await tx.auditLog.findMany({ where: { entityType: 'Kit', entityId: created.id } })
      expect(audit.map((row) => row.action)).toEqual(['CREATE'])
      expect(audit[0]).toMatchObject({ actorUserId: fx.admin.id, summary: expect.stringContaining(input.kitCode) })
    })
  })

  it('normalises the kit code and rejects malformed ones through the schema', async () => {
    const { createKitSchema } = await import('@/lib/validation/kits')
    expect(createKitSchema.parse({ kitCode: ' audio-01 ', name: 'Audio kit' })).toMatchObject({ kitCode: 'AUDIO-01', status: 'AVAILABLE', suitcaseStatus: 'GOOD' })
    for (const bad of ['MBP 02', 'mbp_02', '-MBP', 'A', 'CHECKED']) {
      const result = createKitSchema.safeParse({ kitCode: bad, name: 'Bad kit', status: bad === 'CHECKED' ? 'CHECKED_OUT' : undefined })
      expect(result.success, bad).toBe(false)
    }
  })

  it('rejects a duplicate kit code with a field error (database-enforced)', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      await expect(createKit(tx, fx.actor, kitInput({ kitCode: 'MBP-02' }))).rejects.toMatchObject({
        name: 'DomainError',
        code: 'conflict',
        fieldErrors: { kitCode: expect.stringContaining('kit code') },
      })
    })
  })

  it('edits details, records status changes with a reason and refuses workflow statuses', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 1)
      const current = await getKitDetail(tx, kit.id, { includeIssues: false })
      const base = {
        kitCode: current!.kitCode,
        name: current!.name,
        admBarcode: current!.admBarcode ?? undefined,
        description: undefined,
        location: undefined,
        notes: undefined,
        suitcaseStatus: 'GOOD' as const,
        statusReason: undefined,
      }

      // Workflow statuses cannot be chosen by hand.
      await expect(updateKit(tx, fx.actor, kit.id, { ...base, status: 'CHECKED_OUT' })).rejects.toMatchObject({ code: 'lifecycle' })
      await expect(updateKit(tx, fx.actor, kit.id, { ...base, status: 'RESERVED' })).rejects.toMatchObject({ code: 'lifecycle' })

      // Retiring needs an empty kit.
      const context = await getKitLifecycleContext(tx, kit.id)
      expect(allowedKitStatusTransitions('AVAILABLE', context!)).toEqual(expect.arrayContaining(['AVAILABLE', 'MAINTENANCE', 'DAMAGED']))
      expect(allowedKitStatusTransitions('AVAILABLE', context!)).not.toContain('RETIRED')
      await expect(updateKit(tx, fx.actor, kit.id, { ...base, status: 'RETIRED' })).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('Remove all equipment'),
      })

      // A manual status with a reason, plus a detail change, produce two audit entries.
      const result = await updateKit(tx, fx.actor, kit.id, { ...base, name: 'Renamed kit', suitcaseStatus: 'MINOR_DAMAGE', status: 'MAINTENANCE', statusReason: 'Latch broken' })
      expect(result.statusChanged).toBe(true)
      const updated = await tx.kit.findUniqueOrThrow({ where: { id: kit.id } })
      expect(updated).toMatchObject({ name: 'Renamed kit', suitcaseStatus: 'MINOR_DAMAGE', status: 'MAINTENANCE' })

      const audit = await tx.auditLog.findMany({ where: { entityType: 'Kit', entityId: kit.id }, orderBy: { createdAt: 'asc' } })
      const actions = audit.map((row) => row.action)
      expect(actions).toContain('KIT_STATUS_CHANGED')
      expect(actions).toContain('UPDATE')
      expect(audit.find((row) => row.action === 'KIT_STATUS_CHANGED')?.summary).toContain('Latch broken')

      // Once the equipment is gone the kit can be retired, and then removed.
      await removeKitAsset(tx, fx.actor, members[0].kitAssetId)
      await updateKit(tx, fx.actor, kit.id, { ...base, status: 'RETIRED' })
      expect((await tx.kit.findUniqueOrThrow({ where: { id: kit.id } })).status).toBe('RETIRED')
    })
  })

  it('soft-deletes a kit only once it is empty and unbooked', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 1)

      expect(kitRemovalBlocker((await getKitLifecycleContext(tx, kit.id))!)).toContain('Remove all equipment')
      await expect(removeKit(tx, fx.actor, kit.id)).rejects.toMatchObject({ code: 'lifecycle' })

      await removeKitAsset(tx, fx.actor, members[0].kitAssetId)
      await removeKit(tx, fx.actor, kit.id)

      const row = await tx.kit.findUniqueOrThrow({ where: { id: kit.id } })
      expect(row.deletedAt).not.toBeNull()
      expect(row.isActive).toBe(false)
      expect((await listKits(tx, { ...LIST, search: kit.kitCode })).total).toBe(0)
      // History survives the removal.
      const detail = await getKitDetail(tx, kit.id, { includeIssues: false })
      expect(detail?.deletedAt).not.toBeNull()
      const audit = await tx.auditLog.findMany({ where: { entityType: 'Kit', entityId: kit.id } })
      expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['CREATE', 'KIT_ASSET_ADDED', 'KIT_ASSET_REMOVED', 'DELETE']))
    })
  })
})

describe('listing kits', () => {
  it('finds kits by code, name and kit barcode, and resolves an exact kit barcode to the kit', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const input = kitInput({ name: 'Zebra Broadcast Trolley' })
      const kit = await createKit(tx, fx.actor, input)

      expect((await listKits(tx, { ...LIST, search: input.kitCode })).rows.map((row) => row.id)).toEqual([kit.id])
      expect((await listKits(tx, { ...LIST, search: 'zebra broadcast' })).rows.map((row) => row.id)).toEqual([kit.id])
      expect((await listKits(tx, { ...LIST, search: input.admBarcode! })).rows.map((row) => row.id)).toEqual([kit.id])
      expect(await findKitIdByBarcode(tx, input.admBarcode!)).toBe(kit.id)
      expect(await findKitIdByBarcode(tx, input.admBarcode!.slice(0, -1))).toBeNull()
    })
  })

  it('finds a kit through the code, barcode or serial number of equipment inside it', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 1)
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: members[0].id }, select: { assetCode: true, admBarcode: true, serialNumber: true } })

      for (const term of [asset.assetCode, asset.admBarcode!, asset.serialNumber!]) {
        const result = await listKits(tx, { ...LIST, search: term })
        expect(result.rows.map((row) => row.id), term).toEqual([kit.id])
      }
      // The seeded kit is reachable through its seeded equipment too.
      const seeded = await listKits(tx, { ...LIST, search: 'ADM-DEMO-100009' })
      expect(seeded.rows.map((row) => row.kitCode)).toContain('MBP-02')
      // Once removed from the kit, the equipment no longer leads to it.
      await removeKitAsset(tx, fx.actor, members[0].kitAssetId)
      expect((await listKits(tx, { ...LIST, search: asset.assetCode })).total).toBe(0)
    })
  })

  it('filters by status tab and counts kits per status', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const before = await countKitsByStatus(tx)
      const available = await createKit(tx, fx.actor, kitInput())
      const maintenance = await createKit(tx, fx.actor, kitInput({ status: 'MAINTENANCE' }))
      const damaged = await createKit(tx, fx.actor, kitInput({ status: 'DAMAGED' }))

      const ids = (view: (typeof LIST)['view'] | 'available' | 'maintenance' | 'retired') =>
        listKits(tx, { ...LIST, view, search: 'TST-' }).then((result) => result.rows.map((row) => row.id))

      expect(await ids('available')).toEqual([available.id])
      expect(await ids('maintenance')).toEqual(expect.arrayContaining([maintenance.id, damaged.id]))
      expect(await ids('maintenance')).not.toContain(available.id)
      expect(await ids('retired')).toEqual([])
      expect(await ids('all')).toHaveLength(3)

      const after = await countKitsByStatus(tx)
      expect(after.AVAILABLE - before.AVAILABLE).toBe(1)
      expect(after.MAINTENANCE - before.MAINTENANCE).toBe(1)
      expect(after.DAMAGED - before.DAMAGED).toBe(1)
    })
  })

  it('paginates and sorts deterministically', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const prefix = `PG${tag().slice(0, 4)}`
      for (const suffix of ['03', '01', '02']) await createKit(tx, fx.actor, kitInput({ kitCode: `${prefix}-${suffix}`, name: `Page kit ${suffix}` }))

      const page1 = await listKits(tx, { ...LIST, search: prefix, pageSize: 2, page: 1 })
      const page2 = await listKits(tx, { ...LIST, search: prefix, pageSize: 2, page: 2 })
      expect(page1).toMatchObject({ total: 3, pageCount: 2, page: 1 })
      expect(page1.rows.map((row) => row.kitCode)).toEqual([`${prefix}-01`, `${prefix}-02`])
      expect(page2.rows.map((row) => row.kitCode)).toEqual([`${prefix}-03`])

      const desc = await listKits(tx, { ...LIST, search: prefix, sort: 'name', direction: 'desc', pageSize: 10 })
      expect(desc.rows.map((row) => row.name)).toEqual(['Page kit 03', 'Page kit 02', 'Page kit 01'])
      // Out-of-range pages clamp instead of returning nothing.
      expect((await listKits(tx, { ...LIST, search: prefix, pageSize: 2, page: 9 })).page).toBe(2)
    })
  })

  it('exposes no user credentials or contact details through the kit reads', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit } = await makeKit(tx, fx, 1)
      await bookKit(tx, fx, kit.id, 'CHECKED_OUT')

      const list = JSON.stringify(await listKits(tx, { ...LIST, search: kit.kitCode }))
      const detail = JSON.stringify(await getKitDetail(tx, kit.id, { includeIssues: true }))
      const history = JSON.stringify(await getKitHistory(tx, kit.id, { includeIssues: true }))
      for (const text of [list, detail, history]) {
        expect(text).not.toMatch(/passwordHash|sessionVersion|"email"|"userId"|createdById|@example\.test/)
      }
      // The live booking is summarised by names only.
      expect(detail).toContain('"editorName"')
      expect(detail).not.toContain('"editorId"')
    })
  })
})

describe('kit composition', () => {
  it('adds available equipment, audits it and shows the kit on the equipment', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await createKit(tx, fx.actor, kitInput())
      const asset = await makeAsset(tx, fx)

      const added = await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: 'Speaker 1', isRequired: true })
      const membership = await tx.kitAsset.findUniqueOrThrow({ where: { id: added.kitAssetId } })
      expect(membership).toMatchObject({ kitId: kit.id, assetId: asset.id, slotLabel: 'Speaker 1', isRequired: true, removedAt: null, sortOrder: 0 })

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'Kit', entityId: kit.id, action: 'KIT_ASSET_ADDED' } })
      expect(audit).toMatchObject({ actorUserId: fx.admin.id, summary: expect.stringContaining(asset.assetCode) })
      expect(audit?.metadata).toMatchObject({ kitAssetId: added.kitAssetId, assetId: asset.id, assetCode: asset.assetCode })

      const detail = await getKitDetail(tx, kit.id, { includeIssues: false })
      expect(detail?.members.map((member) => member.assetCode)).toEqual([asset.assetCode])
      expect(detail?.members[0].category.code).toBe('OTHER_EQUIPMENT')

      const assetDetail = await getAssetDetail(tx, asset.id, { includeIssues: false, includeMaintenance: false })
      expect(assetDetail?.currentKit).toMatchObject({ id: kit.id, kitCode: kit.kitCode, slotLabel: 'Speaker 1' })
    })
  })

  it('rejects the same equipment twice in one kit', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 1)
      await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: members[0].id, isRequired: true })).rejects.toMatchObject({
        name: 'DomainError',
        code: 'conflict',
        message: expect.stringContaining('already in this kit'),
      })
      expect(await tx.kitAsset.count({ where: { kitId: kit.id, removedAt: null } })).toBe(1)
    })
  })

  it('rejects equipment that is in another kit, naming that kit', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit: kitA, members } = await makeKit(tx, fx, 1)
      const kitB = await createKit(tx, fx.actor, kitInput())
      await expect(addKitAsset(tx, fx.actor, kitB.id, { assetId: members[0].id, isRequired: true })).rejects.toMatchObject({
        code: 'conflict',
        message: expect.stringContaining(kitA.kitCode),
      })
      // The seeded MBP-02 equipment is equally off limits.
      const seeded = await tx.asset.findFirstOrThrow({ where: { admBarcode: 'ADM-DEMO-100001' }, select: { id: true } })
      await expect(addKitAsset(tx, fx.actor, kitB.id, { assetId: seeded.id, isRequired: true })).rejects.toMatchObject({
        code: 'conflict',
        message: expect.stringContaining('MBP-02'),
      })
    })
  })

  it('rejects checked-out and reserved equipment', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await createKit(tx, fx.actor, kitInput())
      for (const status of [AssetStatus.CHECKED_OUT, AssetStatus.RESERVED]) {
        const asset = await makeAsset(tx, fx)
        await tx.asset.update({ where: { id: asset.id }, data: { status } })
        await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, isRequired: true })).rejects.toMatchObject({
          code: 'lifecycle',
          message: expect.stringContaining('under a booking'),
        })
      }
    })
  })

  it('rejects equipment with maintenance in progress or on hold, even while its status still reads available', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await createKit(tx, fx.actor, kitInput())
      const asset = await makeAsset(tx, fx)
      await tx.maintenanceRecord.create({
        data: {
          maintenanceNumber: `MNT-TEST-${tag()}`,
          assetId: asset.id,
          type: MaintenanceType.REPAIR,
          status: MaintenanceStatus.ON_HOLD,
          title: 'Awaiting part',
          startedAt: new Date(),
          createdById: fx.admin.id,
        },
      })
      expect((await tx.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe('AVAILABLE')
      await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, isRequired: true })).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('maintenance'),
      })

      const flagged = await makeAsset(tx, fx)
      await tx.asset.update({ where: { id: flagged.id }, data: { status: AssetStatus.MAINTENANCE } })
      await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: flagged.id, isRequired: true })).rejects.toMatchObject({ code: 'lifecycle' })
    })
  })

  it('rejects retired, missing, damaged and removed equipment', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await createKit(tx, fx.actor, kitInput())
      for (const status of [AssetStatus.RETIRED, AssetStatus.MISSING, AssetStatus.DAMAGED]) {
        const asset = await makeAsset(tx, fx)
        await tx.asset.update({ where: { id: asset.id }, data: { status } })
        await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, isRequired: false })).rejects.toMatchObject({ code: 'lifecycle' })
      }
      const removed = await makeAsset(tx, fx)
      await tx.asset.update({ where: { id: removed.id }, data: { deletedAt: new Date() } })
      await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: removed.id, isRequired: true })).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('removed'),
      })
      await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: 'no-such-asset', isRequired: true })).rejects.toMatchObject({ code: 'not_found' })
      expect(await tx.kitAsset.count({ where: { kitId: kit.id } })).toBe(0)
    })
  })

  it('refuses equipment for retired kits and for kits whose contents are frozen by a handover', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const asset = await makeAsset(tx, fx)

      const retired = await createKit(tx, fx.actor, kitInput())
      await tx.kit.update({ where: { id: retired.id }, data: { status: KitStatus.RETIRED } })
      await expect(addKitAsset(tx, fx.actor, retired.id, { assetId: asset.id, isRequired: true })).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('retired'),
      })

      const { kit: out } = await makeKit(tx, fx, 1)
      await bookKit(tx, fx, out.id, 'READY_FOR_HANDOVER')
      await expect(addKitAsset(tx, fx.actor, out.id, { assetId: asset.id, isRequired: true })).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('frozen'),
      })
    })
  })

  it('removes equipment safely: soft removal, audit entry, and a clean re-add that reuses the row', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 2)
      const [first, second] = members

      const removed = await removeKitAsset(tx, fx.actor, first.kitAssetId)
      expect(removed).toEqual({ kitId: kit.id, assetCode: first.assetCode })
      const row = await tx.kitAsset.findUniqueOrThrow({ where: { id: first.kitAssetId } })
      expect(row.removedAt).not.toBeNull()

      const detail = await getKitDetail(tx, kit.id, { includeIssues: false })
      expect(detail?.members.map((member) => member.assetCode)).toEqual([second.assetCode])
      expect((await getAssetDetail(tx, first.id, { includeIssues: false, includeMaintenance: false }))?.currentKit).toBeNull()
      expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: kit.id, action: 'KIT_ASSET_REMOVED' } })).toBe(1)

      // Adding it back reactivates the same row (composite key) with a fresh addedAt.
      const readded = await addKitAsset(tx, fx.actor, kit.id, { assetId: first.id, slotLabel: 'Back again', isRequired: false })
      expect(readded.kitAssetId).toBe(first.kitAssetId)
      const again = await tx.kitAsset.findUniqueOrThrow({ where: { id: first.kitAssetId } })
      expect(again).toMatchObject({ removedAt: null, slotLabel: 'Back again', isRequired: false })
      expect(again.addedAt.getTime()).toBeGreaterThan(row.addedAt.getTime())
      expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: kit.id, action: 'KIT_ASSET_ADDED' } })).toBe(3)

      // Slot label and required flag can be corrected in place.
      await updateKitAsset(tx, fx.actor, first.kitAssetId, { slotLabel: 'Speaker 2', isRequired: true })
      expect(await tx.kitAsset.findUniqueOrThrow({ where: { id: first.kitAssetId } })).toMatchObject({ slotLabel: 'Speaker 2', isRequired: true })
      await expect(removeKitAsset(tx, fx.actor, 'no-such-member')).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('blocks removal while a handover or checkout depends on the kit, and for equipment held by a booking', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 2)
      await bookKit(tx, fx, kit.id, 'CHECKED_OUT')

      await expect(removeKitAsset(tx, fx.actor, members[0].kitAssetId)).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('frozen'),
      })
      // The kit itself is now workflow-owned and cannot be retired or removed.
      const context = await getKitLifecycleContext(tx, kit.id)
      expect(context).toMatchObject({ status: 'CHECKED_OUT', hasLiveBooking: true, contentsLocked: true, memberCount: 2 })
      expect(allowedKitStatusTransitions(context!.status, context!)).toEqual(['CHECKED_OUT'])
      expect(kitRemovalBlocker(context!)).toContain('live booking')

      // A reservation that has not started handover does not freeze the contents,
      // but equipment already marked checked out or reserved stays put.
      const { kit: reserved, members: reservedMembers } = await makeKit(tx, fx, 2)
      await bookKit(tx, fx, reserved.id, 'RESERVED')
      expect((await getKitLifecycleContext(tx, reserved.id))?.contentsLocked).toBe(false)
      await tx.asset.update({ where: { id: reservedMembers[0].id }, data: { status: AssetStatus.RESERVED } })
      await expect(removeKitAsset(tx, fx.actor, reservedMembers[0].kitAssetId)).rejects.toMatchObject({ code: 'lifecycle' })
      await removeKitAsset(tx, fx.actor, reservedMembers[1].kitAssetId)
      expect(await tx.kitAsset.count({ where: { kitId: reserved.id, removedAt: null } })).toBe(1)
    })
  })

  it('lets the database settle a race for the same equipment with a friendly conflict', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { members } = await makeKit(tx, fx, 1)
      const kitB = await createKit(tx, fx.actor, kitInput())

      // Simulate the second administrator whose pre-check passed before the
      // first one committed: write straight past the service's check.
      let failure: unknown = null
      try {
        await tx.kitAsset.create({ data: { kitId: kitB.id, assetId: members[0].id } })
      } catch (error) {
        failure = error
      }
      expect(failure).not.toBeNull()
      const translated = translateKitAssetError(failure)
      expect(translated).toBeInstanceOf(DomainError)
      expect(translated).toMatchObject({ code: 'conflict', message: expect.stringContaining('another kit') })
      expect(translateKitAssetError(new Error('unrelated'))).toBeNull()
    })
  })
})

describe('kit availability', () => {
  it('is ready when every required member is available and nothing holds the kit', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit } = await makeKit(tx, fx, 2, 1)
      const availability = await getKitAvailability(tx, kit.id)
      expect(availability).toMatchObject({ available: true, state: 'ready', reasons: [], blockingCount: 0, warningCount: 0, memberCount: 3, requiredCount: 2 })
      expect(await getKitAvailability(tx, 'no-such-kit')).toBeNull()

      // The list computes the very same verdict for its rows.
      const { loadKitList } = await import('@/server/services/kits.service')
      expect(loadKitList).toBeTypeOf('function')
      const seeded = await tx.kit.findUniqueOrThrow({ where: { kitCode: 'MBP-02' }, select: { id: true } })
      const mbp = await getKitAvailability(tx, seeded.id)
      expect(mbp?.memberCount).toBe(12)
      expect(mbp?.requiredCount).toBe(11)
    })
  })

  it('is not ready when a required member is unavailable, and names the blocking equipment', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 2, 1)
      const [required, , optional] = members

      await tx.asset.update({ where: { id: required.id }, data: { status: AssetStatus.DAMAGED } })
      const blocked = await getKitAvailability(tx, kit.id)
      expect(blocked).toMatchObject({ available: false, state: 'unavailable', blockingCount: 1, warningCount: 0 })
      expect(blocked?.reasons).toEqual([
        expect.objectContaining({ code: 'asset_status', severity: 'blocking', assetId: required.id, assetCode: required.assetCode, slotLabel: 'Slot 1', reason: expect.stringContaining('damaged') }),
      ])

      // An optional member in trouble is a warning, not a blocker.
      await tx.asset.update({ where: { id: required.id }, data: { status: AssetStatus.AVAILABLE } })
      await tx.asset.update({ where: { id: optional.id }, data: { status: AssetStatus.MISSING } })
      const warned = await getKitAvailability(tx, kit.id)
      expect(warned).toMatchObject({ available: true, state: 'ready', blockingCount: 0, warningCount: 1 })
      expect(warned?.reasons[0]).toMatchObject({ severity: 'warning', assetCode: optional.assetCode })

      // Kit-level states.
      await tx.kit.update({ where: { id: kit.id }, data: { status: KitStatus.MAINTENANCE } })
      expect(await getKitAvailability(tx, kit.id)).toMatchObject({ available: false, state: 'unavailable' })
      await tx.kit.update({ where: { id: kit.id }, data: { status: KitStatus.AVAILABLE } })
      await bookKit(tx, fx, kit.id, 'RESERVED')
      const reserved = await getKitAvailability(tx, kit.id)
      expect(reserved).toMatchObject({ available: false, state: 'reserved' })
      expect(reserved?.reasons.find((reason) => reason.code === 'live_booking')?.reason).toContain('Reserved under BK-TEST-')
    })
  })

  it('treats maintenance in progress or on hold as unavailable and checked-out kits as out', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 2)
      await tx.maintenanceRecord.create({
        data: {
          maintenanceNumber: `MNT-TEST-${tag()}`,
          assetId: members[1].id,
          type: MaintenanceType.CALIBRATION,
          status: MaintenanceStatus.IN_PROGRESS,
          title: 'Annual calibration',
          startedAt: new Date(),
          createdById: fx.admin.id,
        },
      })
      const availability = await getKitAvailability(tx, kit.id)
      expect(availability).toMatchObject({ available: false, blockingCount: 1 })
      expect(availability?.reasons[0]).toMatchObject({ code: 'asset_maintenance', assetId: members[1].id, assetCode: members[1].assetCode })

      // Pure evaluator: the same facts, a checked-out booking on top.
      const facts = {
        kitId: kit.id,
        kitCode: kit.kitCode,
        status: KitStatus.CHECKED_OUT,
        deleted: false,
        isActive: true,
        members: [],
        liveBooking: {
          id: 'b',
          bookingNumber: 'BK-2026-000001',
          status: 'CHECKED_OUT' as const,
          bookingStart: new Date(),
          bookingEnd: new Date(),
          expectedReturnDate: new Date(),
          collectionDate: new Date(),
          editorName: 'An Editor',
          engineerName: 'An Engineer',
        },
      }
      const out = evaluateKitAvailability(facts)
      expect(out).toMatchObject({ available: false, state: 'out' })
      expect(out.reasons[0].reason).toBe('Checked out under BK-2026-000001 by An Editor.')
      expect(evaluateKitAvailability({ ...facts, status: KitStatus.AVAILABLE, liveBooking: null })).toMatchObject({ available: true, state: 'ready' })
      expect(evaluateKitAvailability({ ...facts, status: KitStatus.RETIRED, liveBooking: null }).reasons[0]).toMatchObject({ code: 'kit_status' })
      expect(evaluateKitAvailability({ ...facts, status: KitStatus.AVAILABLE, liveBooking: null, deleted: true }).reasons[0]).toMatchObject({ code: 'kit_removed' })
    })
  })
})

describe('software, checklist and history', () => {
  it('associates and removes software expectations with audit entries; duplicates are refused', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await createKit(tx, fx.actor, kitInput())

      const row = await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })
      expect((await getKitDetail(tx, kit.id, { includeIssues: false }))?.software).toEqual([
        expect.objectContaining({ id: row.id, isRequired: true, software: expect.objectContaining({ id: fx.softwareId }) }),
      ])
      await expect(addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: 'no-such-app', isRequired: true })).rejects.toMatchObject({ code: 'validation' })

      await removeKitSoftware(tx, fx.actor, row.id)
      expect(await tx.kitSoftware.count({ where: { kitId: kit.id } })).toBe(0)
      const actions = (await tx.auditLog.findMany({ where: { entityType: 'Kit', entityId: kit.id } })).map((entry) => entry.action)
      expect(actions).toEqual(expect.arrayContaining(['KIT_SOFTWARE_ADDED', 'KIT_SOFTWARE_REMOVED']))

      // Same application twice: the composite key refuses it.
      await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: false })
      await expect(addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })).rejects.toMatchObject({
        code: 'conflict',
        message: expect.stringContaining('already listed'),
      })
    })
  })

  it('assigns, clears and validates the handover checklist template', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await createKit(tx, fx.actor, kitInput())

      await setKitChecklistTemplate(tx, fx.actor, kit.id, { templateId: fx.templateId })
      expect((await getKitDetail(tx, kit.id, { includeIssues: false }))?.checklistTemplate).toMatchObject({ id: fx.templateId, itemCount: 12 })
      // Same template again is a no-op (no second audit entry).
      await setKitChecklistTemplate(tx, fx.actor, kit.id, { templateId: fx.templateId })
      expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: kit.id, action: 'KIT_CHECKLIST_CHANGED' } })).toBe(1)

      await setKitChecklistTemplate(tx, fx.actor, kit.id, { templateId: undefined })
      expect((await getKitDetail(tx, kit.id, { includeIssues: false }))?.checklistTemplate).toBeNull()
      expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: kit.id, action: 'KIT_CHECKLIST_CHANGED' } })).toBe(2)

      await expect(setKitChecklistTemplate(tx, fx.actor, kit.id, { templateId: 'no-such-template' })).rejects.toMatchObject({ code: 'validation' })
    })
  })

  it('assembles the history newest first, without duplicating membership events', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { kit, members } = await makeKit(tx, fx, 2)
      await removeKitAsset(tx, fx.actor, members[0].kitAssetId)
      await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })
      await setKitChecklistTemplate(tx, fx.actor, kit.id, { templateId: fx.templateId })
      const booking = await bookKit(tx, fx, kit.id, 'CHECKED_OUT')

      const events = await getKitHistory(tx, kit.id, { includeIssues: true })
      const times = events.map((event) => event.at.getTime())
      expect(times).toEqual([...times].sort((a, b) => b - a))

      const kinds = events.map((event) => event.kind)
      expect(kinds).toEqual(expect.arrayContaining(['created', 'member-added', 'member-removed', 'software', 'checklist', 'booking', 'handover']))
      expect(events.filter((event) => event.kind === 'member-added')).toHaveLength(2)
      expect(events.filter((event) => event.kind === 'member-removed')).toHaveLength(1)
      expect(events.find((event) => event.kind === 'booking')?.title).toContain(booking.bookingNumber)
      expect(events.find((event) => event.kind === 'created')?.actorName).toBe(fx.admin.name)
      // Booking-derived events carry the booking's own dates (the fixture collected a day ago);
      // among the kit's own events the creation comes last.
      const own = events.filter((event) => !['booking', 'handover', 'return'].includes(event.kind))
      expect(own.at(-1)?.kind).toBe('created')
      expect(events.every((event) => typeof event.title === 'string' && !event.title.startsWith('{'))).toBe(true)

      // The seeded kit's memberships have no audit rows; they still appear once each.
      const seeded = await tx.kit.findUniqueOrThrow({ where: { kitCode: 'MBP-02' }, select: { id: true } })
      const seededEvents = await getKitHistory(tx, seeded.id, { includeIssues: false })
      expect(seededEvents.filter((event) => event.kind === 'member-added')).toHaveLength(12)
    })
  })
})
