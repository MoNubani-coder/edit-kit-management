import { randomUUID } from 'node:crypto'

import { IssueStatus, UserRole, UserStatus } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ISSUE_DEFAULT_PAGE_SIZE, type IssueListParams } from '@/lib/validation/issues'
import type { Actor } from '@/server/auth/session'
import { countIssuesByFilter, getIssueActivity, getIssueDetail, listIssuesPage } from '@/server/dal/issues.dal'
import type { Db } from '@/server/db/prisma'
import { createAsset, addAccessory } from '@/server/services/assets.service'
import { createBooking, markReadyForHandover } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } from '@/server/services/handover.service'
import {
  assignIssue,
  canTransitionIssue,
  closeIssue,
  createIssue,
  isIssueEditable,
  issuePermissionsFor,
  loadIssueWorkspace,
  reopenIssue,
  resolveIssue,
  startInvestigation,
  updateIssue,
} from '@/server/services/issues.service'
import { addKitAsset, addKitSoftware, createKit } from '@/server/services/kits.service'
import { getLiveHandover } from '@/server/dal/handover.dal'
import { getLiveReturn } from '@/server/dal/return.dal'
import { captureReturnSignature, completeReturn, saveReturnChecklist, saveReturnEquipment, startReturn } from '@/server/services/return.service'
import { memorySignatureStore } from '@/server/storage/signature-store'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'
import { prepareChecklistFor } from '../helpers/checklist'

/**
 * Issue management against the real database, inside rolled-back transactions.
 *
 * Two things are being checked: the lifecycle on its own (report, pick up,
 * resolve, close, reopen, and every refusal in between), and the join with
 * Phase 9 - that a return which records a missing item produces an issue this
 * service can then work, with its links intact.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const local = (day: number, hour: number) => `2047-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`
const signatures = memorySignatureStore()

const LIST: IssueListParams = { filter: 'all', sort: 'reportedAt', dir: 'desc', page: 1, pageSize: ISSUE_DEFAULT_PAGE_SIZE }

interface Fixtures {
  admin: TestUser
  actor: Actor
  engineerUser: TestUser
  engineer: Actor
  viewer: Actor
  editor: Actor
  engineerProfileId: string
  categoryId: string
  softwareId: string
  accessoryTypeId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineerUser = await createTestUser(tx, { role: UserRole.ENGINEER })
  const viewerUser = await createTestUser(tx, { role: UserRole.VIEWER })
  const editorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  const [engineerProfile, category, software, accessoryType] = await Promise.all([
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
    viewer: actorFor(viewerUser),
    editor: actorFor(editorUser),
    engineerProfileId: engineerProfile.id,
    categoryId: category.id,
    softwareId: software.id,
    accessoryTypeId: accessoryType.id,
  }
}

async function makeAsset(tx: Db, fx: Fixtures, label = 'Issue asset') {
  const t = tag()
  return createAsset(tx, fx.actor, {
    name: `${label} ${t}`,
    categoryId: fx.categoryId,
    manufacturer: 'Testco',
    model: 'I-1',
    serialNumber: `SN-ISS-${t}`,
    admBarcode: `ADM-ISS-${t}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
}

async function makeKit(tx: Db, fx: Fixtures) {
  const t = tag()
  return createKit(tx, fx.actor, {
    kitCode: `ISK-${t}`,
    name: `Issue kit ${t}`,
    admBarcode: `ADM-ISK-${t}`,
    description: undefined,
    location: undefined,
    notes: undefined,
    suitcaseStatus: 'GOOD',
    status: 'AVAILABLE',
  })
}

/** A booking taken all the way out, so a return can raise a real issue. */
async function checkedOut(tx: Db, fx: Fixtures) {
  const kit = await makeKit(tx, fx)
  const asset = await makeAsset(tx, fx, 'Return issue asset')
  await addAccessory(tx, fx.actor, asset.id, { accessoryTypeId: fx.accessoryTypeId, label: 'Adapter', quantity: 1, serialNumber: undefined, admBarcode: undefined, isRequired: true, notes: undefined })
  await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })

  const editor = await createEditor(tx, fx.actor, {
    fullName: `Issue Editor ${tag()}`,
    staffId: undefined,
    email: undefined,
    contactNumber: '+971 50 555 6666',
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
    purpose: 'Issue test',
    notes: undefined,
    intent: 'reserve',
  })
  await prepareChecklistFor(tx, fx.actor, booking.id)
  await markReadyForHandover(tx, fx.actor, booking.id)
  await startHandover(tx, fx.engineer, booking.id)
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
  await captureSignature(tx, fx.engineer, booking.id, 'EDITOR', PNG, signatures)
  await captureSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, signatures)
  await completeHandover(tx, fx.engineer, booking.id)
  return { bookingId: booking.id, bookingNumber: booking.bookingNumber, kitId: kit.id, kitCode: kit.kitCode, assetId: asset.id, assetCode: asset.assetCode }
}

let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  countersBefore = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
})

afterAll(async () => {
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'ISK-' } } })).toBe(0)
  expect(await testDb.issue.count({ where: { title: { startsWith: 'ISSUE-TEST' } } })).toBe(0)
  await testDb.$disconnect()
})

describe('reporting an issue by hand', () => {
  it('numbers it, links it and records who reported it', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const asset = await makeAsset(tx, fx)
      const kit = await makeKit(tx, fx)

      const created = await createIssue(tx, fx.engineer, {
        type: 'DAMAGED',
        severity: 'HIGH',
        title: `ISSUE-TEST cracked panel ${tag()}`,
        description: 'Bottom-left corner of the panel is cracked; the display still works.',
        assetId: asset.id,
        kitId: kit.id,
        bookingId: undefined,
        accessoryId: undefined,
        assignedToId: undefined,
      })

      expect(created.issueNumber).toMatch(/^ISS-\d{4}-\d{6}$/)

      const detail = (await getIssueDetail(tx, created.id))!
      expect(detail).toMatchObject({ status: 'OPEN', type: 'DAMAGED', severity: 'HIGH', resolution: null, resolvedAt: null, closedAt: null })
      expect(detail.asset?.assetCode).toBe(asset.assetCode)
      expect(detail.kit?.kitCode).toBe(kit.kitCode)
      expect(detail.reportedBy?.name).toBe(fx.engineerUser.name)
      expect(detail.assignedTo).toBeNull()
      expect(detail.inspection).toBeNull()
      expect(detail.photos).toEqual([])

      const activity = await getIssueActivity(tx, created.id)
      expect(activity).toHaveLength(1)
      expect(activity[0].title).toContain(created.issueNumber)
      expect(activity[0].action).toBe('ISSUE_CREATED')

      // Reporting a problem does not change the equipment's status - that is a
      // separate, deliberate decision.
      expect((await tx.asset.findUniqueOrThrow({ where: { id: asset.id }, select: { status: true } })).status).toBe('AVAILABLE')
      expect((await tx.kit.findUniqueOrThrow({ where: { id: kit.id }, select: { status: true } })).status).toBe('AVAILABLE')
    })
  })

  it('takes the asset from the accessory when only the accessory is named, and refuses links that do not exist', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const asset = await makeAsset(tx, fx)
      const accessory = await addAccessory(tx, fx.actor, asset.id, {
        accessoryTypeId: fx.accessoryTypeId,
        label: 'Power adapter',
        quantity: 1,
        serialNumber: undefined,
        admBarcode: undefined,
        isRequired: true,
        notes: undefined,
      })

      const created = await createIssue(tx, fx.engineer, {
        type: 'MISSING',
        severity: 'LOW',
        title: `ISSUE-TEST adapter gone ${tag()}`,
        description: 'The adapter is not in the case.',
        accessoryId: accessory.id,
        assetId: undefined,
        kitId: undefined,
        bookingId: undefined,
        assignedToId: undefined,
      })

      const detail = (await getIssueDetail(tx, created.id))!
      expect(detail.accessory?.label).toBe('Power adapter')
      // The accessory belongs to an asset, so the issue shows up there too.
      expect(detail.asset?.id).toBe(asset.id)

      for (const bad of [{ assetId: 'no-such-asset' }, { kitId: 'no-such-kit' }, { bookingId: 'no-such-booking' }, { accessoryId: 'no-such-accessory' }]) {
        await expect(
          createIssue(tx, fx.engineer, {
            type: 'OTHER',
            severity: 'LOW',
            title: `ISSUE-TEST bad link ${tag()}`,
            description: 'Should not be created.',
            assetId: undefined,
            kitId: undefined,
            bookingId: undefined,
            accessoryId: undefined,
            assignedToId: undefined,
            ...bad,
          }),
        ).rejects.toMatchObject({ code: 'validation' })
      }
    })
  })

  it('refuses an assignee who cannot work an issue', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const viewerUser = await createTestUser(tx, { role: UserRole.VIEWER, tag: 'assignee' })
      const suspended = await createTestUser(tx, { role: UserRole.ENGINEER, status: UserStatus.SUSPENDED, tag: 'suspended' })

      const base = {
        type: 'OTHER' as const,
        severity: 'LOW' as const,
        title: `ISSUE-TEST assignee ${tag()}`,
        description: 'Checking who may own an issue.',
        assetId: undefined,
        kitId: undefined,
        bookingId: undefined,
        accessoryId: undefined,
      }

      // A viewer cannot work issues, and a suspended account cannot work anything.
      await expect(createIssue(tx, fx.engineer, { ...base, assignedToId: viewerUser.id })).rejects.toMatchObject({ code: 'validation' })
      await expect(createIssue(tx, fx.engineer, { ...base, assignedToId: suspended.id })).rejects.toMatchObject({ code: 'validation' })

      // An engineer may.
      const created = await createIssue(tx, fx.engineer, { ...base, assignedToId: fx.engineerUser.id })
      expect((await getIssueDetail(tx, created.id))!.assignedTo?.name).toBe(fx.engineerUser.name)
    })
  })
})

describe('working an issue', () => {
  async function open(tx: Db, fx: Fixtures) {
    const asset = await makeAsset(tx, fx)
    return createIssue(tx, fx.engineer, {
      type: 'MALFUNCTION',
      severity: 'MEDIUM',
      title: `ISSUE-TEST fan noise ${tag()}`,
      description: 'The fan is loud under load.',
      assetId: asset.id,
      kitId: undefined,
      bookingId: undefined,
      accessoryId: undefined,
      assignedToId: undefined,
    })
  }

  it('runs open → investigating → resolved → closed, recording each step', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const issue = await open(tx, fx)

      await startInvestigation(tx, fx.engineer, issue.id, { note: 'On the bench now' })
      let detail = (await getIssueDetail(tx, issue.id))!
      expect(detail.status).toBe('UNDER_INVESTIGATION')
      // Picking up an unowned issue puts the picker's name on it.
      expect(detail.assignedTo?.name).toBe(fx.engineerUser.name)

      await resolveIssue(tx, fx.engineer, issue.id, { resolution: 'Cleaned the fan and reseated the heatsink.' })
      detail = (await getIssueDetail(tx, issue.id))!
      expect(detail.status).toBe('RESOLVED')
      expect(detail.resolution).toContain('Cleaned the fan')
      expect(detail.resolvedAt).toBeInstanceOf(Date)
      expect(detail.resolvedBy?.name).toBe(fx.engineerUser.name)
      expect(detail.closedAt).toBeNull()

      await closeIssue(tx, fx.actor, issue.id, { resolution: undefined })
      detail = (await getIssueDetail(tx, issue.id))!
      expect(detail.status).toBe('CLOSED')
      expect(detail.closedAt).toBeInstanceOf(Date)
      // Closing a resolved issue keeps the resolution that was recorded.
      expect(detail.resolution).toContain('Cleaned the fan')

      const activity = await getIssueActivity(tx, issue.id)
      const actions = activity.map((event) => event.action)
      expect(actions).toEqual(['ISSUE_CLOSED', 'ISSUE_RESOLVED', 'ISSUE_UPDATED', 'ISSUE_CREATED'])
      expect(activity[0].detail).toBe('Closed')
    })
  })

  it('insists on a reason when closing something that was never fixed', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const issue = await open(tx, fx)

      await expect(closeIssue(tx, fx.engineer, issue.id, { resolution: undefined })).rejects.toMatchObject({ code: 'validation' })
      expect((await getIssueDetail(tx, issue.id))!.status).toBe('OPEN')

      await closeIssue(tx, fx.engineer, issue.id, { resolution: 'Reported in error - the noise was the other machine.' })
      const detail = (await getIssueDetail(tx, issue.id))!
      expect(detail.status).toBe('CLOSED')
      expect(detail.resolution).toContain('Reported in error')
      // Whoever decided it was nothing is on the record.
      expect(detail.resolvedBy?.name).toBe(fx.engineerUser.name)

      const activity = await getIssueActivity(tx, issue.id)
      expect(activity[0].detail).toBe('Closed without a fix')
    })
  })

  it('reopens a closed issue and keeps what was said before', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const issue = await open(tx, fx)
      await resolveIssue(tx, fx.engineer, issue.id, { resolution: 'Replaced the fan.' })
      await closeIssue(tx, fx.engineer, issue.id, {})

      await reopenIssue(tx, fx.actor, issue.id, { reason: 'The same noise came back on the next hand-out.' })
      const detail = (await getIssueDetail(tx, issue.id))!
      expect(detail.status).toBe('OPEN')
      expect(detail.resolvedAt).toBeNull()
      expect(detail.closedAt).toBeNull()
      // The previous resolution stays as history.
      expect(detail.resolution).toBe('Replaced the fan.')

      const activity = await getIssueActivity(tx, issue.id)
      expect(activity[0].detail).toBe('Reopened')
      expect(activity[0].title).toContain('came back')
    })
  })

  it('refuses steps the lifecycle does not allow', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const issue = await open(tx, fx)

      await resolveIssue(tx, fx.engineer, issue.id, { resolution: 'Done.' })
      // A resolved issue is not picked up again without reopening it.
      await expect(startInvestigation(tx, fx.engineer, issue.id)).rejects.toMatchObject({ code: 'lifecycle' })

      await closeIssue(tx, fx.engineer, issue.id, {})
      await expect(resolveIssue(tx, fx.engineer, issue.id, { resolution: 'Again.' })).rejects.toMatchObject({ code: 'lifecycle' })
      await expect(closeIssue(tx, fx.engineer, issue.id, {})).rejects.toMatchObject({ code: 'lifecycle' })
      // Nor edited, nor reassigned, while it is closed.
      await expect(updateIssue(tx, fx.engineer, issue.id, { type: 'OTHER', severity: 'LOW', title: 'ISSUE-TEST edited', description: 'Should be refused.' })).rejects.toMatchObject({
        code: 'lifecycle',
      })
      await expect(assignIssue(tx, fx.engineer, issue.id, { assignedToId: fx.engineerUser.id })).rejects.toMatchObject({ code: 'lifecycle' })

      await expect(startInvestigation(tx, fx.engineer, 'no-such-issue')).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('corrects the details and moves the owner while it is still live', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const issue = await open(tx, fx)

      await updateIssue(tx, fx.actor, issue.id, { type: 'DAMAGED', severity: 'CRITICAL', title: 'ISSUE-TEST worse than thought', description: 'The bearing has gone.' })
      let detail = (await getIssueDetail(tx, issue.id))!
      expect(detail).toMatchObject({ type: 'DAMAGED', severity: 'CRITICAL', title: 'ISSUE-TEST worse than thought' })

      await assignIssue(tx, fx.actor, issue.id, { assignedToId: fx.engineerUser.id })
      detail = (await getIssueDetail(tx, issue.id))!
      expect(detail.assignedTo?.name).toBe(fx.engineerUser.name)

      // Assigning it to nobody is a real choice, and audited.
      await assignIssue(tx, fx.actor, issue.id, { assignedToId: undefined })
      expect((await getIssueDetail(tx, issue.id))!.assignedTo).toBeNull()

      const activity = await getIssueActivity(tx, issue.id)
      expect(activity.filter((event) => event.detail === 'Unassigned')).toHaveLength(1)
      expect(activity.some((event) => event.title.includes('severity medium → critical'))).toBe(true)
    })
  })
})

describe('the issues a return raises', () => {
  it('picks up where Phase 9 left off, with the links intact', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await checkedOut(tx, fx)

      // Return the kit with its only item missing: Phase 9 raises the issues.
      await startReturn(tx, fx.engineer, s.bookingId)
      const inspection = (await getLiveReturn(tx, s.bookingId))!
      await saveReturnEquipment(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'GOOD',
        generalNotes: 'Case came back light',
        assets: inspection.lines.map((line) => ({ id: line.id, status: 'MISSING' as const, notes: 'Not in the case' })),
        accessories: inspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'MISSING' as const, quantityReceived: 0, notes: undefined }))),
      })
      const withChecks = (await getLiveReturn(tx, s.bookingId))!
      if (withChecks.checklist.length > 0) {
        await saveReturnChecklist(tx, fx.engineer, s.bookingId, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
      }
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, signatures)
      const completed = await completeReturn(tx, fx.engineer, s.bookingId)
      expect(completed.issueNumbers).toHaveLength(2)

      // Both appear in the list, pointing at the equipment, kit and booking.
      const page = await listIssuesPage(tx, fx.engineer.id, { ...LIST, q: s.assetCode })
      expect(page.rows.length).toBeGreaterThanOrEqual(1)
      const raised = page.rows[0]
      expect(raised.status).toBe('OPEN')
      expect(raised.assetCode).toBe(s.assetCode)
      expect(raised.kitCode).toBe(s.kitCode)
      expect(raised.bookingNumber).toBe(s.bookingNumber)

      const detail = (await getIssueDetail(tx, raised.id))!
      expect(detail.inspection?.type).toBe('RETURN')
      expect(detail.booking?.bookingNumber).toBe(s.bookingNumber)
      expect(detail.reportedBy?.name).toBe(fx.engineerUser.name)

      // And it can be worked from there like any other.
      await startInvestigation(tx, fx.engineer, raised.id)
      await resolveIssue(tx, fx.engineer, raised.id, { resolution: 'Editor found it in their car and returned it.' })
      expect((await getIssueDetail(tx, raised.id))!.status).toBe('RESOLVED')

      // Resolving does not put a missing asset back into service by itself.
      expect((await tx.asset.findUniqueOrThrow({ where: { id: s.assetId }, select: { status: true } })).status).toBe('MISSING')
    })
  })
})

describe('finding issues', () => {
  it('filters, counts, searches, sorts and pages', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const before = await countIssuesByFilter(tx, fx.engineer.id)
      const asset = await makeAsset(tx, fx)
      const marker = tag()

      const make = async (severity: 'LOW' | 'CRITICAL', title: string) =>
        createIssue(tx, fx.engineer, {
          type: 'DAMAGED',
          severity,
          title: `ISSUE-TEST ${marker} ${title}`,
          description: `Something about ${marker}.`,
          assetId: asset.id,
          kitId: undefined,
          bookingId: undefined,
          accessoryId: undefined,
          assignedToId: undefined,
        })

      const low = await make('LOW', 'scuffed lid')
      const critical = await make('CRITICAL', 'will not power on')
      const resolved = await make('LOW', 'loose screw')
      const mine = await make('LOW', 'assigned to me')

      await resolveIssue(tx, fx.engineer, resolved.id, { resolution: 'Tightened.' })
      await assignIssue(tx, fx.actor, mine.id, { assignedToId: fx.engineerUser.id })

      const ids = async (query: Partial<IssueListParams>) => (await listIssuesPage(tx, fx.engineer.id, { ...LIST, q: marker, ...query })).rows.map((row) => row.id)

      expect((await ids({ filter: 'all' })).sort()).toEqual([low.id, critical.id, resolved.id, mine.id].sort())
      expect((await ids({ filter: 'open' })).sort()).toEqual([low.id, critical.id, mine.id].sort())
      expect(await ids({ filter: 'resolved' })).toEqual([resolved.id])
      expect(await ids({ filter: 'critical' })).toEqual([critical.id])
      expect(await ids({ filter: 'mine' })).toEqual([mine.id])
      expect(await ids({ filter: 'closed' })).toEqual([])

      // Search reaches the number, the title and the equipment behind it.
      expect(await ids({ q: critical.issueNumber })).toEqual([critical.id])
      expect(await ids({ q: 'will not power on' })).toEqual([critical.id])
      expect((await listIssuesPage(tx, fx.engineer.id, { ...LIST, q: asset.assetCode })).rows.length).toBeGreaterThanOrEqual(4)

      // Severity sorts by the enum's own order, so critical can be brought up.
      const bySeverity = await listIssuesPage(tx, fx.engineer.id, { ...LIST, q: marker, sort: 'severity', dir: 'desc' })
      expect(bySeverity.rows[0].id).toBe(critical.id)

      const page1 = await listIssuesPage(tx, fx.engineer.id, { ...LIST, q: marker, pageSize: 2, page: 1 })
      const page2 = await listIssuesPage(tx, fx.engineer.id, { ...LIST, q: marker, pageSize: 2, page: 2 })
      expect(page1).toMatchObject({ total: 4, pageCount: 2 })
      expect(page1.rows).toHaveLength(2)
      expect(page2.rows).toHaveLength(2)

      const after = await countIssuesByFilter(tx, fx.engineer.id)
      expect(after.all - before.all).toBe(4)
      expect(after.open - before.open).toBe(3)
      expect(after.resolved - before.resolved).toBe(1)
      expect(after.critical - before.critical).toBe(1)
      expect(after.mine - before.mine).toBe(1)

      // Nothing about storage or internals leaves the DAL.
      expect(JSON.stringify(page1.rows)).not.toMatch(/storagePath|sha256|passwordHash/)
    })
  })
})

describe('who may do what', () => {
  it('lets engineers and admins work an issue, and gives a viewer nothing to press', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const asset = await makeAsset(tx, fx)
      const issue = await createIssue(tx, fx.engineer, {
        type: 'DAMAGED',
        severity: 'HIGH',
        title: `ISSUE-TEST permissions ${tag()}`,
        description: 'Checking what each role is offered.',
        assetId: asset.id,
        kitId: undefined,
        bookingId: undefined,
        accessoryId: undefined,
        assignedToId: undefined,
      })

      const forEngineer = (await loadIssueWorkspace(tx, fx.engineer, issue.id))!
      expect(forEngineer.permissions).toMatchObject({ canReport: true, canManage: true, canAddPhoto: true })
      expect(forEngineer.nextStatuses).toEqual(['UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED'])
      expect(forEngineer.assignees.length).toBeGreaterThan(0)

      const forAdmin = (await loadIssueWorkspace(tx, fx.actor, issue.id))!
      expect(forAdmin.permissions.canManage).toBe(true)

      // A viewer may read an issue page if they reach it, but is offered nothing.
      const forViewer = (await loadIssueWorkspace(tx, fx.viewer, issue.id))!
      expect(forViewer.permissions).toMatchObject({ canReport: false, canManage: false, canAddPhoto: false })
      expect(forViewer.nextStatuses).toEqual([])
      expect(forViewer.assignees).toEqual([])

      // An internal editor holds no issue permission at all.
      const forEditor = (await loadIssueWorkspace(tx, fx.editor, issue.id))!
      expect(forEditor.permissions).toMatchObject({ canReport: false, canManage: false, canAddPhoto: false })

      expect(await loadIssueWorkspace(tx, fx.engineer, 'no-such-issue')).toBeNull()
    })
  })
})

describe('the lifecycle rules on their own', () => {
  it('maps out where an issue may go, without touching the database', () => {
    expect(canTransitionIssue(IssueStatus.OPEN, IssueStatus.UNDER_INVESTIGATION)).toBe(true)
    expect(canTransitionIssue(IssueStatus.OPEN, IssueStatus.CLOSED)).toBe(true)
    expect(canTransitionIssue(IssueStatus.UNDER_INVESTIGATION, IssueStatus.OPEN)).toBe(true)
    expect(canTransitionIssue(IssueStatus.RESOLVED, IssueStatus.CLOSED)).toBe(true)
    expect(canTransitionIssue(IssueStatus.RESOLVED, IssueStatus.OPEN)).toBe(true)
    expect(canTransitionIssue(IssueStatus.CLOSED, IssueStatus.OPEN)).toBe(true)

    // The ones that make no sense.
    expect(canTransitionIssue(IssueStatus.CLOSED, IssueStatus.RESOLVED)).toBe(false)
    expect(canTransitionIssue(IssueStatus.CLOSED, IssueStatus.UNDER_INVESTIGATION)).toBe(false)
    expect(canTransitionIssue(IssueStatus.RESOLVED, IssueStatus.UNDER_INVESTIGATION)).toBe(false)
    expect(canTransitionIssue(IssueStatus.OPEN, IssueStatus.OPEN)).toBe(false)

    expect(isIssueEditable(IssueStatus.OPEN)).toBe(true)
    expect(isIssueEditable(IssueStatus.UNDER_INVESTIGATION)).toBe(true)
    expect(isIssueEditable(IssueStatus.RESOLVED)).toBe(false)
    expect(isIssueEditable(IssueStatus.CLOSED)).toBe(false)

    const engineer: Actor = { id: 'u1', name: 'Eng', email: 'e@example.test', role: 'ENGINEER', editorProfileId: null, engineerProfileId: null }
    expect(issuePermissionsFor(engineer, IssueStatus.OPEN)).toEqual({ canReport: true, canManage: true, canAddPhoto: true })
    // Evidence cannot be added to a closed record.
    expect(issuePermissionsFor(engineer, IssueStatus.CLOSED).canAddPhoto).toBe(false)
  })
})
