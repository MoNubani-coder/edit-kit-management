import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import { type SignInMethods, signInWithPassword } from '@/server/auth/authenticate'
import { getLiveHandover } from '@/server/dal/handover.dal'
import { getLiveReturn } from '@/server/dal/return.dal'
import type { Db } from '@/server/db/prisma'
import { addAccessory, createAsset } from '@/server/services/assets.service'
import { createBooking, markReadyForHandover } from '@/server/services/bookings.service'
import { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } from '@/server/services/handover.service'
import { addKitAsset, createKit } from '@/server/services/kits.service'
import { captureReturnSignature, completeReturn, saveReturnChecklist, saveReturnEquipment, startReturn } from '@/server/services/return.service'
import { memorySignatureStore } from '@/server/storage/signature-store'

import { prepareChecklistFor } from '../helpers/checklist'
import { actorFor, createTestUser, testDb, withRollback } from '../helpers/db'
import { FakeDirectory, person } from '../helpers/fake-directory'

/**
 * A directory-backed engineer through the whole workflow.
 *
 * The point is not the workflow - other suites own that - but whose name ends
 * up on it. The person signs in with corporate credentials, and from then on
 * every "who did this" the application records (prepared by, handed over by,
 * the engineer's signature, received by) is the local account that sign-in
 * resolved to, with the display name the directory vouched for. Nothing in a
 * request can change that.
 */

afterAll(async () => {
  await testDb.$disconnect()
})

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const local = (day: number, hour: number) => `2044-02-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`
const store = memorySignatureStore()
const PASSWORD = 'Corporate-Passw0rd!'

/** Signs the directory person in and returns the Actor the application would build for them. */
async function directoryEngineer(tx: Db, displayName: string): Promise<Actor> {
  const t = tag()
  const directory = new FakeDirectory().add(`eng.${t}`, person({ username: `eng.${t}`, id: `guid-${t}`, displayName, email: `eng.${t}@example.test` }))
  const methods: SignInMethods = { localLoginEnabled: true, directory: { client: directory, policy: { autoProvision: true, defaultRole: 'ENGINEER', roleGroups: [] } } }
  const result = await signInWithPassword(tx, { username: `eng.${t}`, password: PASSWORD }, {}, methods)
  if (!result.ok) throw new Error(`sign-in failed: ${result.reason}`)
  // What resolveSession() builds from the session: the local row, nothing from the browser.
  const row = await tx.user.findUniqueOrThrow({ where: { id: result.user.id }, select: { id: true, name: true, email: true, role: true } })
  return { ...row, editorProfileId: null, engineerProfileId: null }
}

async function kitWithOneAsset(tx: Db, actor: Actor) {
  const t = tag()
  const [category, accessoryType] = await Promise.all([
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
    tx.accessoryType.findFirstOrThrow({ where: { code: 'POWER_CABLE' }, select: { id: true } }),
  ])
  const kit = await createKit(tx, actor, { kitCode: `LDP-${t}`, name: `Directory kit ${t}`, admBarcode: `ADM-LDPKIT-${t}`, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  const asset = await createAsset(tx, actor, { name: `Directory asset ${t}`, categoryId: category.id, manufacturer: 'Testco', model: `L-${t}`, serialNumber: `SN-LDP-${t}`, admBarcode: `ADM-LDP-${t}`, location: undefined, notes: undefined, status: 'AVAILABLE' })
  await addAccessory(tx, actor, asset.id, { accessoryTypeId: accessoryType.id, label: 'Power adapter', quantity: 1, serialNumber: undefined, admBarcode: undefined, isRequired: true, notes: undefined })
  await addKitAsset(tx, actor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  return kit
}

describe('a directory-backed engineer', () => {
  it('is the prepared-by, the handing-over engineer, the engineer signature and the receiver, under the directory display name', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN }))
      const engineer = await directoryEngineer(tx, 'Khalid Al Mansoori')
      expect(engineer.role).toBe('ENGINEER')
      const kit = await kitWithOneAsset(tx, admin)

      // Prepared by: the signed-in engineer, whatever the payload might have tried to say.
      const booking = await createBooking(tx, engineer, {
        kitId: kit.id,
        requesterName: 'Layla Haddad',
        requesterMobile: '+971 50 111 2222',
        projectName: 'Directory sign-in test',
        workOrder: 'WO-LDAP-1',
        bookingStart: local(10, 9),
        bookingEnd: local(12, 18),
        collectionDate: undefined,
        expectedReturnDate: local(12, 17),
        purpose: undefined,
        notes: undefined,
        intent: 'reserve',
        // A stray "createdById" in the input is not a field the service reads: the actor is.
        ...({ createdById: admin.id, preparedBy: 'Somebody Else' } as Record<string, unknown>),
      })
      const created = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { createdById: true, engineerId: true, createdBy: { select: { name: true } } } })
      expect(created.createdById).toBe(engineer.id)
      expect(created.createdBy.name).toBe('Khalid Al Mansoori')
      // No engineer profile was nominated and the actor has none, so none is assigned.
      expect(created.engineerId).toBeNull()

      // Handover: the engineer's signature is the session identity.
      await prepareChecklistFor(tx, engineer, booking.id)
      await markReadyForHandover(tx, engineer, booking.id)
      await startHandover(tx, engineer, booking.id)
      const inspection = (await getLiveHandover(tx, booking.id))!
      await saveEquipmentVerification(tx, engineer, booking.id, {
        suitcaseStatus: 'GOOD',
        generalNotes: undefined,
        assets: inspection.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
        accessories: inspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: accessory.quantityExpected, notes: undefined }))),
      })
      await saveChecklistVerification(tx, engineer, booking.id, { checks: inspection.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })), software: [] })
      await captureSignature(tx, engineer, booking.id, 'EDITOR', PNG, store, { recipientName: 'Layla Haddad', recipientMobile: '+971 50 111 2222' })
      // A "recipientName" on the engineer's signature is ignored: the engineer is the actor.
      await captureSignature(tx, engineer, booking.id, 'ENGINEER', PNG, store, { recipientName: 'Somebody Else', recipientMobile: '+971 50 000 0000' })
      await completeHandover(tx, engineer, booking.id)

      const signatures = await tx.signature.findMany({ where: { bookingId: booking.id, voidedAt: null }, select: { type: true, signerName: true, signerUserId: true, signerMobile: true } })
      expect(signatures.find((signature) => signature.type === 'HANDOVER_ENGINEER')).toMatchObject({ signerName: 'Khalid Al Mansoori', signerUserId: engineer.id, signerMobile: null })
      expect(signatures.find((signature) => signature.type === 'HANDOVER_EDITOR')).toMatchObject({ signerName: 'Layla Haddad', signerUserId: null })

      const handover = await tx.inspection.findFirstOrThrow({ where: { bookingId: booking.id, type: 'HANDOVER' }, select: { completedById: true, documentSnapshot: true } })
      expect(handover.completedById).toBe(engineer.id)
      expect((handover.documentSnapshot as { engineer: Record<string, unknown> }).engineer).toMatchObject({ handedOverBy: 'Khalid Al Mansoori', preparedBy: 'Khalid Al Mansoori' })

      // Return: received by the session engineer; who brought it back is typed.
      await startReturn(tx, engineer, booking.id)
      const live = (await getLiveReturn(tx, booking.id))!
      await saveReturnEquipment(tx, engineer, booking.id, {
        suitcaseStatus: 'GOOD',
        generalNotes: undefined,
        assets: live.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
        accessories: live.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: accessory.quantityExpected, notes: undefined }))),
      })
      const withChecks = (await getLiveReturn(tx, booking.id))!
      if (withChecks.checklist.length > 0) await saveReturnChecklist(tx, engineer, booking.id, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
      await captureReturnSignature(tx, engineer, booking.id, 'ENGINEER', PNG, store)
      await completeReturn(tx, engineer, booking.id, 'Layla Haddad')

      const returned = await tx.inspection.findFirstOrThrow({ where: { bookingId: booking.id, type: 'RETURN' }, select: { completedById: true, returnedByName: true, documentSnapshot: true } })
      expect(returned.completedById).toBe(engineer.id)
      expect(returned.returnedByName).toBe('Layla Haddad')
      expect((returned.documentSnapshot as { engineer: Record<string, unknown> }).engineer).toMatchObject({ returnReceivedBy: 'Khalid Al Mansoori' })

      // And every audit row for the flow names the same account.
      const actors = await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: booking.id }, select: { actorUserId: true, actorName: true }, distinct: ['actorUserId'] })
      expect(actors).toEqual([{ actorUserId: engineer.id, actorName: 'Khalid Al Mansoori' }])
    })
  })

  it('carries a refreshed directory display name into the next thing they do', async () => {
    await withRollback(async (tx) => {
      const engineer = await directoryEngineer(tx, 'K. Mansoori')
      const kit = await kitWithOneAsset(tx, engineer)
      const first = await createBooking(tx, engineer, { kitId: kit.id, requesterName: 'A', requesterMobile: '1', projectName: 'P', workOrder: 'W', bookingStart: local(20, 9), bookingEnd: local(21, 18), collectionDate: undefined, expectedReturnDate: local(21, 17), purpose: undefined, notes: undefined, intent: 'draft' })
      expect((await tx.booking.findUniqueOrThrow({ where: { id: first.id }, select: { createdBy: { select: { name: true } } } })).createdBy.name).toBe('K. Mansoori')

      // The directory now says the name differently; the next sign-in refreshes it and the account keeps its id.
      const directory = new FakeDirectory().add(engineer.email.split('@')[0], person({ username: engineer.email.split('@')[0], id: (await tx.account.findFirstOrThrow({ where: { userId: engineer.id } })).providerAccountId, displayName: 'Khalid Al Mansoori', email: engineer.email }))
      const again = await signInWithPassword(tx, { username: engineer.email.split('@')[0], password: PASSWORD }, {}, { localLoginEnabled: true, directory: { client: directory, policy: { autoProvision: false, defaultRole: 'VIEWER', roleGroups: [] } } })
      expect(again).toMatchObject({ ok: true, user: { id: engineer.id, name: 'Khalid Al Mansoori' } })

      // Frozen history keeps the old name; new work carries the new one.
      const renamed = { ...engineer, name: 'Khalid Al Mansoori' }
      const second = await createBooking(tx, renamed, { kitId: kit.id, requesterName: 'B', requesterMobile: '2', projectName: 'P', workOrder: 'W2', bookingStart: local(22, 9), bookingEnd: local(23, 18), collectionDate: undefined, expectedReturnDate: local(23, 17), purpose: undefined, notes: undefined, intent: 'draft' })
      expect((await tx.booking.findUniqueOrThrow({ where: { id: second.id }, select: { createdBy: { select: { name: true } } } })).createdBy.name).toBe('Khalid Al Mansoori')
    })
  })
})
