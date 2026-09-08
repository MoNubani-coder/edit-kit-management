import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'
import { REPORT_DEFINITIONS, findReport, groupedReportsFor, mayRunReport } from '@/server/reports/registry'
import { parseReportQuery, toReportParams } from '@/server/reports/filters'
import { toCsv } from '@/server/reports/renderers/csv'
import { runReport, runReportCsv, scopeFor } from '@/server/services/reports.service'
import { ForbiddenError } from '@/server/auth/errors'
import { addAccessory, createAsset } from '@/server/services/assets.service'
import { createBooking, markReadyForHandover } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } from '@/server/services/handover.service'
import { addKitAsset, addKitSoftware, createKit } from '@/server/services/kits.service'
import { createIssue } from '@/server/services/issues.service'
import { getLiveHandover } from '@/server/dal/handover.dal'
import { getLiveReturn } from '@/server/dal/return.dal'
import { captureReturnSignature, completeReturn, saveReturnChecklist, saveReturnEquipment, startReturn } from '@/server/services/return.service'
import { memorySignatureStore } from '@/server/storage/signature-store'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'
import { prepareChecklistFor } from '../helpers/checklist'

/**
 * The report query layer (AD-5), against the real database inside rolled-back
 * transactions.
 *
 * One scenario builds a kit, an editor, a booking taken out and returned with
 * a problem, and an issue - then the reports are run over it. What is being
 * checked is the layer's contract: authorisation, own-booking scope, the
 * declared columns, server-side filtering and paging, and a CSV that carries
 * exactly the same columns.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const local = (day: number, hour: number) => `2049-04-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`
const TZ = 'Asia/Dubai'
const signatures = memorySignatureStore()

interface Fixtures {
  admin: TestUser
  actor: Actor
  engineerUser: TestUser
  engineer: Actor
  viewer: Actor
  editorActor: Actor
  editorUser: TestUser
  engineerProfileId: string
  categoryId: string
  softwareId: string
  accessoryTypeId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineerUser = await createTestUser(tx, { role: UserRole.ENGINEER })
  const viewerUser = await createTestUser(tx, { role: UserRole.VIEWER })
  const editorUser = await createTestUser(tx, { role: UserRole.EDITOR })
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
    editorUser,
    editorActor: actorFor(editorUser),
    engineerProfileId: engineerProfile.id,
    categoryId: category.id,
    softwareId: software.id,
    accessoryTypeId: accessoryType.id,
  }
}

interface Scenario {
  marker: string
  kitId: string
  kitCode: string
  assetId: string
  assetCode: string
  editorId: string
  editorName: string
  bookingId: string
  bookingNumber: string
}

/** A kit, an editor and a booking, taken as far as `stage`. */
async function scenario(
  tx: Db,
  fx: Fixtures,
  options: { stage: 'reserved' | 'checked-out' | 'returned'; editorUserId?: string; problem?: boolean; marker?: string } = { stage: 'checked-out' },
): Promise<Scenario> {
  const marker = options.marker ?? tag()
  const kit = await createKit(tx, fx.actor, {
    kitCode: `RPT-${marker}`,
    name: `Report kit ${marker}`,
    admBarcode: `ADM-RPTKIT-${marker}`,
    description: undefined,
    location: undefined,
    notes: undefined,
    suitcaseStatus: 'GOOD',
    status: 'AVAILABLE',
  })
  const asset = await createAsset(tx, fx.actor, {
    name: `Report asset ${marker}`,
    categoryId: fx.categoryId,
    manufacturer: 'Testco',
    model: 'R-9',
    serialNumber: `SN-RPT-${marker}`,
    admBarcode: `ADM-RPT-${marker}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  await addAccessory(tx, fx.actor, asset.id, { accessoryTypeId: fx.accessoryTypeId, label: 'Power adapter', quantity: 1, serialNumber: undefined, admBarcode: undefined, isRequired: true, notes: undefined })
  await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })

  const editorName = `Report Editor ${marker}`
  const editor = await createEditor(tx, fx.actor, {
    fullName: editorName,
    staffId: options.editorUserId ? `EDT-${marker}` : undefined,
    email: undefined,
    contactNumber: '+971 50 777 1234',
    department: undefined,
    company: options.editorUserId ? undefined : 'Freelance',
    type: options.editorUserId ? 'INTERNAL' : 'EXTERNAL',
    notes: undefined,
    userId: options.editorUserId,
    isActive: true,
  })

  const booking = await createBooking(tx, fx.actor, {
    editorId: editor.id,
    kitId: kit.id,
    engineerId: fx.engineerProfileId,
    bookingStart: local(10, 9),
    bookingEnd: local(16, 18),
    collectionDate: undefined,
    expectedReturnDate: local(16, 17),
    purpose: `Report purpose ${marker}`,
    notes: undefined,
    intent: 'reserve',
  })

  const result: Scenario = {
    marker,
    kitId: kit.id,
    kitCode: kit.kitCode,
    assetId: asset.id,
    assetCode: asset.assetCode,
    editorId: editor.id,
    editorName,
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
  }
  if (options.stage === 'reserved') return result

  await prepareChecklistFor(tx, fx.actor, booking.id)
  await markReadyForHandover(tx, fx.actor, booking.id)
  await startHandover(tx, fx.engineer, booking.id)
  const handover = (await getLiveHandover(tx, booking.id))!
  await saveEquipmentVerification(tx, fx.engineer, booking.id, {
    suitcaseStatus: 'GOOD',
    generalNotes: 'Everything in the case',
    assets: handover.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
    accessories: handover.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
  })
  await saveChecklistVerification(tx, fx.engineer, booking.id, {
    checks: handover.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
    software: handover.software.map((check) => ({ id: check.id, status: 'INSTALLED' as const, installedVersion: '2025.1', notes: undefined })),
  })
  await captureSignature(tx, fx.engineer, booking.id, 'EDITOR', PNG, signatures)
  await captureSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, signatures)
  await completeHandover(tx, fx.engineer, booking.id)
  if (options.stage === 'checked-out') return result

  await startReturn(tx, fx.engineer, booking.id)
  const inspection = (await getLiveReturn(tx, booking.id))!
  await saveReturnEquipment(tx, fx.engineer, booking.id, {
    suitcaseStatus: options.problem ? 'MINOR_DAMAGE' : 'GOOD',
    generalNotes: options.problem ? 'Lid cracked in transit' : 'All back',
    assets: inspection.lines.map((line) => ({ id: line.id, status: options.problem ? ('DAMAGED' as const) : ('INCLUDED' as const), notes: options.problem ? 'Cracked lid' : undefined })),
    accessories: inspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
  })
  const withChecks = (await getLiveReturn(tx, booking.id))!
  if (withChecks.checklist.length > 0) {
    await saveReturnChecklist(tx, fx.engineer, booking.id, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
  }
  await captureReturnSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, signatures)
  await completeReturn(tx, fx.engineer, booking.id)
  return result
}

const query = (raw: Record<string, string> = {}) => raw

let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  countersBefore = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
})

afterAll(async () => {
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'RPT-' } } })).toBe(0)
  await testDb.$disconnect()
})

describe('who may run a report', () => {
  it('offers every report to an administrator and refuses one an engineer may not read', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)

      const forAdmin = groupedReportsFor(fx.actor).flatMap((group) => group.reports)
      expect(forAdmin).toHaveLength(REPORT_DEFINITIONS.length)

      // An engineer holds everything except maintenance.manage; maintenance.read
      // it does hold, so the whole catalogue is available.
      const forEngineer = groupedReportsFor(fx.engineer).flatMap((group) => group.reports).map((report) => report.id)
      expect(forEngineer).toContain('checked-out')
      expect(forEngineer).toContain('issues')

      // A viewer holds report.read but not issue.read or maintenance.read.
      const forViewer = groupedReportsFor(fx.viewer).flatMap((group) => group.reports).map((report) => report.id)
      expect(forViewer).toContain('checked-out')
      expect(forViewer).toContain('equipment-status')
      expect(forViewer).not.toContain('issues')
      expect(forViewer).not.toContain('maintenance')
      expect(forViewer).not.toContain('editor-history')

      // And running one they may not is refused, not quietly emptied.
      await expect(runReport(tx, fx.viewer, 'issues', query())).rejects.toBeInstanceOf(ForbiddenError)
      await expect(runReport(tx, fx.viewer, 'maintenance', query())).rejects.toBeInstanceOf(ForbiddenError)
      // An unknown id is the same answer, so ids cannot be probed.
      await expect(runReport(tx, fx.actor, 'no-such-report', query())).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('closes the reports area to an editor, and narrows any report that is given a scope', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const mine = await scenario(tx, fx, { stage: 'checked-out', editorUserId: fx.editorUser.id })
      const theirs = await scenario(tx, fx, { stage: 'checked-out' })

      const editorProfile = await tx.editorProfile.findFirstOrThrow({ where: { userId: fx.editorUser.id }, select: { id: true } })
      const editorActor = actorFor(fx.editorUser, { editorProfileId: editorProfile.id })

      // An EDITOR holds no report.read, so no report opens for them at all -
      // their own record comes from the booking's document instead.
      expect(groupedReportsFor(editorActor)).toEqual([])
      await expect(runReport(tx, editorActor, 'booking-history', query())).rejects.toBeInstanceOf(ForbiddenError)
      await expect(runReportCsv(tx, editorActor, 'checked-out', query())).rejects.toBeInstanceOf(ForbiddenError)

      // The scope a booking-shaped report would receive for them, and an
      // administrator's lack of one.
      expect(scopeFor(editorActor)).toEqual({ editorProfileId: editorProfile.id })
      expect(scopeFor(fx.actor)).toBeNull()

      // Given that scope, the report itself returns their booking and no other:
      // the narrowing is in the query, not in the page that calls it.
      const definition = findReport('booking-history')!
      const scoped = await definition.run(tx, toReportParams(parseReportQuery({ search: 'RPT-' }, definition.filters), { now: new Date(), timeZone: TZ, scope: scopeFor(editorActor) }))
      const numbers = scoped.rows.map((row) => row.bookingNumber)
      expect(numbers).toContain(mine.bookingNumber)
      expect(numbers).not.toContain(theirs.bookingNumber)

      // An administrator, with no scope, sees both.
      const all = await runReport(tx, fx.actor, 'booking-history', query({ search: 'RPT-' }), { timeZone: TZ })
      const allNumbers = all.result.rows.map((row) => row.bookingNumber)
      expect(allNumbers).toContain(mine.bookingNumber)
      expect(allNumbers).toContain(theirs.bookingNumber)

      // A reader with no booking visibility at all gets an impossible scope,
      // so nothing leaks even if such a report were somehow offered.
      const noBookings: Actor = { id: 'x', name: 'X', email: 'x@example.test', role: 'ADMIN', editorProfileId: null, engineerProfileId: null }
      expect(scopeFor({ ...noBookings, role: 'EDITOR' })).toEqual({ editorProfileId: '__none__' })
    })
  })
})

describe('the operational reports', () => {
  it('lists what is checked out, with the editor’s mobile and how long it has been out', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'checked-out' })

      const { result } = await runReport(tx, fx.engineer, 'checked-out', query({ search: s.kitCode }), { timeZone: TZ })
      expect(result.rows).toHaveLength(1)
      const row = result.rows[0]
      expect(row).toMatchObject({ bookingNumber: s.bookingNumber, kitCode: s.kitCode, editor: s.editorName, mobile: '+971 50 777 1234' })
      expect(row.collected).toBeInstanceOf(Date)
      expect(typeof row.daysOut).toBe('number')
      expect(result.summary).toContain('out with editors')

      // The columns are declared, which is what the renderers rely on.
      expect(result.columns.map((column) => column.key)).toContain('mobile')
      expect(result.columns.find((column) => column.key === 'bookingNumber')?.linkTo).toBe('booking')
    })
  })

  it('separates upcoming returns from overdue ones on the same data', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'checked-out' })

      // Expected back in the future: due, not overdue.
      const day = 86_400_000
      await tx.booking.update({ where: { id: s.bookingId }, data: { expectedReturnDate: new Date(Date.now() + 2 * day) } })
      expect((await runReport(tx, fx.engineer, 'due-returns', query({ search: s.kitCode }))).result.rows).toHaveLength(1)
      expect((await runReport(tx, fx.engineer, 'overdue', query({ search: s.kitCode }))).result.rows).toHaveLength(0)

      // Expected back in the past: overdue, not due.
      await tx.booking.update({ where: { id: s.bookingId }, data: { collectionDate: new Date(Date.now() - 5 * day), expectedReturnDate: new Date(Date.now() - 3 * day) } })
      const overdue = await runReport(tx, fx.engineer, 'overdue', query({ search: s.kitCode }))
      expect(overdue.result.rows).toHaveLength(1)
      expect(overdue.result.rows[0].daysLate).toBe(3)
      expect((await runReport(tx, fx.engineer, 'due-returns', query({ search: s.kitCode }))).result.rows).toHaveLength(0)

      // And the checked-out report flags it as late.
      const out = await runReport(tx, fx.engineer, 'checked-out', query({ search: s.kitCode }))
      expect(out.result.rows[0]).toMatchObject({ late: true, daysLate: 3 })
    })
  })
})

describe('the history reports', () => {
  it('records how a booking ended, including whether it came back late', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'returned' })

      const { result } = await runReport(tx, fx.actor, 'booking-history', query({ search: s.bookingNumber }), { timeZone: TZ })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({ status: 'COMPLETED', bookingNumber: s.bookingNumber, punctuality: 'early' })
      expect(result.rows[0].actualReturn).toBeInstanceOf(Date)

      // The status filter is applied on the server.
      expect((await runReport(tx, fx.actor, 'booking-history', query({ search: s.bookingNumber, status: 'CANCELLED' }))).result.rows).toHaveLength(0)
      expect((await runReport(tx, fx.actor, 'booking-history', query({ search: s.bookingNumber, status: 'COMPLETED' }))).result.rows).toHaveLength(1)
    })
  })

  it('counts kit utilisation and editor history from the same bookings', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'returned' })

      const kits = await runReport(tx, fx.actor, 'kit-utilisation', query({ search: s.kitCode }), { timeZone: TZ })
      expect(kits.result.rows).toHaveLength(1)
      expect(kits.result.rows[0]).toMatchObject({ kitCode: s.kitCode, timesOut: 1, items: 1 })
      expect(kits.result.rows[0].lastOut).toBeInstanceOf(Date)

      const editors = await runReport(tx, fx.actor, 'editor-history', query({ search: s.editorName }), { timeZone: TZ })
      expect(editors.result.rows).toHaveLength(1)
      expect(editors.result.rows[0]).toMatchObject({ editor: s.editorName, bookings: 1, outNow: 0, type: 'External', mobile: '+971 50 777 1234' })
    })
  })

  it('lists the completed handover and return documents with their counts', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'returned', problem: true })

      const { result } = await runReport(tx, fx.actor, 'handover-return-records', query({ search: s.bookingNumber }), { timeZone: TZ })
      expect(result.rows).toHaveLength(2)
      const handover = result.rows.find((row) => row.type === 'Handover')!
      const returned = result.rows.find((row) => row.type === 'Return')!
      expect(handover).toMatchObject({ items: 1, accountedFor: 1, problems: 0, signatures: 2 })
      expect(returned).toMatchObject({ items: 1, problems: 1, signatures: 1 })
      expect(returned.issuesRaised).toBeGreaterThanOrEqual(1)

      // Filtering by document type happens on the server.
      expect((await runReport(tx, fx.actor, 'handover-return-records', query({ search: s.bookingNumber, status: 'RETURN' }))).result.rows).toHaveLength(1)
    })
  })
})

describe('the equipment reports', () => {
  it('shows what is out of service, and where it was last seen', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'returned', problem: true })

      const { result } = await runReport(tx, fx.engineer, 'missing-damaged', query({ search: s.assetCode }), { timeZone: TZ })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({ assetCode: s.assetCode, status: 'DAMAGED', booking: s.bookingNumber, editor: s.editorName })
      expect(result.rows[0].since).toBeInstanceOf(Date)
      // The return raised an issue, and it is named here.
      expect(String(result.rows[0].openIssue)).toMatch(/^ISS-/)

      // The status filter narrows it to one kind of problem.
      expect((await runReport(tx, fx.engineer, 'missing-damaged', query({ search: s.assetCode, status: 'MISSING' }))).result.rows).toHaveLength(0)
    })
  })

  it('reports the whole inventory with kit membership and open issues', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'checked-out' })
      await createIssue(tx, fx.engineer, {
        type: 'MALFUNCTION',
        severity: 'HIGH',
        title: `RPT issue ${s.marker}`,
        description: 'Reported for the equipment report.',
        assetId: s.assetId,
        kitId: undefined,
        bookingId: undefined,
        accessoryId: undefined,
        assignedToId: undefined,
      })

      const { result } = await runReport(tx, fx.engineer, 'equipment-status', query({ search: s.assetCode }), { timeZone: TZ })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({ assetCode: s.assetCode, kitCode: s.kitCode, required: true, outNow: true, openIssues: 1, status: 'CHECKED_OUT' })

      const issues = await runReport(tx, fx.engineer, 'issues', query({ search: `RPT issue ${s.marker}` }), { timeZone: TZ })
      expect(issues.result.rows).toHaveLength(1)
      expect(issues.result.rows[0]).toMatchObject({ severity: 'HIGH', status: 'OPEN', assetCode: s.assetCode })
      expect(issues.result.rows[0].daysToResolve).toBeNull()

      // Severity is a server-side filter too.
      expect((await runReport(tx, fx.engineer, 'issues', query({ search: `RPT issue ${s.marker}`, severity: 'LOW' }))).result.rows).toHaveLength(0)
    })
  })

  it('reports maintenance records, cost included, as plain values', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'reserved' })
      await tx.maintenanceRecord.create({
        data: {
          maintenanceNumber: `MNT-RPT-${s.marker}`,
          assetId: s.assetId,
          type: 'REPAIR',
          status: 'IN_PROGRESS',
          title: `Bench repair ${s.marker}`,
          description: 'For the maintenance report.',
          startedAt: new Date(Date.now() - 2 * 86_400_000),
          cost: '125.50',
          currency: 'AED',
          createdById: fx.admin.id,
        },
      })

      const { result } = await runReport(tx, fx.engineer, 'maintenance', query({ search: s.marker }), { timeZone: TZ })
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({ assetCode: s.assetCode, status: 'IN_PROGRESS', currency: 'AED', daysOpen: 2 })
      // A Prisma Decimal would break every renderer; the layer carries numbers.
      expect(result.rows[0].cost).toBe(125.5)
    })
  })
})

describe('filters, paging and the CSV renderer', () => {
  it('pages on the server and keeps the page size within bounds', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const marker = tag()
      for (let index = 0; index < 6; index += 1) {
        await createAsset(tx, fx.actor, {
          name: `Paged asset ${marker}-${index}`,
          categoryId: fx.categoryId,
          manufacturer: 'Testco',
          model: 'P-1',
          serialNumber: `SN-PAGE-${marker}-${index}`,
          admBarcode: `ADM-PAGE-${marker}-${index}`,
          location: undefined,
          notes: undefined,
          status: 'AVAILABLE',
        })
      }

      const page1 = await runReport(tx, fx.engineer, 'equipment-status', query({ search: `Paged asset ${marker}`, pageSize: '5', page: '1' }))
      const page2 = await runReport(tx, fx.engineer, 'equipment-status', query({ search: `Paged asset ${marker}`, pageSize: '5', page: '2' }))
      expect(page1.result).toMatchObject({ total: 6, pageCount: 2, page: 1, pageSize: 5 })
      expect(page1.result.rows).toHaveLength(5)
      expect(page2.result.rows).toHaveLength(1)
      // The two pages are different rows, not the same page twice.
      expect(page1.result.rows.map((row) => row.assetCode)).not.toContain(page2.result.rows[0].assetCode)

      // Nonsense paging falls back to the default rather than failing, and a size
      // out of range is clamped to the nearest bound (AD-32).
      const odd = await runReport(tx, fx.engineer, 'equipment-status', query({ search: `Paged asset ${marker}`, pageSize: '9999', page: 'abc' }))
      expect(odd.result.page).toBe(1)
      expect(odd.result.pageSize).toBe(200)
      const tiny = await runReport(tx, fx.engineer, 'equipment-status', query({ search: `Paged asset ${marker}`, pageSize: '2' }))
      expect(tiny.result.pageSize).toBe(5)
    })
  })

  it('drops a filter a report does not offer, and reads dates in the business time zone', () => {
    // `checked-out` offers no date window; typing one in the URL is ignored.
    const parsed = parseReportQuery({ from: '2049-04-10', to: '2049-04-16', search: 'x', page: '2' }, ['search'])
    expect(parsed).toMatchObject({ search: 'x', page: 2 })
    expect(parsed.from).toBeUndefined()
    expect(parsed.to).toBeUndefined()

    const withDates = parseReportQuery({ from: '2049-04-10', to: '2049-04-16' }, ['from', 'to'])
    const params = toReportParams(withDates, { now: new Date(), timeZone: TZ, scope: null })
    // 10 April in Dubai starts at 20:00 UTC on the 9th, and the window runs to
    // the end of the 16th - inclusive to the person typing it.
    expect(params.from?.toISOString()).toBe('2049-04-09T20:00:00.000Z')
    expect(params.to?.toISOString()).toBe('2049-04-16T20:00:00.000Z')

    // A malformed date is dropped rather than shifting the window.
    expect(toReportParams(parseReportQuery({ from: 'not-a-date' }, ['from']), { now: new Date(), timeZone: TZ, scope: null }).from).toBeUndefined()
  })

  it('exports the same columns as the table, with a BOM and quoted fields', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { stage: 'checked-out' })

      const { result } = await runReport(tx, fx.engineer, 'checked-out', query({ search: s.kitCode }), { timeZone: TZ })
      const csv = await runReportCsv(tx, fx.engineer, 'checked-out', query({ search: s.kitCode }), { timeZone: TZ })

      expect(csv.contentType).toContain('text/csv')
      expect(csv.fileName).toMatch(/^checked-out-\d{4}-\d{2}-\d{2}\.csv$/)
      // Excel needs the byte-order mark to read non-ASCII names correctly.
      expect(csv.body.charCodeAt(0)).toBe(0xfeff)
      expect(csv.body).toContain('\r\n')

      const [header] = csv.body.slice(1).split('\r\n')
      expect(header.split(',')).toHaveLength(result.columns.length)
      expect(header).toContain('Mobile')
      expect(csv.body).toContain(s.bookingNumber)
      expect(csv.body).toContain(s.editorName)

      // A CSV of a report the caller may not run is refused as well.
      await expect(runReportCsv(tx, fx.viewer, 'issues', query())).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('guards a value that a spreadsheet would treat as a formula', () => {
    const csv = toCsv(
      {
        columns: [
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'note', label: 'Note', kind: 'text' },
          { key: 'count', label: 'Count', kind: 'number', numeric: true },
          { key: 'when', label: 'When', kind: 'date' },
          { key: 'ok', label: 'OK', kind: 'boolean' },
          { key: 'state', label: 'State', kind: 'status' },
        ],
        rows: [{ name: '=SUM(A1:A9)', note: 'Says "hello", then, stops', count: 4, when: new Date('2049-04-10T06:00:00Z'), ok: true, state: 'CHECKED_OUT' }],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
        summary: 'one row',
      },
      { reportId: 'demo', title: 'Demo', timeZone: TZ, now: new Date('2049-04-11T06:00:00Z') },
    )

    const [, row] = csv.body.slice(1).split('\r\n')
    // A leading `=` is neutralised, quotes are doubled, commas are quoted.
    expect(row).toContain("'=SUM(A1:A9)")
    expect(row).toContain('"Says ""hello"", then, stops"')
    expect(row).toContain('4')
    expect(row).toContain('Yes')
    expect(row).toContain('checked out')
  })
})

describe('the registry itself', () => {
  it('has unique ids, a description and a real group for every report', () => {
    const ids = REPORT_DEFINITIONS.map((report) => report.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(11)

    for (const report of REPORT_DEFINITIONS) {
      expect(report.title.length, report.id).toBeGreaterThan(3)
      expect(report.description.length, report.id).toBeGreaterThan(10)
      expect(['Operations', 'History', 'Equipment']).toContain(report.group)
      expect(findReport(report.id)).toBe(report)
      // A status filter without options would render an empty select.
      if (report.filters.includes('status')) expect(report.statusOptions?.length, report.id).toBeGreaterThan(0)
    }

    expect(findReport('nope')).toBeNull()
    const viewer: Actor = { id: 'v', name: 'V', email: 'v@example.test', role: 'VIEWER', editorProfileId: null, engineerProfileId: null }
    expect(mayRunReport(viewer, findReport('issues')!)).toBe(false)
    expect(mayRunReport(viewer, findReport('checked-out')!)).toBe(true)
  })
})
