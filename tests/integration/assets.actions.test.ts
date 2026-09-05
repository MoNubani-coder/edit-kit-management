import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { UnauthorizedError } from '@/server/auth/errors'
import type { Db } from '@/server/db/prisma'

import { createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * The equipment Server Actions invoked directly, as a hostile client could
 * POST them - with the session stubbed and the database role real.
 *
 * Isolation: the whole suite runs inside ONE PostgreSQL transaction that is
 * rolled back in `afterAll`. The module the actions import `prisma` from is
 * replaced with a proxy onto that transaction client, so the real numbering
 * service, the real audit writes and the real rows all happen inside the
 * transaction and disappear with it. Repeated runs leave no asset, no user,
 * no audit row and an unchanged AST counter.
 */

class Rollback extends Error {}

let tx: Db
let releaseTransaction: (() => void) | undefined
let transactionReady: () => void = () => {}
const ready = new Promise<void>((resolve) => {
  transactionReady = resolve
})

const transaction = testDb
  .$transaction(
    async (client) => {
      tx = client
      transactionReady()
      await new Promise<void>((_, reject) => {
        releaseTransaction = () => reject(new Rollback())
      })
    },
    { maxWait: 10_000, timeout: 180_000 },
  )
  .catch((error: unknown) => {
    if (!(error instanceof Rollback)) throw error
  })

let currentSession: Session | null = null
vi.mock('@/server/auth/auth', () => ({ auth: vi.fn(async () => currentSession) }))
vi.mock('@/server/db/prisma', () => ({
  // Every `prisma.x` the actions and services touch resolves to the open
  // transaction. `'$transaction' in prisma` is false, so services run inline.
  prisma: new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, property) => (tx as unknown as Record<string | symbol, unknown>)[property],
  }),
}))

const { createAssetFormAction, updateAssetFormAction } = await import('@/server/actions/assets.actions')
const { addAccessoryFormAction } = await import('@/server/actions/accessories.actions')
const { loadEquipmentList } = await import('@/server/services/assets.service')

const LIST = { view: 'all', assignment: 'all', sort: 'assetCode', direction: 'asc', page: 1, pageSize: 25 } as const

function sessionFor(user: TestUser): Session {
  return { expires: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role } }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

let admin: TestUser
let engineer: TestUser
let viewer: TestUser
let categoryId: string
let accessoryTypeId: string
let counterBefore: number
const barcode = `ADM-ACTION-${randomUUID().slice(0, 8)}`
let createdAssetId: string | null = null

beforeAll(async () => {
  await ready
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  categoryId = (await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' } })).id
  accessoryTypeId = (await tx.accessoryType.findFirstOrThrow({ where: { code: 'MOUSE' } })).id
  counterBefore =
    (await tx.numberSequence.findUnique({ where: { scope_period: { scope: 'ASSET', period: 'GLOBAL' } } }))?.current ?? 0
})

afterAll(async () => {
  // Roll everything back, then prove the database outside the transaction is untouched.
  releaseTransaction?.()
  await transaction
  const counterAfter =
    (await testDb.numberSequence.findUnique({ where: { scope_period: { scope: 'ASSET', period: 'GLOBAL' } } }))?.current ?? 0
  expect(counterAfter).toBe(counterBefore)
  expect(await testDb.asset.count({ where: { admBarcode: barcode } })).toBe(0)
  expect(await testDb.user.count({ where: { id: { in: [admin.id, engineer.id, viewer.id] } } })).toBe(0)
  await testDb.$disconnect()
})

beforeEach(() => {
  currentSession = null
})

const validFields = () => ({
  name: 'Action Test Equipment',
  categoryId,
  manufacturer: 'Testco',
  model: 'A-1',
  serialNumber: `SN-ACTION-${barcode}`,
  admBarcode: barcode,
  status: 'AVAILABLE',
})

describe('equipment access', () => {
  it('rejects anonymous list access', async () => {
    await expect(loadEquipmentList(LIST)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('lets a VIEWER (asset.read) list equipment', async () => {
    currentSession = sessionFor(viewer)
    const page = await loadEquipmentList(LIST)
    expect(page.result.total).toBeGreaterThanOrEqual(12)
    expect(page.result.rows.length).toBeGreaterThan(0)
    expect(page.categories.length).toBeGreaterThan(0)
  })
})

describe('equipment mutations', () => {
  it('forbids VIEWER and ENGINEER from creating equipment', async () => {
    currentSession = sessionFor(viewer)
    expect(await createAssetFormAction(null, form(validFields()))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(engineer)
    expect(await createAssetFormAction(null, form(validFields()))).toMatchObject({ ok: false, error: 'forbidden' })

    expect(await tx.asset.count({ where: { admBarcode: barcode } })).toBe(0)
  })

  it('returns field-level validation errors before touching the database', async () => {
    currentSession = sessionFor(admin)
    const result = await createAssetFormAction(null, form({ ...validFields(), name: '' }))
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result && !result.ok) expect(result.fieldErrors).toHaveProperty('name')
    expect(await tx.asset.count({ where: { admBarcode: barcode } })).toBe(0)
  })

  it('lets an ADMIN create equipment, audits it, and redirects to its workspace', async () => {
    currentSession = sessionFor(admin)
    await expect(createAssetFormAction(null, form(validFields()))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const asset = await tx.asset.findUnique({ where: { admBarcode: barcode } })
    expect(asset).not.toBeNull()
    expect(asset!.assetCode).toMatch(/^AST-\d{6}$/)
    createdAssetId = asset!.id

    const audit = await tx.auditLog.findMany({ where: { entityType: 'Asset', entityId: asset!.id } })
    expect(audit.map((row) => row.action)).toEqual(['CREATE'])
    expect(audit[0].actorUserId).toBe(admin.id)
  })

  it('forbids an ENGINEER from editing equipment', async () => {
    expect(createdAssetId).not.toBeNull()
    currentSession = sessionFor(engineer)
    const result = await updateAssetFormAction(null, form({ ...validFields(), id: createdAssetId!, status: 'DAMAGED' }))
    expect(result).toMatchObject({ ok: false, error: 'forbidden' })
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: createdAssetId! } })
    expect(asset.status).toBe('AVAILABLE')
  })

  it('applies accessory authorization: VIEWER forbidden, ADMIN allowed', async () => {
    expect(createdAssetId).not.toBeNull()
    const fields = { assetId: createdAssetId!, accessoryTypeId, label: 'Wireless Mouse', quantity: '1', isRequired: 'on' }

    currentSession = sessionFor(viewer)
    expect(await addAccessoryFormAction(null, form(fields))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    await expect(addAccessoryFormAction(null, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    const accessories = await tx.accessory.findMany({ where: { assetId: createdAssetId!, deletedAt: null } })
    expect(accessories).toHaveLength(1)
    expect(accessories[0]).toMatchObject({ label: 'Wireless Mouse', quantity: 1, isRequired: true })
  })
})
