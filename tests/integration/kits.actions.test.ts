import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthorizedError } from '@/server/auth/errors'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * The kit Server Actions invoked directly, as a hostile client could POST
 * them - with the session stubbed and the database real.
 *
 * Isolation: the whole suite runs inside ONE PostgreSQL transaction that is
 * rolled back in `afterAll`; `@/server/db/prisma` is replaced with a proxy onto
 * the transaction client. Nothing persists - not the kit, not the equipment,
 * not the AST number it consumed, not the users.
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
  prisma: new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, property) => (tx as unknown as Record<string | symbol, unknown>)[property],
  }),
}))

const { createKitFormAction, updateKitFormAction } = await import('@/server/actions/kits.actions')
const { addKitAssetFormAction, addKitSoftwareFormAction, setKitChecklistFormAction, removeKitAssetFormAction } = await import(
  '@/server/actions/kit-composition.actions'
)
const { loadKitList } = await import('@/server/services/kits.service')
const { createAsset } = await import('@/server/services/assets.service')

const LIST = { view: 'all', sort: 'kitCode', direction: 'asc', page: 1, pageSize: 25 } as const

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
let editor: TestUser
let softwareId: string
let templateId: string
let assetId: string
let counterBefore: number
const tag = randomUUID().slice(0, 8).toUpperCase()
const kitCode = `ACT-${tag}`
let createdKitId: string | null = null

beforeAll(async () => {
  await ready
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  editor = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  softwareId = (await tx.softwareApplication.findFirstOrThrow({ where: { deletedAt: null, isActive: true } })).id
  templateId = (await tx.checklistTemplate.findFirstOrThrow({ where: { isDefault: true } })).id
  counterBefore =
    (await tx.numberSequence.findUnique({ where: { scope_period: { scope: 'ASSET', period: 'GLOBAL' } } }))?.current ?? 0
  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' } })
  assetId = (
    await createAsset(tx, actorFor(admin), {
      name: `Action Kit Asset ${tag}`,
      categoryId: category.id,
      manufacturer: 'Testco',
      model: 'A-2',
      serialNumber: `SN-ACTIONKIT-${tag}`,
      admBarcode: `ADM-ACTIONKIT-${tag}`,
      location: undefined,
      notes: undefined,
      status: 'AVAILABLE',
    })
  ).id
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  const counterAfter =
    (await testDb.numberSequence.findUnique({ where: { scope_period: { scope: 'ASSET', period: 'GLOBAL' } } }))?.current ?? 0
  expect(counterAfter).toBe(counterBefore)
  expect(await testDb.kit.count({ where: { kitCode } })).toBe(0)
  expect(await testDb.asset.count({ where: { admBarcode: `ADM-ACTIONKIT-${tag}` } })).toBe(0)
  expect(await testDb.user.count({ where: { id: { in: [admin.id, engineer.id, viewer.id, editor.id] } } })).toBe(0)
  await testDb.$disconnect()
})

beforeEach(() => {
  currentSession = null
})

const validFields = () => ({ kitCode, name: `Action Test Kit ${tag}`, admBarcode: `ADM-ACTIONKIT-K${tag}`, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })

describe('kit access', () => {
  it('rejects anonymous list access', async () => {
    await expect(loadKitList(LIST)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('lets VIEWER and ENGINEER (kit.read) list kits, with availability computed per row', async () => {
    for (const user of [viewer, engineer]) {
      currentSession = sessionFor(user)
      const page = await loadKitList(LIST)
      expect(page.result.total).toBeGreaterThanOrEqual(1)
      const seeded = page.result.rows.find((row) => row.kitCode === 'MBP-02')
      expect(seeded?.availability).toMatchObject({ memberCount: 12, requiredCount: 11 })
      expect(page.statusCounts.AVAILABLE).toBeGreaterThanOrEqual(1)
    }
  })

  it('refuses an EDITOR, who has no kit.read', async () => {
    currentSession = sessionFor(editor)
    await expect(loadKitList(LIST)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('kit mutations', () => {
  it('forbids VIEWER and ENGINEER from creating kits', async () => {
    currentSession = sessionFor(viewer)
    expect(await createKitFormAction(null, form(validFields()))).toMatchObject({ ok: false, error: 'forbidden' })
    currentSession = sessionFor(engineer)
    expect(await createKitFormAction(null, form(validFields()))).toMatchObject({ ok: false, error: 'forbidden' })
    expect(await tx.kit.count({ where: { kitCode } })).toBe(0)
  })

  it('returns field-level validation errors before touching the database', async () => {
    currentSession = sessionFor(admin)
    const result = await createKitFormAction(null, form({ ...validFields(), kitCode: 'not a code!' }))
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result && !result.ok) expect(result.fieldErrors).toHaveProperty('kitCode')
    expect(await tx.kit.count({ where: { name: validFields().name } })).toBe(0)
  })

  it('lets an ADMIN create a kit, audits it, and redirects to its workspace', async () => {
    currentSession = sessionFor(admin)
    await expect(createKitFormAction(null, form(validFields()))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const kit = await tx.kit.findUnique({ where: { kitCode } })
    expect(kit).not.toBeNull()
    createdKitId = kit!.id
    const audit = await tx.auditLog.findMany({ where: { entityType: 'Kit', entityId: kit!.id } })
    expect(audit.map((row) => row.action)).toEqual(['CREATE'])
    expect(audit[0].actorUserId).toBe(admin.id)
  })

  // A duplicate kit code is a database-level violation, which would abort the
  // suite-wide transaction; that path is covered by kits.service.test.ts.

  it('forbids an ENGINEER from editing a kit', async () => {
    expect(createdKitId).not.toBeNull()
    currentSession = sessionFor(engineer)
    expect(await updateKitFormAction(null, form({ ...validFields(), id: createdKitId!, name: 'Hijacked' }))).toMatchObject({ ok: false, error: 'forbidden' })
    expect((await tx.kit.findUniqueOrThrow({ where: { id: createdKitId! } })).name).toBe(validFields().name)
  })

  it('applies membership authorization: VIEWER forbidden, ADMIN adds and the rule engine answers', async () => {
    expect(createdKitId).not.toBeNull()
    const fields = { kitId: createdKitId!, assetId, slotLabel: 'Test slot', isRequired: 'true' }

    currentSession = sessionFor(viewer)
    expect(await addKitAssetFormAction(null, form(fields))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    await expect(addKitAssetFormAction(null, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    const membership = await tx.kitAsset.findFirst({ where: { kitId: createdKitId!, assetId, removedAt: null } })
    expect(membership).toMatchObject({ slotLabel: 'Test slot', isRequired: true })

    // The same equipment again is refused with a message, not a stack trace.
    const duplicate = await addKitAssetFormAction(null, form(fields))
    expect(duplicate).toMatchObject({ ok: false, error: 'rejected', message: expect.stringContaining('already in this kit') })

    // Seeded MBP-02 equipment belongs to another kit.
    const seeded = await tx.asset.findFirstOrThrow({ where: { admBarcode: 'ADM-DEMO-100001' } })
    const elsewhere = await addKitAssetFormAction(null, form({ ...fields, assetId: seeded.id }))
    expect(elsewhere).toMatchObject({ ok: false, error: 'rejected', message: expect.stringContaining('MBP-02') })

    currentSession = sessionFor(engineer)
    expect(await removeKitAssetFormAction(null, form({ kitAssetId: membership!.id }))).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('applies software association authorization: ENGINEER forbidden, ADMIN allowed', async () => {
    expect(createdKitId).not.toBeNull()
    const fields = { kitId: createdKitId!, softwareApplicationId: softwareId, isRequired: 'true' }

    currentSession = sessionFor(engineer)
    expect(await addKitSoftwareFormAction(null, form(fields))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    await expect(addKitSoftwareFormAction(null, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect(await tx.kitSoftware.count({ where: { kitId: createdKitId!, softwareApplicationId: softwareId } })).toBe(1)
  })

  it('applies checklist assignment authorization: VIEWER forbidden, ADMIN allowed and audited', async () => {
    expect(createdKitId).not.toBeNull()
    const fields = { kitId: createdKitId!, templateId }

    currentSession = sessionFor(viewer)
    expect(await setKitChecklistFormAction(null, form(fields))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    await expect(setKitChecklistFormAction(null, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect((await tx.kit.findUniqueOrThrow({ where: { id: createdKitId! } })).defaultChecklistTemplateId).toBe(templateId)
    expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: createdKitId!, action: 'KIT_CHECKLIST_CHANGED' } })).toBe(1)
  })
})
