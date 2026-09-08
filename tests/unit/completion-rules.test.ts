import { BookingStatus, ItemConditionStatus, KitStatus, SignatureType, SuitcaseStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import type { HandoverAssetLine, HandoverBooking, HandoverInspection } from '@/server/dal/handover.dal'
import type { HandoverRecord, ReturnAssetLine, ReturnInspection } from '@/server/dal/return.dal'
import { bookingHandoverBlockers, verificationVerdict } from '@/server/services/handover.service'
import type { KitAvailability, KitAvailabilityReason } from '@/server/services/kits.service'
import { bookingReturnBlockers, kitStatusAfterReturn, returnVerdict } from '@/server/services/return.service'

/**
 * The handover and return completion gates, as units.
 *
 * These are the rules that decide whether a signed document may be produced,
 * and the service suites reach them through a database. Here they are called
 * directly with hand-built shapes, so each rule can be pushed to its edge -
 * an empty kit, an optional item missing, a required check unanswered, a
 * signature absent - without arranging a booking first. Every message a
 * blocker carries is read by an engineer standing at a counter, so the text
 * is asserted, not just the count.
 */

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

function booking(overrides: Partial<HandoverBooking> = {}): HandoverBooking {
  return {
    id: 'booking-1',
    bookingNumber: 'BK-2026-000001',
    status: BookingStatus.READY_FOR_HANDOVER,
    bookingStart: new Date('2026-03-01T06:00:00.000Z'),
    bookingEnd: new Date('2026-03-05T06:00:00.000Z'),
    collectionDate: new Date('2026-03-01T06:00:00.000Z'),
    expectedReturnDate: new Date('2026-03-05T06:00:00.000Z'),
    actualReturnDate: null,
    purpose: 'Ramadan coverage',
    notes: null,
    checklistTemplateId: null,
    requesterName: 'Layla Haddad',
    requesterStaffId: 'ADM-1024',
    requesterMobile: '+971500000000',
    projectName: 'Ramadan coverage',
    workOrder: 'WO-2026-0042',
    checklistPreparedAt: new Date('2026-02-28T12:00:00.000Z'),
    createdBy: { id: 'user-1', name: 'Omar Said' },
    editor: {
      id: 'editor-1',
      fullName: 'Layla Haddad',
      staffId: 'ADM-1024',
      isExternal: false,
      isActive: true,
      deleted: false,
      contactNumber: '+971500000000',
      email: 'layla@example.test',
      company: null,
      department: 'News',
    },
    kit: {
      id: 'kit-1',
      kitCode: 'MBP-02',
      name: 'MacBook Pro edit kit 2',
      status: KitStatus.RESERVED,
      admBarcode: null,
      suitcaseStatus: SuitcaseStatus.GOOD,
      deleted: false,
      defaultChecklistTemplateId: null,
    },
    engineer: { id: 'engineer-1', fullName: 'Omar Said', staffId: 'ADM-2048', userId: 'user-1' },
    ...overrides,
  }
}

/** The directory profile a legacy booking carries. */
function profile() {
  return {
    id: 'editor-1',
    fullName: 'Layla Haddad',
    staffId: 'ADM-1024',
    isExternal: false,
    isActive: true,
    deleted: false,
    contactNumber: '+971500000000',
    email: 'layla@example.test',
    company: null,
    department: 'News',
  }
}

function readiness(overrides: Partial<KitAvailability> = {}): KitAvailability {
  return {
    available: true,
    state: 'reserved',
    reasons: [],
    blockingCount: 0,
    warningCount: 0,
    memberCount: 12,
    requiredCount: 10,
    ...overrides,
  }
}

function reason(overrides: Partial<KitAvailabilityReason> = {}): KitAvailabilityReason {
  return {
    code: 'asset_status',
    severity: 'blocking',
    assetId: 'asset-9',
    assetCode: 'AST-000009',
    slotLabel: null,
    reason: 'AST-000009 is damaged.',
    ...overrides,
  }
}

function handoverLine(overrides: Partial<HandoverAssetLine> = {}): HandoverAssetLine {
  return {
    id: 'line-1',
    assetId: 'asset-1',
    kitAssetId: 'kit-asset-1',
    status: ItemConditionStatus.INCLUDED,
    notes: null,
    sortOrder: 0,
    slotLabelSnapshot: 'Laptop',
    assetCodeSnapshot: 'AST-000001',
    categoryNameSnapshot: 'Laptop',
    nameSnapshot: 'MacBook Pro 16',
    manufacturerSnapshot: 'Apple',
    modelSnapshot: 'M3 Max',
    serialNumberSnapshot: 'SN-DEMO-0001',
    admBarcodeSnapshot: null,
    isRequired: true,
    current: { status: 'AVAILABLE', deleted: false, activeMaintenanceCount: 0, stillInKit: true },
    accessories: [],
    ...overrides,
  }
}

function handover(overrides: Partial<HandoverInspection> = {}): HandoverInspection {
  return {
    id: 'inspection-1',
    status: 'IN_PROGRESS',
    suitcaseStatus: SuitcaseStatus.GOOD,
    generalNotes: null,
    startedAt: new Date('2026-03-01T05:00:00.000Z'),
    startedByName: 'Omar Said',
    completedAt: null,
    completedByName: null,
    lockedAt: null,
    lines: [handoverLine()],
    software: [],
    checklist: [],
    signatures: [
      { id: 'sig-1', type: SignatureType.HANDOVER_EDITOR, signerRole: 'EDITOR', signerName: 'Layla Haddad', signerStaffId: 'ADM-1024', signedAt: new Date('2026-03-01T05:30:00.000Z') },
      { id: 'sig-2', type: SignatureType.HANDOVER_ENGINEER, signerRole: 'ENGINEER', signerName: 'Omar Said', signerStaffId: 'ADM-2048', signedAt: new Date('2026-03-01T05:31:00.000Z') },
    ],
    ...overrides,
  }
}

function returnLine(overrides: Partial<ReturnAssetLine> = {}): ReturnAssetLine {
  return {
    id: 'return-line-1',
    assetId: 'asset-1',
    kitAssetId: 'kit-asset-1',
    status: ItemConditionStatus.INCLUDED,
    notes: null,
    sortOrder: 0,
    slotLabelSnapshot: 'Laptop',
    assetCodeSnapshot: 'AST-000001',
    categoryNameSnapshot: 'Laptop',
    nameSnapshot: 'MacBook Pro 16',
    manufacturerSnapshot: 'Apple',
    modelSnapshot: 'M3 Max',
    serialNumberSnapshot: 'SN-DEMO-0001',
    admBarcodeSnapshot: null,
    handoverStatus: ItemConditionStatus.INCLUDED,
    handoverNotes: null,
    wasHandedOver: true,
    current: { status: 'CHECKED_OUT', deleted: false, activeMaintenanceCount: 0, stillInKit: true },
    accessories: [],
    ...overrides,
  }
}

function returnInspection(overrides: Partial<ReturnInspection> = {}): ReturnInspection {
  return {
    id: 'return-inspection-1',
    status: 'IN_PROGRESS',
    suitcaseStatus: SuitcaseStatus.GOOD,
    generalNotes: null,
    startedAt: new Date('2026-03-05T05:00:00.000Z'),
    startedByName: 'Omar Said',
    completedAt: null,
    completedByName: null,
    lockedAt: null,
    lines: [returnLine()],
    checklist: [],
    signatures: [
      { id: 'sig-3', type: SignatureType.RETURN_ENGINEER, signerRole: 'ENGINEER', signerName: 'Omar Said', signerStaffId: 'ADM-2048', signedAt: new Date('2026-03-05T05:30:00.000Z') },
    ],
    ...overrides,
  }
}

function handoverRecord(overrides: Partial<HandoverRecord> = {}): HandoverRecord {
  return {
    inspectionId: 'inspection-1',
    status: 'COMPLETED',
    completed: true,
    completedAt: new Date('2026-03-01T06:00:00.000Z'),
    completedByName: 'Omar Said',
    suitcaseStatus: SuitcaseStatus.GOOD,
    generalNotes: null,
    lines: [{ assetId: 'asset-1', assetCodeSnapshot: 'AST-000001' }] as unknown as HandoverRecord['lines'],
    signatures: [],
    ...overrides,
  }
}

const codes = (blockers: readonly { code: string }[]) => blockers.map((blocker) => blocker.code)
const reasons = (blockers: readonly { reason: string }[]) => blockers.map((blocker) => blocker.reason).join(' | ')

// -----------------------------------------------------------------------------
// Handover eligibility
// -----------------------------------------------------------------------------

describe('bookingHandoverBlockers', () => {
  it('clears a ready booking with a reserved kit and a healthy editor', () => {
    expect(bookingHandoverBlockers(booking(), readiness())).toEqual([])
  })

  it('says plainly that a checked-out booking has already been handed over', () => {
    const blockers = bookingHandoverBlockers(booking({ status: BookingStatus.CHECKED_OUT }), readiness())
    expect(codes(blockers)).toContain('status')
    expect(reasons(blockers)).toContain('BK-2026-000001 has already been handed over.')
  })

  it.each([
    [BookingStatus.DRAFT, 'a draft'],
    [BookingStatus.RESERVED, 'reserved'],
    [BookingStatus.OVERDUE, 'out and overdue'],
    [BookingStatus.RETURN_INSPECTION, 'in return inspection'],
    [BookingStatus.COMPLETED, 'completed'],
    [BookingStatus.CANCELLED, 'cancelled'],
  ])('refuses a booking that is %s and names the state', (status, label) => {
    const blockers = bookingHandoverBlockers(booking({ status }), readiness())
    expect(codes(blockers)).toContain('status')
    expect(reasons(blockers)).toContain(`is ${label}`)
  })

  it('refuses a removed editor before an inactive one, and names them', () => {
    const removed = bookingHandoverBlockers(booking({ editor: { ...profile(), deleted: true, isActive: false } }), readiness())
    expect(reasons(removed)).toContain('Layla Haddad has been removed from the editor directory.')
    expect(removed.filter((blocker) => blocker.code === 'editor')).toHaveLength(1)
  })

  it('refuses an inactive editor and says what to do about it', () => {
    const blockers = bookingHandoverBlockers(booking({ editor: { ...profile(), isActive: false } }), readiness())
    expect(reasons(blockers)).toContain('Reactivate the editor or cancel the booking.')
  })

  it('refuses a removed kit', () => {
    const blockers = bookingHandoverBlockers(booking({ kit: { ...booking().kit, deleted: true } }), readiness())
    expect(reasons(blockers)).toContain('Kit MBP-02 has been removed from the inventory.')
  })

  it('refuses a kit that is not set aside for this booking and names its status', () => {
    const blockers = bookingHandoverBlockers(booking({ kit: { ...booking().kit, status: KitStatus.AVAILABLE } }), readiness())
    expect(codes(blockers)).toContain('kit')
    expect(reasons(blockers)).toContain('is not set aside for this booking (its status is available)')
  })

  it('refuses a kit with nothing on it, however available the readiness rule calls it', () => {
    const blockers = bookingHandoverBlockers(booking(), readiness({ memberCount: 0, requiredCount: 0 }))
    expect(reasons(blockers)).toContain('Kit MBP-02 has no equipment on it.')
  })

  it('carries each blocking readiness reason through, and ignores warnings', () => {
    const blockers = bookingHandoverBlockers(
      booking(),
      readiness({
        available: false,
        reasons: [reason(), reason({ severity: 'warning', reason: 'An optional item is missing.' })],
      }),
    )
    expect(codes(blockers)).toEqual(['readiness'])
    expect(reasons(blockers)).toBe('AST-000009 is damaged.')
  })

  it('reports every independent problem at once rather than the first', () => {
    const blockers = bookingHandoverBlockers(
      booking({ status: BookingStatus.RESERVED, editor: { ...profile(), isActive: false }, kit: { ...booking().kit, deleted: true } }),
      readiness({ memberCount: 0 }),
    )
    expect(codes(blockers)).toEqual(['status', 'editor', 'kit', 'kit'])
  })

  it('tolerates an unknown readiness, since a booking can be judged without it', () => {
    expect(bookingHandoverBlockers(booking(), null)).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// Handover completion
// -----------------------------------------------------------------------------

describe('verificationVerdict', () => {
  it('allows completion when every item, check and signature is in place', () => {
    const verdict = verificationVerdict(handover())
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toEqual([])
    expect(verdict.complete).toBe(true)
  })

  it('refuses a handover with no equipment at all', () => {
    const verdict = verificationVerdict(handover({ lines: [] }))
    expect(codes(verdict.blockers)).toContain('equipment')
    expect(reasons(verdict.blockers)).toContain('This handover has no equipment to verify.')
    expect(verdict.complete).toBe(false)
  })

  it('refuses a required item that is not being handed over', () => {
    const verdict = verificationVerdict(handover({ lines: [handoverLine({ status: ItemConditionStatus.MISSING })] }))
    expect(reasons(verdict.blockers)).toContain('AST-000001 MacBook Pro 16 is marked missing; a required item must be handed over.')
    expect(verdict.complete).toBe(false)
  })

  it('warns about an optional item that is missing, and still allows completion', () => {
    const verdict = verificationVerdict(handover({ lines: [handoverLine(), handoverLine({ id: 'line-2', isRequired: false, status: ItemConditionStatus.MISSING, assetCodeSnapshot: 'AST-000002' })] }))
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toEqual(['AST-000002 (optional) is marked missing.'])
    expect(verdict.complete).toBe(true)
  })

  it('treats an optional item marked not applicable as neither a problem nor a warning', () => {
    const verdict = verificationVerdict(handover({ lines: [handoverLine({ isRequired: false, status: ItemConditionStatus.NOT_APPLICABLE })] }))
    expect(verdict.warnings).toEqual([])
    expect(verdict.complete).toBe(true)
  })

  it('refuses a required item that has left the kit since the snapshot', () => {
    const verdict = verificationVerdict(handover({ lines: [handoverLine({ current: { status: 'AVAILABLE', deleted: false, activeMaintenanceCount: 0, stillInKit: false } })] }))
    expect(reasons(verdict.blockers)).toContain('AST-000001 is no longer in the kit.')
  })

  it('refuses a required item that has gone into maintenance since the snapshot', () => {
    const verdict = verificationVerdict(handover({ lines: [handoverLine({ current: { status: 'MAINTENANCE', deleted: false, activeMaintenanceCount: 1, stillInKit: true } })] }))
    expect(reasons(verdict.blockers)).toContain('AST-000001 has maintenance in progress or on hold.')
  })

  it('warns about a required accessory that is missing without blocking the handover', () => {
    const verdict = verificationVerdict(
      handover({
        lines: [
          handoverLine({
            accessories: [
              { id: 'acc-1', accessoryId: 'a-1', status: ItemConditionStatus.MISSING, quantityExpected: 1, quantityReceived: 0, notes: null, labelSnapshot: 'Charger', accessoryTypeSnapshot: 'CHARGER', serialNumberSnapshot: null, admBarcodeSnapshot: null, isRequired: true },
            ],
          }),
        ],
      }),
    )
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toEqual(['AST-000001: Charger (CHARGER) is marked missing.'])
  })

  it('counts unanswered required checks in one message and uses the singular correctly', () => {
    const one = verificationVerdict(handover({ checklist: [{ id: 'c1', label: 'Battery health', description: null, phase: 'HANDOVER', isRequired: true, sortOrder: 0, result: null, prepared: null }] }))
    expect(reasons(one.blockers)).toContain('1 required check has not been answered.')

    const two = verificationVerdict(
      handover({
        checklist: [
          { id: 'c1', label: 'Battery health', description: null, phase: 'HANDOVER', isRequired: true, sortOrder: 0, result: null, prepared: null },
          { id: 'c2', label: 'Ports', description: null, phase: 'BOTH', isRequired: true, sortOrder: 1, result: null, prepared: null },
        ],
      }),
    )
    expect(reasons(two.blockers)).toContain('2 required checks have not been answered.')
  })

  it('refuses a failed required check and names it, but only warns on an optional one', () => {
    const verdict = verificationVerdict(
      handover({
        checklist: [
          { id: 'c1', label: 'Battery health', description: null, phase: 'HANDOVER', isRequired: true, sortOrder: 0, result: { status: 'FAIL', notes: null }, prepared: null },
          { id: 'c2', label: 'Lens cloth', description: null, phase: 'HANDOVER', isRequired: false, sortOrder: 1, result: { status: 'FAIL', notes: null }, prepared: null },
        ],
      }),
    )
    expect(reasons(verdict.blockers)).toContain('Check "Battery health" failed.')
    expect(verdict.warnings).toEqual(['Optional check "Lens cloth" failed.'])
  })

  it('does not require an answer to an optional check', () => {
    const verdict = verificationVerdict(handover({ checklist: [{ id: 'c1', label: 'Lens cloth', description: null, phase: 'HANDOVER', isRequired: false, sortOrder: 0, result: null, prepared: null }] }))
    expect(verdict.complete).toBe(true)
  })

  // Software no longer gates a handover (user-directed review): a gap is noted, named, and not a blocker.
  it('notes required software that is not installed, naming the version, without blocking', () => {
    const verdict = verificationVerdict(
      handover({
        software: [{ id: 's1', softwareApplicationId: 'app-1', status: 'NOT_INSTALLED', installedVersion: null, notes: null, nameSnapshot: 'DaVinci Resolve', versionSnapshot: '19', vendorSnapshot: 'Blackmagic', isRequired: true, sortOrder: 0 }],
      }),
    )
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toContain('DaVinci Resolve 19 is not installed; noted, not blocking.')
  })

  it('accepts software marked not applicable, and notes any other gap', () => {
    const verdict = verificationVerdict(
      handover({
        software: [
          { id: 's1', softwareApplicationId: 'app-1', status: 'NOT_APPLICABLE', installedVersion: null, notes: null, nameSnapshot: 'Pro Tools', versionSnapshot: null, vendorSnapshot: null, isRequired: true, sortOrder: 0 },
          { id: 's2', softwareApplicationId: 'app-2', status: 'LICENSE_ISSUE', installedVersion: null, notes: null, nameSnapshot: 'After Effects', versionSnapshot: null, vendorSnapshot: null, isRequired: false, sortOrder: 1 },
        ],
      }),
    )
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toEqual(['After Effects is license issue; noted, not blocking.'])
  })

  it('refuses completion until both parties have signed, naming whichever is absent', () => {
    const neither = verificationVerdict(handover({ signatures: [] }))
    expect(reasons(neither.blockers)).toContain('The editor has not signed.')
    expect(reasons(neither.blockers)).toContain('The engineer has not signed.')

    const editorOnly = verificationVerdict(handover({ signatures: [handover().signatures[0]] }))
    expect(reasons(editorOnly.blockers)).toBe('The engineer has not signed.')

    const engineerOnly = verificationVerdict(handover({ signatures: [handover().signatures[1]] }))
    expect(reasons(engineerOnly.blockers)).toBe('The editor has not signed.')
  })

  it('ignores a return signature when deciding whether a handover is signed', () => {
    const verdict = verificationVerdict(
      handover({ signatures: [{ id: 'sig-x', type: SignatureType.RETURN_ENGINEER, signerRole: 'ENGINEER', signerName: 'Omar Said', signerStaffId: null, signedAt: new Date() }] }),
    )
    expect(verdict.blockers).toHaveLength(2)
  })
})

// -----------------------------------------------------------------------------
// Return eligibility
// -----------------------------------------------------------------------------

describe('bookingReturnBlockers', () => {
  it('clears a checked-out booking with a completed handover', () => {
    expect(bookingReturnBlockers(booking({ status: BookingStatus.CHECKED_OUT }), handoverRecord(), false)).toEqual([])
  })

  it('clears an overdue booking, because late equipment still has to come back', () => {
    expect(bookingReturnBlockers(booking({ status: BookingStatus.OVERDUE }), handoverRecord(), false)).toEqual([])
  })

  it('says a completed booking has already been returned', () => {
    const blockers = bookingReturnBlockers(booking({ status: BookingStatus.COMPLETED }), handoverRecord(), false)
    expect(reasons(blockers)).toContain('BK-2026-000001 has already been returned and completed.')
  })

  it.each([BookingStatus.DRAFT, BookingStatus.RESERVED, BookingStatus.READY_FOR_HANDOVER, BookingStatus.CANCELLED])('refuses to start a return on a booking that is %s', (status) => {
    const blockers = bookingReturnBlockers(booking({ status }), handoverRecord(), false)
    expect(reasons(blockers)).toContain('only a kit that is out can be returned')
  })

  it('lets a started return continue while the booking is in return inspection', () => {
    expect(bookingReturnBlockers(booking({ status: BookingStatus.RETURN_INSPECTION }), handoverRecord(), true)).toEqual([])
  })

  it('refuses to continue a started return if the booking has moved elsewhere', () => {
    const blockers = bookingReturnBlockers(booking({ status: BookingStatus.CHECKED_OUT }), handoverRecord(), true)
    expect(reasons(blockers)).toContain('the return inspection cannot continue')
  })

  it('refuses a return with no handover to measure against', () => {
    const blockers = bookingReturnBlockers(booking({ status: BookingStatus.CHECKED_OUT }), null, false)
    expect(codes(blockers)).toContain('handover')
    expect(reasons(blockers)).toContain('has no handover on record, so there is nothing to check the return against')
  })

  it('refuses a return when the handover was never completed', () => {
    const blockers = bookingReturnBlockers(booking({ status: BookingStatus.CHECKED_OUT }), handoverRecord({ completed: false, status: 'IN_PROGRESS' }), false)
    expect(reasons(blockers)).toContain('was never completed. Complete or void it first.')
  })

  it('refuses a return when the handover recorded no equipment', () => {
    const blockers = bookingReturnBlockers(booking({ status: BookingStatus.CHECKED_OUT }), handoverRecord({ lines: [] }), false)
    expect(reasons(blockers)).toContain('recorded no equipment')
  })

  it('refuses a return whose kit has been removed, and says who can fix it', () => {
    const blockers = bookingReturnBlockers(booking({ status: BookingStatus.CHECKED_OUT, kit: { ...booking().kit, deleted: true } }), handoverRecord(), false)
    expect(reasons(blockers)).toContain('an administrator must restore it before the return can be recorded')
  })
})

// -----------------------------------------------------------------------------
// Return completion
// -----------------------------------------------------------------------------

describe('returnVerdict', () => {
  it('allows completion when every handed-over item is accounted for and the engineer has signed', () => {
    const verdict = returnVerdict(returnInspection())
    expect(verdict.blockers).toEqual([])
    expect(verdict.unanswered).toBe(0)
    expect(verdict.complete).toBe(true)
  })

  it('refuses a return with nothing that went out', () => {
    const verdict = returnVerdict(returnInspection({ lines: [returnLine({ wasHandedOver: false })] }))
    expect(reasons(verdict.blockers)).toContain('This return has no handed-over equipment to account for.')
  })

  it('refuses completion while a handed-over item has no answer, and names it', () => {
    const verdict = returnVerdict(returnInspection({ lines: [returnLine({ status: ItemConditionStatus.NOT_APPLICABLE })] }))
    expect(reasons(verdict.blockers)).toContain('1 handed-over item has no return answer: AST-000001.')
    expect(verdict.unanswered).toBe(1)
    expect(verdict.complete).toBe(false)
  })

  it('lists at most four unanswered items and then says there are more', () => {
    const lines = Array.from({ length: 6 }, (_, index) =>
      returnLine({ id: `line-${index}`, status: ItemConditionStatus.NOT_APPLICABLE, assetCodeSnapshot: `AST-00000${index + 1}` }),
    )
    const verdict = returnVerdict(returnInspection({ lines }))
    expect(reasons(verdict.blockers)).toContain('6 handed-over items have no return answer: AST-000001, AST-000002, AST-000003, AST-000004 and more.')
    expect(verdict.unanswered).toBe(6)
  })

  it('does not expect an answer for something that never went out', () => {
    const verdict = returnVerdict(returnInspection({ lines: [returnLine(), returnLine({ id: 'line-2', wasHandedOver: false, status: ItemConditionStatus.NOT_APPLICABLE })] }))
    expect(verdict.unanswered).toBe(0)
    expect(verdict.complete).toBe(true)
  })

  it('lets a missing item through as a warning, because the booking still has to close', () => {
    const verdict = returnVerdict(returnInspection({ lines: [returnLine({ status: ItemConditionStatus.MISSING })] }))
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toContain('AST-000001 MacBook Pro 16 did not come back; an issue will be raised.')
    expect(verdict.complete).toBe(true)
  })

  it('lets a damaged item through as a warning that promises an issue', () => {
    const verdict = returnVerdict(returnInspection({ lines: [returnLine({ status: ItemConditionStatus.DAMAGED })] }))
    expect(verdict.warnings).toContain('AST-000001 MacBook Pro 16 came back damaged; an issue will be raised.')
    expect(verdict.complete).toBe(true)
  })

  it('warns about an accessory that went out and has no answer, without blocking', () => {
    const verdict = returnVerdict(
      returnInspection({
        lines: [
          returnLine({
            accessories: [
              { id: 'acc-1', accessoryId: 'a-1', status: ItemConditionStatus.NOT_APPLICABLE, quantityExpected: 1, quantityReceived: null, notes: null, labelSnapshot: 'Charger', accessoryTypeSnapshot: 'CHARGER', serialNumberSnapshot: null, admBarcodeSnapshot: null, handoverStatus: ItemConditionStatus.INCLUDED, wasHandedOver: true },
            ],
          }),
        ],
      }),
    )
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toContain('AST-000001: Charger has no return answer; it will be recorded as not accounted for.')
  })

  it('warns that a missing accessory will raise an issue, and ignores one that never went out', () => {
    const verdict = returnVerdict(
      returnInspection({
        lines: [
          returnLine({
            accessories: [
              { id: 'acc-1', accessoryId: 'a-1', status: ItemConditionStatus.MISSING, quantityExpected: 1, quantityReceived: 0, notes: null, labelSnapshot: 'Charger', accessoryTypeSnapshot: 'CHARGER', serialNumberSnapshot: null, admBarcodeSnapshot: null, handoverStatus: ItemConditionStatus.INCLUDED, wasHandedOver: true },
              { id: 'acc-2', accessoryId: 'a-2', status: ItemConditionStatus.MISSING, quantityExpected: 1, quantityReceived: 0, notes: null, labelSnapshot: 'Pouch', accessoryTypeSnapshot: 'CASE', serialNumberSnapshot: null, admBarcodeSnapshot: null, handoverStatus: null, wasHandedOver: false },
            ],
          }),
        ],
      }),
    )
    expect(verdict.warnings).toContain('AST-000001: Charger is not returned; an issue will be raised.')
    expect(verdict.warnings.filter((warning) => warning.includes('Pouch'))).toEqual([])
  })

  it('refuses completion while a required return check is unanswered', () => {
    const verdict = returnVerdict(returnInspection({ checklist: [{ id: 'c1', label: 'Case intact', description: null, phase: 'RETURN', isRequired: true, sortOrder: 0, result: null }] }))
    expect(reasons(verdict.blockers)).toContain('1 required return check has not been answered.')
  })

  it('lets a failed return check through as a warning that promises an issue', () => {
    const verdict = returnVerdict(returnInspection({ checklist: [{ id: 'c1', label: 'Case intact', description: null, phase: 'RETURN', isRequired: true, sortOrder: 0, result: { status: 'FAIL', notes: null } }] }))
    expect(verdict.blockers).toEqual([])
    expect(verdict.warnings).toContain('Return check "Case intact" failed; an issue will be raised.')
  })

  it('refuses completion until the receiving engineer has signed', () => {
    const verdict = returnVerdict(returnInspection({ signatures: [] }))
    expect(reasons(verdict.blockers)).toContain('The engineer receiving the kit has not signed.')
    expect(verdict.complete).toBe(false)
  })

  it('treats a missing editor signature as expected rather than as a problem', () => {
    const verdict = returnVerdict(returnInspection())
    expect(verdict.complete).toBe(true)
    expect(verdict.warnings).toEqual(['The editor has not signed for the return. That is expected when the kit is dropped off without them.'])
  })

  it('says nothing about the editor once they have signed too', () => {
    const verdict = returnVerdict(
      returnInspection({
        signatures: [
          ...returnInspection().signatures,
          { id: 'sig-4', type: SignatureType.RETURN_EDITOR, signerRole: 'EDITOR', signerName: 'Layla Haddad', signerStaffId: null, signedAt: new Date('2026-03-05T05:32:00.000Z') },
        ],
      }),
    )
    expect(verdict.warnings).toEqual([])
  })

  it('does not accept a handover signature as the return signature', () => {
    const verdict = returnVerdict(returnInspection({ signatures: [{ id: 'sig-1', type: SignatureType.HANDOVER_ENGINEER, signerRole: 'ENGINEER', signerName: 'Omar Said', signerStaffId: null, signedAt: new Date() }] }))
    expect(reasons(verdict.blockers)).toContain('The engineer receiving the kit has not signed.')
  })
})

// -----------------------------------------------------------------------------
// What the kit becomes
// -----------------------------------------------------------------------------

describe('kitStatusAfterReturn', () => {
  it('puts a healthy kit back into service', () => {
    expect(kitStatusAfterReturn(readiness({ available: true }))).toEqual({ status: KitStatus.AVAILABLE, reason: 'every required item is back and healthy' })
  })

  it('sends a kit with equipment in maintenance to maintenance, not damaged', () => {
    const result = kitStatusAfterReturn(
      readiness({ available: false, reasons: [reason({ code: 'asset_maintenance', reason: 'AST-000009 is in maintenance.' })] }),
    )
    expect(result.status).toBe(KitStatus.MAINTENANCE)
    expect(result.reason).toBe('AST-000009 is in maintenance.')
  })

  it('marks a kit damaged when something came back broken or did not come back', () => {
    const result = kitStatusAfterReturn(readiness({ available: false, reasons: [reason({ code: 'asset_status', reason: 'AST-000009 is damaged.' })] }))
    expect(result.status).toBe(KitStatus.DAMAGED)
    expect(result.reason).toBe('AST-000009 is damaged.')
  })

  it('joins every blocking reason into the recorded explanation', () => {
    const result = kitStatusAfterReturn(
      readiness({ available: false, reasons: [reason({ reason: 'AST-000009 is damaged.' }), reason({ assetCode: 'AST-000010', reason: 'AST-000010 did not come back.' })] }),
    )
    expect(result.reason).toBe('AST-000009 is damaged. AST-000010 did not come back.')
  })

  it('holds the kit in maintenance rather than guessing when it cannot be evaluated', () => {
    expect(kitStatusAfterReturn(null)).toEqual({ status: KitStatus.MAINTENANCE, reason: 'the kit could not be evaluated after the return' })
  })

  it('does not return a kit to service on the strength of the booking closing alone', () => {
    // An unavailable kit with only warnings is still not available, and the
    // rule must not read "no blocking reasons" as "ready".
    const result = kitStatusAfterReturn(readiness({ available: false, reasons: [reason({ severity: 'warning', reason: 'An optional item is missing.' })] }))
    expect(result.status).toBe(KitStatus.DAMAGED)
    expect(result.reason).toBe('the kit is not ready')
  })
})
