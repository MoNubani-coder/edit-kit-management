import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import { getKitDetail } from '@/server/dal/kits.dal'
import type { Db } from '@/server/db/prisma'
import { createAsset } from '@/server/services/assets.service'
import { createBooking, markReadyForHandover } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { addKitAsset, createKit, evaluateKitAvailability, kitOperations, removeKit, resolveScannedKit } from '@/server/services/kits.service'
import { kitScanPath, qrSvg } from '@/server/services/qr.service'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'
import { prepareChecklistFor } from '../helpers/checklist'

/**
 * The kit label: what the QR carries, what a scan resolves to, and what the
 * kit page offers once it has. All inside rolled-back transactions.
 *
 * `kitScanUrl` needs a request to know its own origin, so these tests cover
 * the payload through `kitScanPath` - the part that decides what is *in* the
 * code - and render the SVG from it.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const local = (day: number, hour: number) => `2046-04-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`

interface Fixtures {
  admin: TestUser
  actor: Actor
  engineer: Actor
  viewer: Actor
  editor: Actor
  engineerProfileId: string
  categoryId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineerUser = await createTestUser(tx, { role: UserRole.ENGINEER })
  const viewerUser = await createTestUser(tx, { role: UserRole.VIEWER })
  const editorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  const [engineerProfile, category] = await Promise.all([
    tx.engineerProfile.findFirstOrThrow({ select: { id: true } }),
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
  ])
  return {
    admin,
    actor: actorFor(admin),
    engineer: actorFor(engineerUser),
    viewer: actorFor(viewerUser),
    editor: actorFor(editorUser),
    engineerProfileId: engineerProfile.id,
    categoryId: category.id,
  }
}

async function kitWithOneAsset(tx: Db, fx: Fixtures, options: { barcode?: string } = {}) {
  const t = tag()
  const kit = await createKit(tx, fx.actor, {
    kitCode: `QRK-${t}`,
    name: `QR kit ${t}`,
    admBarcode: options.barcode ?? `ADM-QRKIT-${t}`,
    description: undefined,
    location: undefined,
    notes: undefined,
    suitcaseStatus: 'GOOD',
    status: 'AVAILABLE',
  })
  const asset = await createAsset(tx, fx.actor, {
    name: `QR asset ${t}`,
    categoryId: fx.categoryId,
    manufacturer: 'Testco',
    model: 'Q-1',
    serialNumber: `SN-QR-${t}`,
    admBarcode: `ADM-QR-${t}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  return { ...kit, assetId: asset.id, tag: t }
}

async function detail(tx: Db, kitId: string) {
  const kit = (await getKitDetail(tx, kitId, { includeIssues: false }))!
  const availability = evaluateKitAvailability({
    kitId: kit.id,
    kitCode: kit.kitCode,
    status: kit.status,
    isActive: kit.isActive,
    deleted: kit.deletedAt !== null,
    members: kit.members.map((member) => ({
      kitAssetId: member.kitAssetId,
      assetId: member.assetId,
      assetCode: member.assetCode,
      name: member.name,
      slotLabel: member.slotLabel,
      isRequired: member.isRequired,
      status: member.status,
      deleted: member.deleted,
      activeMaintenanceCount: member.activeMaintenanceCount,
    })),
    liveBooking: kit.liveBooking,
  })
  return { kit, availability }
}

let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  countersBefore = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
})

afterAll(async () => {
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'QRK-' } } })).toBe(0)
  await testDb.$disconnect()
})

describe('what the QR carries', () => {
  it('encodes one short path and nothing about the kit or its booking', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)
      const editor = await createEditor(tx, fx.actor, {
        fullName: `QR Editor ${kit.tag}`,
        staffId: undefined,
        email: undefined,
        contactNumber: '+971 50 9 9',
        department: undefined,
        company: 'Freelance',
        type: 'EXTERNAL',
        notes: undefined,
        userId: undefined,
        isActive: true,
      })
      const booking = await createBooking(tx, fx.actor, {
        editorId: editor.id,
        kitId: kit.id,
        engineerId: fx.engineerProfileId,
        bookingStart: local(10, 9),
        bookingEnd: local(12, 18),
        collectionDate: undefined,
        expectedReturnDate: local(12, 17),
        purpose: 'Confidential shoot',
        notes: undefined,
        intent: 'reserve',
      })

      const payload = kitScanPath(kit.id)
      expect(payload).toBe(`/k/${kit.id}`)

      // Nothing readable off a sticker: no code, no barcode, no editor, no
      // booking, no status.
      for (const secret of [kit.kitCode, `ADM-QRKIT-${kit.tag}`, `QR Editor ${kit.tag}`, booking.bookingNumber, 'Confidential shoot', 'RESERVED']) {
        expect(payload, secret).not.toContain(secret)
      }
      // The id is opaque - a cuid, not a guessable sequence.
      expect(payload).toMatch(/^\/k\/[a-z0-9]{20,}$/)

      const svg = await qrSvg(payload)
      expect(svg.startsWith('<?xml') || svg.startsWith('<svg')).toBe(true)
      expect(svg).toContain('</svg>')
      // The SVG is geometry; the payload is not written into it as text.
      expect(svg).not.toContain(kit.id)
      expect(svg).not.toContain(kit.kitCode)
    })
  })

  it('renders a bigger code for the printable label from the same payload', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)

      const small = await qrSvg(kitScanPath(kit.id), { scale: 240 })
      const large = await qrSvg(kitScanPath(kit.id), { scale: 480 })
      expect(small).toContain('width="240"')
      expect(large).toContain('width="480"')

      // The label page needs the kit's own identity alongside it.
      const { kit: row } = await detail(tx, kit.id)
      expect(row.kitCode).toBe(kit.kitCode)
      expect(row.name).toContain('QR kit')
      expect(row.admBarcode).toBe(`ADM-QRKIT-${kit.tag}`)
    })
  })
})

describe('what a scan resolves to', () => {
  it('resolves the kit id, its code and its barcode', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)

      expect(await resolveScannedKit(tx, kit.id)).toMatchObject({ id: kit.id, kitCode: kit.kitCode })
      expect(await resolveScannedKit(tx, kit.kitCode)).toMatchObject({ id: kit.id })
      expect(await resolveScannedKit(tx, kit.kitCode.toLowerCase())).toMatchObject({ id: kit.id })
      expect(await resolveScannedKit(tx, `ADM-QRKIT-${kit.tag}`)).toMatchObject({ id: kit.id })
    })
  })

  it('resolves nothing for an unknown, removed, empty or oversized token', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)

      expect(await resolveScannedKit(tx, 'KIT-DOES-NOT-EXIST')).toBeNull()
      expect(await resolveScannedKit(tx, '')).toBeNull()
      expect(await resolveScannedKit(tx, '   ')).toBeNull()
      expect(await resolveScannedKit(tx, 'x'.repeat(300))).toBeNull()
      // Nothing SQL-ish gets through either: it simply matches no kit.
      expect(await resolveScannedKit(tx, "' OR 1=1 --")).toBeNull()

      // A kit removed from inventory stops answering its own label.
      await tx.kitAsset.updateMany({ where: { kitId: kit.id }, data: { removedAt: new Date() } })
      await removeKit(tx, fx.actor, kit.id)
      expect(await resolveScannedKit(tx, kit.id)).toBeNull()
      expect(await resolveScannedKit(tx, kit.kitCode)).toBeNull()
    })
  })
})

describe('what the kit page offers after a scan', () => {
  it('offers booking a free kit, to someone who may book', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)
      const { kit: row, availability } = await detail(tx, kit.id)

      const forEngineer = kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.engineer })
      expect(forEngineer.map((operation) => operation.key)).toEqual(['book'])
      expect(forEngineer[0].href).toBe(`/bookings/new?kitId=${row.id}`)

      // A viewer may look at the kit but not book it; an editor may not either.
      expect(kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.viewer })).toEqual([])
      expect(kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.editor })).toEqual([])
    })
  })

  it('offers the handover once the kit is set aside, and only to an engineer or admin', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)
      const editor = await createEditor(tx, fx.actor, {
        fullName: `QR Editor ${kit.tag}`,
        staffId: undefined,
        email: undefined,
        contactNumber: '+971 50 9 9',
        department: undefined,
        company: 'Freelance',
        type: 'EXTERNAL',
        notes: undefined,
        userId: undefined,
        isActive: true,
      })
      const booking = await createBooking(tx, fx.actor, {
        editorId: editor.id,
        kitId: kit.id,
        engineerId: fx.engineerProfileId,
        bookingStart: local(10, 9),
        bookingEnd: local(12, 18),
        collectionDate: undefined,
        expectedReturnDate: local(12, 17),
        purpose: undefined,
        notes: undefined,
        intent: 'reserve',
      })

      // Reserved: the booking is worth opening, but there is nothing to hand over yet.
      {
        const { kit: row, availability } = await detail(tx, kit.id)
        const operations = kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.engineer })
        expect(operations.map((operation) => operation.key)).toEqual(['open-booking'])
        expect(operations[0].href).toBe(`/bookings/${booking.id}`)
      }

      await prepareChecklistFor(tx, fx.actor, booking.id)
      await markReadyForHandover(tx, fx.actor, booking.id)

      {
        const { kit: row, availability } = await detail(tx, kit.id)
        const forEngineer = kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.engineer })
        expect(forEngineer.map((operation) => operation.key)).toEqual(['open-booking', 'handover'])
        expect(forEngineer[1].href).toBe(`/bookings/${booking.id}/handover`)

        // A viewer sees the booking; the handover is not theirs to start.
        const forViewer = kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.viewer })
        expect(forViewer.map((operation) => operation.key)).toEqual(['open-booking'])

        // An editor holds booking.readOwn, so the link is offered but the page
        // still scopes it - and no engineer action appears.
        const forEditor = kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.editor })
        expect(forEditor.map((operation) => operation.key)).toEqual(['open-booking'])
      }
    })
  })

  it('offers the return while the kit is out, and nothing at all once it is removed', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)
      const editor = await createEditor(tx, fx.actor, {
        fullName: `QR Editor ${kit.tag}`,
        staffId: undefined,
        email: undefined,
        contactNumber: '+971 50 9 9',
        department: undefined,
        company: 'Freelance',
        type: 'EXTERNAL',
        notes: undefined,
        userId: undefined,
        isActive: true,
      })
      const booking = await createBooking(tx, fx.actor, {
        editorId: editor.id,
        kitId: kit.id,
        engineerId: fx.engineerProfileId,
        bookingStart: local(10, 9),
        bookingEnd: local(12, 18),
        collectionDate: undefined,
        expectedReturnDate: local(12, 17),
        purpose: undefined,
        notes: undefined,
        intent: 'reserve',
      })
      await prepareChecklistFor(tx, fx.actor, booking.id)
      await markReadyForHandover(tx, fx.actor, booking.id)
      // Out, without walking the whole handover: the operations rule reads the
      // booking's status, and this is the state it would be in.
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'CHECKED_OUT', collectionDate: new Date() } })
      await tx.kit.update({ where: { id: kit.id }, data: { status: 'CHECKED_OUT' } })

      const { kit: row, availability } = await detail(tx, kit.id)
      const forEngineer = kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.engineer })
      expect(forEngineer.map((operation) => operation.key)).toEqual(['open-booking', 'return'])
      expect(forEngineer[1].href).toBe(`/bookings/${booking.id}/return`)
      expect(forEngineer[1].label).toMatch(/start return/i)

      // Overdue is the same kit in the same place.
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'OVERDUE' } })
      const overdue = await detail(tx, kit.id)
      expect(kitOperations({ kit: { id: row.id, status: overdue.kit.status, deleted: false }, availability: overdue.availability, liveBooking: overdue.kit.liveBooking, actor: fx.engineer }).map((operation) => operation.key)).toEqual([
        'open-booking',
        'return',
      ])

      // A part-recorded return is continued, not started again.
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'RETURN_INSPECTION' } })
      const inspecting = await detail(tx, kit.id)
      const continuing = kitOperations({ kit: { id: row.id, status: inspecting.kit.status, deleted: false }, availability: inspecting.availability, liveBooking: inspecting.kit.liveBooking, actor: fx.engineer })
      expect(continuing[1].label).toMatch(/continue return/i)

      // And a removed kit offers nothing, whoever is asking.
      expect(kitOperations({ kit: { id: row.id, status: row.status, deleted: true }, availability, liveBooking: row.liveBooking, actor: fx.actor })).toEqual([])
    })
  })

  it('does not offer booking a kit that is free but not fit to go out', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await kitWithOneAsset(tx, fx)
      // Its only required item is damaged: available, but not ready.
      await tx.asset.update({ where: { id: kit.assetId }, data: { status: 'DAMAGED' } })

      const { kit: row, availability } = await detail(tx, kit.id)
      expect(availability.available).toBe(false)
      expect(kitOperations({ kit: { id: row.id, status: row.status, deleted: false }, availability, liveBooking: row.liveBooking, actor: fx.engineer })).toEqual([])
    })
  })
})
