import { randomUUID } from 'node:crypto'

import { AssetStatus, MaintenanceStatus, UserRole } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import {
  countAssetsByStatus,
  findAssetIdByBarcode,
  getAssetDetail,
  getAssetHistory,
  getAssetLifecycleContext,
  listAssets,
} from '@/server/dal/assets.dal'
import {
  addAccessory,
  allowedStatusTransitions,
  createAsset,
  isAvailableForUse,
  removalBlocker,
  removeAsset,
  updateAsset,
} from '@/server/services/assets.service'
import { DomainError } from '@/server/services/errors'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'

/**
 * Equipment rules against the real database, inside rolled-back transactions.
 * Uses the seeded inventory (12 assets in kit MBP-02, ADM-DEMO-* barcodes)
 * as a fixed backdrop and adds its own rows on top.
 *
 * PostgreSQL aborts a transaction after a failed statement, so tests that
 * provoke a unique-constraint violation do it as their final step.
 */

const LIST_DEFAULTS = { view: 'all', assignment: 'all', sort: 'assetCode', direction: 'asc', page: 1, pageSize: 25 } as const

async function fixtures(tx: Db): Promise<{ admin: TestUser; categoryId: string; accessoryTypeId: string }> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } })
  const type = await tx.accessoryType.findFirstOrThrow({ where: { code: 'POWER_CABLE' }, select: { id: true } })
  return { admin, categoryId: category.id, accessoryTypeId: type.id }
}

function input(categoryId: string, overrides: Partial<Parameters<typeof createAsset>[2]> = {}) {
  const tag = randomUUID().slice(0, 8)
  return {
    name: `Test Equipment ${tag}`,
    categoryId,
    manufacturer: 'Testco',
    model: `T-${tag}`,
    serialNumber: `SN-TEST-${tag}`,
    admBarcode: `ADM-TEST-${tag}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE' as const,
    ...overrides,
  }
}

afterAll(async () => {
  await testDb.$disconnect()
})

describe('creating equipment', () => {
  it('allocates consecutive AST-NNNNNN codes, logs the initial status and audits the creation', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)

      const first = await createAsset(tx, actor, input(categoryId))
      const second = await createAsset(tx, actor, input(categoryId))

      expect(first.assetCode).toMatch(/^AST-\d{6}$/)
      expect(Number(second.assetCode.slice(4))).toBe(Number(first.assetCode.slice(4)) + 1)

      const log = await tx.assetStatusLog.findMany({ where: { assetId: first.id } })
      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({ fromStatus: null, toStatus: 'AVAILABLE', changedById: admin.id })

      const audit = await tx.auditLog.findMany({ where: { entityType: 'Asset', entityId: first.id } })
      expect(audit.map((row) => row.action)).toEqual(['CREATE'])
      expect(audit[0].actorUserId).toBe(admin.id)
      expect(audit[0].summary).toContain(first.assetCode)
    })
  })

  it('rejects a duplicate ADM barcode with a field error (database-enforced)', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      await createAsset(tx, actor, input(categoryId, { admBarcode: 'ADM-TEST-DUP-BARCODE' }))

      await expect(createAsset(tx, actor, input(categoryId, { admBarcode: 'ADM-TEST-DUP-BARCODE' }))).rejects.toMatchObject({
        name: 'DomainError',
        code: 'conflict',
        fieldErrors: { admBarcode: expect.stringContaining('barcode') },
      })
    })
  })

  it('rejects a duplicate serial number with a field error (database-enforced)', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)

      await expect(createAsset(tx, actor, input(categoryId, { serialNumber: 'SN-DEMO-MBP02-0001' }))).rejects.toMatchObject({
        name: 'DomainError',
        code: 'conflict',
        fieldErrors: { serialNumber: expect.stringContaining('serial number') },
      })
    })
  })

  it('rejects an unknown or inactive category before touching the numbering counter', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      const before = await tx.numberSequence.findUnique({ where: { scope_period: { scope: 'ASSET', period: 'GLOBAL' } } })

      await expect(createAsset(tx, actor, input('does-not-exist'))).rejects.toMatchObject({
        code: 'validation',
        fieldErrors: { categoryId: expect.any(String) },
      })

      await tx.equipmentCategory.update({ where: { id: categoryId }, data: { isActive: false } })
      await expect(createAsset(tx, actor, input(categoryId))).rejects.toBeInstanceOf(DomainError)

      const after = await tx.numberSequence.findUnique({ where: { scope_period: { scope: 'ASSET', period: 'GLOBAL' } } })
      expect(after?.current).toBe(before?.current)
    })
  })
})

describe('listing and searching equipment', () => {
  it('finds equipment by ADM barcode, serial number and manufacturer', async () => {
    await withRollback(async (tx) => {
      const byBarcode = await listAssets(tx, { ...LIST_DEFAULTS, search: 'ADM-DEMO-100009' })
      expect(byBarcode.rows.map((row) => row.assetCode)).toEqual(['AST-000009'])

      const bySerial = await listAssets(tx, { ...LIST_DEFAULTS, search: 'sn-demo-mbp02-0003' })
      expect(bySerial.rows.map((row) => row.assetCode)).toEqual(['AST-000003'])

      const byMaker = await listAssets(tx, { ...LIST_DEFAULTS, search: 'Blackmagic' })
      expect(byMaker.total).toBeGreaterThanOrEqual(2)
      expect(byMaker.rows.every((row) => row.manufacturer === 'Blackmagic Design')).toBe(true)
    })
  })

  it('resolves an exact barcode scan straight to the asset, including accessory barcodes', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId, accessoryTypeId } = await fixtures(tx)
      const actor = actorFor(admin)

      const target = await tx.asset.findUniqueOrThrow({ where: { assetCode: 'AST-000009' }, select: { id: true } })
      expect(await findAssetIdByBarcode(tx, 'ADM-DEMO-100009')).toBe(target.id)
      expect(await findAssetIdByBarcode(tx, 'ADM-DEMO-10000')).toBeNull()
      expect(await findAssetIdByBarcode(tx, '')).toBeNull()

      const created = await createAsset(tx, actor, input(categoryId))
      await addAccessory(tx, actor, created.id, {
        accessoryTypeId,
        label: 'Scan me',
        quantity: 1,
        serialNumber: undefined,
        admBarcode: 'ADM-TEST-ACC-SCAN',
        isRequired: true,
        notes: undefined,
      })
      expect(await findAssetIdByBarcode(tx, 'ADM-TEST-ACC-SCAN')).toBe(created.id)
    })
  })

  it('filters by category, status view and kit assignment', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      const monitor = await tx.equipmentCategory.findUniqueOrThrow({ where: { code: 'BROADCAST_MONITOR' }, select: { id: true } })

      const byCategory = await listAssets(tx, { ...LIST_DEFAULTS, categoryId: monitor.id })
      expect(byCategory.rows.map((row) => row.assetCode)).toEqual(['AST-000009'])

      const damaged = await createAsset(tx, actor, input(categoryId, { status: 'DAMAGED' }))
      const damagedView = await listAssets(tx, { ...LIST_DEFAULTS, view: 'missing-damaged' })
      expect(damagedView.rows.map((row) => row.id)).toContain(damaged.id)
      const availableView = await listAssets(tx, { ...LIST_DEFAULTS, view: 'available' })
      expect(availableView.rows.map((row) => row.id)).not.toContain(damaged.id)
      expect(availableView.rows.every((row) => row.status === 'AVAILABLE')).toBe(true)

      const unassigned = await listAssets(tx, { ...LIST_DEFAULTS, assignment: 'unassigned' })
      expect(unassigned.rows.map((row) => row.id)).toContain(damaged.id)
      expect(unassigned.rows.some((row) => row.assetCode === 'AST-000001')).toBe(false)
      const inKit = await listAssets(tx, { ...LIST_DEFAULTS, assignment: 'in-kit' })
      expect(inKit.rows.map((row) => row.id)).not.toContain(damaged.id)
      expect(inKit.rows.every((row) => row.currentKit?.kitCode === 'MBP-02')).toBe(true)

      const counts = await countAssetsByStatus(tx)
      expect(counts.DAMAGED).toBeGreaterThanOrEqual(1)
    })
  })

  it('paginates in the database with stable ordering', async () => {
    await withRollback(async (tx) => {
      const page1 = await listAssets(tx, { ...LIST_DEFAULTS, pageSize: 5, page: 1 })
      const page2 = await listAssets(tx, { ...LIST_DEFAULTS, pageSize: 5, page: 2 })

      expect(page1.rows).toHaveLength(5)
      expect(page1.pageCount).toBe(Math.ceil(page1.total / 5))
      expect(page1.total).toBeGreaterThanOrEqual(12)
      const ids1 = page1.rows.map((row) => row.id)
      expect(page2.rows.every((row) => !ids1.includes(row.id))).toBe(true)
      expect(page1.rows.map((row) => row.assetCode)).toEqual([...page1.rows.map((row) => row.assetCode)].sort())

      const beyond = await listAssets(tx, { ...LIST_DEFAULTS, pageSize: 5, page: 999 })
      expect(beyond.page).toBe(beyond.pageCount)
      expect(beyond.rows.length).toBeGreaterThan(0)

      const desc = await listAssets(tx, { ...LIST_DEFAULTS, sort: 'updatedAt', direction: 'desc', pageSize: 3 })
      for (let index = 1; index < desc.rows.length; index += 1) {
        expect(desc.rows[index].updatedAt.getTime()).toBeLessThanOrEqual(desc.rows[index - 1].updatedAt.getTime())
      }
    })
  })
})

describe('equipment detail and history', () => {
  it('assembles the detail workspace for a seeded asset', async () => {
    await withRollback(async (tx) => {
      const target = await tx.asset.findUniqueOrThrow({ where: { assetCode: 'AST-000009' }, select: { id: true } })
      const detail = await getAssetDetail(tx, target.id, { includeMaintenance: true, includeIssues: true })

      expect(detail).not.toBeNull()
      expect(detail!.category.name).toBe('Broadcast Monitor')
      expect(detail!.currentKit?.kitCode).toBe('MBP-02')
      expect(detail!.accessories).toHaveLength(2)
      expect(detail!.maintenance?.length).toBeGreaterThanOrEqual(1)
      expect(detail!.maintenance?.[0].maintenanceNumber).toMatch(/^MNT-\d{4}-\d{6}$/)
      expect(detail!.issues).toEqual([])
      expect(detail!.activeMaintenanceCount).toBe(0)

      const restricted = await getAssetDetail(tx, target.id, { includeMaintenance: false, includeIssues: false })
      expect(restricted!.maintenance).toBeNull()
      expect(restricted!.issues).toBeNull()
    })
  })

  it('builds one chronological trail, newest first, from status, accessory and audit sources', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId, accessoryTypeId } = await fixtures(tx)
      const actor = actorFor(admin)

      const created = await createAsset(tx, actor, input(categoryId))
      const base = { ...input(categoryId), name: 'Renamed Equipment' }
      await updateAsset(tx, actor, created.id, { ...base, status: 'DAMAGED', statusReason: 'Cracked during transport' })
      await addAccessory(tx, actor, created.id, {
        accessoryTypeId,
        label: undefined,
        quantity: 2,
        serialNumber: undefined,
        admBarcode: undefined,
        isRequired: true,
        notes: undefined,
      })

      const events = await getAssetHistory(tx, created.id, { includeIssues: true, includeMaintenance: true })
      expect(events.length).toBeGreaterThanOrEqual(4)
      for (let index = 1; index < events.length; index += 1) {
        expect(events[index].at.getTime()).toBeLessThanOrEqual(events[index - 1].at.getTime())
      }
      const kinds = new Set(events.map((event) => event.kind))
      expect(kinds.has('created')).toBe(true)
      expect(kinds.has('status')).toBe(true)
      expect(kinds.has('accessory')).toBe(true)
      expect(kinds.has('update')).toBe(true)

      const status = events.find((event) => event.kind === 'status')
      expect(status?.title).toBe('Status changed Available → Damaged')
      expect(status?.detail).toBe('Cracked during transport')
      expect(status?.actorName).toBe(admin.name)
    })
  })

  it('never exposes sensitive fields from the DAL', async () => {
    await withRollback(async (tx) => {
      const target = await tx.asset.findUniqueOrThrow({ where: { assetCode: 'AST-000009' }, select: { id: true } })
      const [list, detail, history] = await Promise.all([
        listAssets(tx, LIST_DEFAULTS),
        getAssetDetail(tx, target.id, { includeMaintenance: true, includeIssues: true }),
        getAssetHistory(tx, target.id, { includeIssues: true, includeMaintenance: true }),
      ])
      const serialised = JSON.stringify({ list, detail, history })
      for (const forbidden of ['passwordHash', 'email', 'ipAddress', 'userAgent', 'previousValue', 'newValue', 'metadata', 'sessionVersion']) {
        expect(serialised, forbidden).not.toContain(forbidden)
      }
    })
  })
})

describe('lifecycle rules', () => {
  it('blocks availability and removal while maintenance is in progress or on hold', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      const created = await createAsset(tx, actor, input(categoryId, { status: 'DAMAGED' }))

      await tx.maintenanceRecord.create({
        data: {
          maintenanceNumber: `MNT-TEST-${randomUUID().slice(0, 8)}`,
          assetId: created.id,
          type: 'REPAIR',
          status: MaintenanceStatus.IN_PROGRESS,
          title: 'Screen replacement',
          startedAt: new Date(),
          createdById: admin.id,
        },
      })

      const context = await getAssetLifecycleContext(tx, created.id)
      expect(context?.hasActiveMaintenance).toBe(true)
      expect(isAvailableForUse(context!)).toBe(false)
      expect(allowedStatusTransitions(AssetStatus.DAMAGED, context!)).not.toContain(AssetStatus.AVAILABLE)
      expect(removalBlocker(context!)).toMatch(/maintenance/i)

      await expect(updateAsset(tx, actor, created.id, { ...input(categoryId), status: 'AVAILABLE' })).rejects.toMatchObject({
        code: 'lifecycle',
        fieldErrors: { status: expect.stringMatching(/maintenance/i) },
      })
    })
  })

  it('keeps reserved and checked-out equipment under workflow control', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      const created = await createAsset(tx, actor, input(categoryId))
      await tx.asset.update({ where: { id: created.id }, data: { status: AssetStatus.CHECKED_OUT } })

      const context = await getAssetLifecycleContext(tx, created.id)
      expect(allowedStatusTransitions(AssetStatus.CHECKED_OUT, context!)).toEqual([AssetStatus.CHECKED_OUT])
      await expect(updateAsset(tx, actor, created.id, { ...input(categoryId), status: 'AVAILABLE' })).rejects.toMatchObject({ code: 'lifecycle' })
      expect(removalBlocker(context!)).toMatch(/checked out/i)
    })
  })

  it('allows the manual transitions, records them, and cannot retire equipment still in a kit', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      const created = await createAsset(tx, actor, input(categoryId))
      const context = await getAssetLifecycleContext(tx, created.id)

      expect(allowedStatusTransitions(AssetStatus.AVAILABLE, context!).sort()).toEqual(
        ['AVAILABLE', 'DAMAGED', 'MISSING', 'RETIRED'].sort(),
      )
      const inKit = await getAssetLifecycleContext(tx, (await tx.asset.findUniqueOrThrow({ where: { assetCode: 'AST-000001' } })).id)
      expect(allowedStatusTransitions(AssetStatus.AVAILABLE, inKit!)).not.toContain(AssetStatus.RETIRED)

      const result = await updateAsset(tx, actor, created.id, { ...input(categoryId), status: 'MISSING', statusReason: 'Not returned' })
      expect(result.statusChanged).toBe(true)
      const audit = await tx.auditLog.findMany({ where: { entityType: 'Asset', entityId: created.id }, orderBy: { createdAt: 'asc' } })
      expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['CREATE', 'ASSET_STATUS_CHANGED', 'UPDATE']))
    })
  })

  it('removes equipment softly, keeps its history, and refuses to remove kit members', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      const created = await createAsset(tx, actor, input(categoryId))

      await removeAsset(tx, actor, created.id)

      const listed = await listAssets(tx, { ...LIST_DEFAULTS, search: created.assetCode })
      expect(listed.total).toBe(0)
      const detail = await getAssetDetail(tx, created.id, { includeMaintenance: false, includeIssues: false })
      expect(detail?.deletedAt).toBeInstanceOf(Date)
      const history = await getAssetHistory(tx, created.id, { includeIssues: false, includeMaintenance: false })
      expect(history[0].kind).toBe('removed')

      const member = await tx.asset.findUniqueOrThrow({ where: { assetCode: 'AST-000002' }, select: { id: true } })
      await expect(removeAsset(tx, actor, member.id)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringMatching(/kit/i) })
    })
  })

  it('rejects an accessory whose type is unknown', async () => {
    await withRollback(async (tx) => {
      const { admin, categoryId } = await fixtures(tx)
      const actor = actorFor(admin)
      const created = await createAsset(tx, actor, input(categoryId))

      await expect(
        addAccessory(tx, actor, created.id, {
          accessoryTypeId: 'not-a-type',
          label: undefined,
          quantity: 1,
          serialNumber: undefined,
          admBarcode: undefined,
          isRequired: true,
          notes: undefined,
        }),
      ).rejects.toMatchObject({ code: 'validation', fieldErrors: { accessoryTypeId: expect.any(String) } })
    })
  })
})
