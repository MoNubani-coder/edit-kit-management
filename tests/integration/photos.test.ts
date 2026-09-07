import { randomUUID } from 'node:crypto'

import { InspectionType, UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import { getBookingPhotos, getInspectionPhotos, getPhotoFileInternal } from '@/server/dal/attachments.dal'
import { getLiveHandover } from '@/server/dal/handover.dal'
import { getLiveReturn } from '@/server/dal/return.dal'
import type { Db } from '@/server/db/prisma'
import { addAccessory, createAsset } from '@/server/services/assets.service'
import { createBooking, loadBookingWorkspace, markReadyForHandover } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } from '@/server/services/handover.service'
import { addKitAsset, addKitSoftware, createKit } from '@/server/services/kits.service'
import { addInspectionPhoto, PHOTO_LIMIT_PER_INSPECTION } from '@/server/services/photos.service'
import { captureReturnSignature, completeReturn, saveReturnChecklist, saveReturnEquipment, startReturn } from '@/server/services/return.service'
import { memoryPhotoStore } from '@/server/storage/photo-store'
import { memorySignatureStore } from '@/server/storage/signature-store'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'

/**
 * Optional photo evidence, against the real database inside rolled-back
 * transactions. Photo bytes go to an in-memory store, so nothing reaches the
 * disk and the rollback leaves no attachment, inspection or file behind.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const PNG_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 9)])
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256, 9)])
const local = (day: number, hour: number) => `2044-05-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`

const photoFile = (bytes: Buffer, name = 'case.jpg', type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type })
const signatures = memorySignatureStore()

interface Fixtures {
  admin: TestUser
  actor: Actor
  engineerUser: TestUser
  engineer: Actor
  engineerProfileId: string
  categoryId: string
  softwareId: string
  accessoryTypeId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineerUser = await createTestUser(tx, { role: UserRole.ENGINEER })
  const [engineer, category, software, accessoryType] = await Promise.all([
    tx.engineerProfile.findFirstOrThrow({ select: { id: true } }),
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
    tx.softwareApplication.findFirstOrThrow({ where: { deletedAt: null, isActive: true }, select: { id: true } }),
    tx.accessoryType.findFirstOrThrow({ where: { code: 'POWER_CABLE' }, select: { id: true } }),
  ])
  return {
    admin,
    actor: actorFor(admin),
    engineerUser,
    engineer: actorFor(engineerUser),
    engineerProfileId: engineer.id,
    categoryId: category.id,
    softwareId: software.id,
    accessoryTypeId: accessoryType.id,
  }
}

/** A booking with an open handover, and optionally taken all the way out. */
async function scenario(tx: Db, fx: Fixtures, options: { stage: 'handover-open' | 'checked-out' | 'return-open' }) {
  const t = tag()
  const kit = await createKit(tx, fx.actor, { kitCode: `PHO-${t}`, name: `Photo kit ${t}`, admBarcode: `ADM-PHOKIT-${t}`, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  const asset = await createAsset(tx, fx.actor, {
    name: `Photo asset ${t}`,
    categoryId: fx.categoryId,
    manufacturer: 'Testco',
    model: 'P-1',
    serialNumber: `SN-PHO-${t}`,
    admBarcode: `ADM-PHO-${t}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  await addAccessory(tx, fx.actor, asset.id, { accessoryTypeId: fx.accessoryTypeId, label: 'Adapter', quantity: 1, serialNumber: undefined, admBarcode: undefined, isRequired: true, notes: undefined })
  await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })

  const editor = await createEditor(tx, fx.actor, {
    fullName: `Photo Editor ${t}`,
    staffId: undefined,
    email: undefined,
    contactNumber: '+971 50 444 5555',
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
    bookingEnd: local(14, 18),
    collectionDate: undefined,
    expectedReturnDate: local(14, 17),
    purpose: 'Photo evidence test',
    notes: undefined,
    intent: 'reserve',
  })
  await markReadyForHandover(tx, fx.actor, booking.id)
  await startHandover(tx, fx.engineer, booking.id)
  if (options.stage === 'handover-open') return { bookingId: booking.id, kitId: kit.id, assetId: asset.id }

  const handover = (await getLiveHandover(tx, booking.id))!
  await saveEquipmentVerification(tx, fx.engineer, booking.id, {
    suitcaseStatus: 'GOOD',
    generalNotes: undefined,
    assets: handover.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
    accessories: handover.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
  })
  await saveChecklistVerification(tx, fx.engineer, booking.id, {
    checks: handover.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
    software: handover.software.map((check) => ({ id: check.id, status: 'INSTALLED' as const, installedVersion: '2025', notes: undefined })),
  })
  await captureSignature(tx, fx.engineer, booking.id, 'EDITOR', PNG_SIGNATURE, signatures)
  await captureSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG_SIGNATURE, signatures)
  await completeHandover(tx, fx.engineer, booking.id)
  if (options.stage === 'checked-out') return { bookingId: booking.id, kitId: kit.id, assetId: asset.id }

  await startReturn(tx, fx.engineer, booking.id)
  return { bookingId: booking.id, kitId: kit.id, assetId: asset.id }
}

let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  countersBefore = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
})

afterAll(async () => {
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'PHO-' } } })).toBe(0)
  expect(await testDb.attachment.count({ where: { booking: { kit: { kitCode: { startsWith: 'PHO-' } } } } })).toBe(0)
  await testDb.$disconnect()
})

describe('adding a photo', () => {
  it('stores a handover photo with metadata and an audit line', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'handover-open' })

      const photo = await addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(JPEG_BYTES, 'case front.jpg'), caption: 'Packed case' }, store)

      const inspection = (await getLiveHandover(tx, s.bookingId))!
      const photos = await getInspectionPhotos(tx, inspection.id)
      expect(photos).toHaveLength(1)
      expect(photos[0]).toMatchObject({ id: photo.id, mimeType: 'image/jpeg', caption: 'Packed case', uploadedByName: fx.engineerUser.name, inspectionType: 'HANDOVER' })
      // The client's spaces are gone from the display name, and the stored
      // name is not the client's at all.
      expect(photos[0].fileName).toBe('case_front.jpg')
      expect(store.files.size).toBe(1)
      expect([...store.files.keys()][0]).toMatch(/^photos\//)

      // Nothing about where it lives leaves the DAL.
      expect(JSON.stringify(photos)).not.toMatch(/storagePath|sha256|photos\//)

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'Booking', entityId: s.bookingId, action: 'FILE_UPLOADED' }, select: { summary: true } })
      expect(audit?.summary).toMatch(/handover photo added/i)
    })
  })

  it('stores a return photo without touching the handover evidence', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'handover-open' })

      const handover = (await getLiveHandover(tx, s.bookingId))!
      await addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(JPEG_BYTES), caption: 'At handover' }, store)

      // Take the booking out and open the return.
      await saveEquipmentVerification(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'GOOD',
        generalNotes: undefined,
        assets: handover.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
        accessories: handover.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
      })
      await saveChecklistVerification(tx, fx.engineer, s.bookingId, {
        checks: handover.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
        software: handover.software.map((check) => ({ id: check.id, status: 'INSTALLED' as const, installedVersion: '2025', notes: undefined })),
      })
      await captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG_SIGNATURE, signatures)
      await captureSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG_SIGNATURE, signatures)
      await completeHandover(tx, fx.engineer, s.bookingId)
      await startReturn(tx, fx.engineer, s.bookingId)

      const returnInspection = (await getLiveReturn(tx, s.bookingId))!
      await addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.RETURN, file: photoFile(PNG_BYTES, 'damage.png', 'image/png'), caption: 'Scratched lid' }, store)

      // Each inspection keeps its own evidence.
      const handoverPhotos = await getInspectionPhotos(tx, handover.id)
      const returnPhotos = await getInspectionPhotos(tx, returnInspection.id)
      expect(handoverPhotos).toHaveLength(1)
      expect(handoverPhotos[0].caption).toBe('At handover')
      expect(returnPhotos).toHaveLength(1)
      expect(returnPhotos[0].mimeType).toBe('image/png')

      // And the booking sees both, labelled by phase.
      const all = await getBookingPhotos(tx, s.bookingId)
      expect(all.map((photo) => photo.inspectionType)).toEqual(['HANDOVER', 'RETURN'])

      // Completing the return leaves the handover's photo exactly where it was.
      await saveReturnEquipment(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'MINOR_DAMAGE',
        generalNotes: 'Lid scratched',
        assets: returnInspection.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
        accessories: returnInspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
      })
      const withChecks = (await getLiveReturn(tx, s.bookingId))!
      if (withChecks.checklist.length > 0) {
        await saveReturnChecklist(tx, fx.engineer, s.bookingId, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
      }
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG_SIGNATURE, signatures)
      await completeReturn(tx, fx.engineer, s.bookingId)

      const afterReturn = await getInspectionPhotos(tx, handover.id)
      expect(afterReturn).toHaveLength(1)
      expect(afterReturn[0].id).toBe(handoverPhotos[0].id)
      expect(afterReturn[0].caption).toBe('At handover')
    })
  })

  it('is optional: both workflows complete with no photos at all', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'return-open' })

      const returnInspection = (await getLiveReturn(tx, s.bookingId))!
      expect(await getInspectionPhotos(tx, returnInspection.id)).toEqual([])

      await saveReturnEquipment(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'GOOD',
        generalNotes: undefined,
        assets: returnInspection.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
        accessories: returnInspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
      })
      const withChecks = (await getLiveReturn(tx, s.bookingId))!
      if (withChecks.checklist.length > 0) {
        await saveReturnChecklist(tx, fx.engineer, s.bookingId, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
      }
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG_SIGNATURE, signatures)

      // No photo, no obstacle.
      await expect(completeReturn(tx, fx.engineer, s.bookingId)).resolves.toMatchObject({ kitStatus: 'AVAILABLE' })
      expect(await getBookingPhotos(tx, s.bookingId)).toEqual([])
    })
  })
})

describe('what an upload refuses', () => {
  it('refuses a file that is not an image, and stores nothing', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'handover-open' })

      await expect(
        addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(Buffer.from('%PDF-1.7', 'utf8'), 'report.pdf', 'application/pdf') }, store),
      ).rejects.toMatchObject({ code: 'validation' })

      // A PDF wearing a .jpg name and an image content type is still refused.
      await expect(
        addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(Buffer.from('%PDF-1.7', 'utf8'), 'evidence.jpg', 'image/jpeg') }, store),
      ).rejects.toMatchObject({ code: 'validation' })

      expect(store.files.size).toBe(0)
      const inspection = (await getLiveHandover(tx, s.bookingId))!
      expect(await getInspectionPhotos(tx, inspection.id)).toEqual([])
    })
  })

  it('refuses an oversized photo', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'handover-open' })

      const huge = Buffer.concat([PNG_BYTES, Buffer.alloc(9 * 1024 * 1024, 1)])
      await expect(addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(huge, 'huge.png', 'image/png') }, store)).rejects.toMatchObject({
        code: 'validation',
      })
      expect(store.files.size).toBe(0)
    })
  })

  it('cannot escape the store with a hostile filename', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'handover-open' })

      await addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(JPEG_BYTES, '../../../../etc/passwd') }, store)

      const inspection = (await getLiveHandover(tx, s.bookingId))!
      const [photo] = await getInspectionPhotos(tx, inspection.id)
      // The client's name became a harmless label...
      expect(photo.fileName).toBe('passwd')
      // ...and the stored path is generated, inside the store, with no climbing.
      const stored = await getPhotoFileInternal(tx, photo.id)
      expect(stored?.storagePath.startsWith('photos/')).toBe(true)
      expect(stored?.storagePath).not.toContain('..')
      expect(stored?.storagePath).toContain(s.bookingId)
    })
  })

  it('refuses to add evidence to an inspection that is already frozen', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'checked-out' })

      // The handover is complete: its evidence is part of the frozen document.
      await expect(addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(JPEG_BYTES) }, store)).rejects.toMatchObject({ code: 'lifecycle' })

      // And a return that has not started has nothing to attach to.
      await expect(addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.RETURN, file: photoFile(JPEG_BYTES) }, store)).rejects.toThrow(/has not been started/i)
      expect(store.files.size).toBe(0)
    })
  })

  it('stops at the per-inspection limit', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'handover-open' })

      for (let index = 0; index < PHOTO_LIMIT_PER_INSPECTION; index += 1) {
        await addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(JPEG_BYTES, `shot-${index}.jpg`) }, store)
      }
      await expect(addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(JPEG_BYTES, 'one-too-many.jpg') }, store)).rejects.toMatchObject({
        code: 'validation',
      })
      expect(store.files.size).toBe(PHOTO_LIMIT_PER_INSPECTION)
    })
  })
})

describe('the booking page', () => {
  it('carries photo metadata and never a storage path', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memoryPhotoStore()
      const s = await scenario(tx, fx, { stage: 'handover-open' })
      await addInspectionPhoto(tx, fx.engineer, { bookingId: s.bookingId, type: InspectionType.HANDOVER, file: photoFile(JPEG_BYTES, 'front.jpg'), caption: 'Front' }, store)

      const workspace = (await loadBookingWorkspace(tx, fx.actor, s.bookingId))!
      expect(workspace.photos).toHaveLength(1)
      expect(workspace.photos[0].caption).toBe('Front')
      expect(JSON.stringify(workspace)).not.toMatch(/storagePath|sha256|imagePath|imageHash/)
    })
  })
})
