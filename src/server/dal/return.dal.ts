import 'server-only'

import {
  type ChecklistPhase,
  type ChecklistStatus,
  type InspectionStatus,
  InspectionType,
  type IssueSeverity,
  type IssueStatus,
  type IssueType,
  type ItemConditionStatus,
  type SuitcaseStatus,
} from '@prisma/client'

import { ACTIVE_MAINTENANCE_STATUSES } from '@/server/dal/assets.dal'
import type { HandoverSignatureMeta } from '@/server/dal/handover.dal'
import type { Db } from '@/server/db/prisma'

/**
 * Return-inspection reads.
 *
 * The return is an `Inspection` of type RETURN. Its lines are copied from the
 * *completed handover*, never from the kit's current composition: what has to
 * come back is what actually went out, whatever an administrator has done to
 * the kit since. `getHandoverLinesForReturn` is that historical source;
 * `getLiveReturn` is the working document.
 *
 * Signature rows leave here as who-and-when only, never with a storage path or
 * hash - the same rule as the handover.
 */

export type { HandoverSignatureMeta as InspectionSignatureMeta }

// -----------------------------------------------------------------------------
// The historical source: the completed handover
// -----------------------------------------------------------------------------

export interface ReturnSourceAccessory {
  accessoryId: string
  labelSnapshot: string
  accessoryTypeSnapshot: string
  serialNumberSnapshot: string | null
  admBarcodeSnapshot: string | null
  /** What went out: the quantity received at handover, else the expected one. */
  quantityHandedOver: number
  handoverStatus: ItemConditionStatus
  sortOrder: number
}

export interface ReturnSourceLine {
  assetId: string
  kitAssetId: string | null
  sortOrder: number
  slotLabelSnapshot: string | null
  assetCodeSnapshot: string
  categoryNameSnapshot: string
  nameSnapshot: string
  manufacturerSnapshot: string | null
  modelSnapshot: string | null
  serialNumberSnapshot: string | null
  admBarcodeSnapshot: string | null
  handoverStatus: ItemConditionStatus
  handoverNotes: string | null
  /** True when the handover recorded this item as actually handed over. */
  wasHandedOver: boolean
  accessories: ReturnSourceAccessory[]
}

export interface HandoverRecord {
  inspectionId: string
  status: InspectionStatus
  completed: boolean
  completedAt: Date | null
  completedByName: string | null
  suitcaseStatus: SuitcaseStatus
  generalNotes: string | null
  lines: ReturnSourceLine[]
  signatures: HandoverSignatureMeta[]
}

/**
 * The booking's handover as the return needs it: every line that was recorded,
 * with the condition it left in. Returns null when no handover exists.
 */
export async function getHandoverForReturn(db: Db, bookingId: string): Promise<HandoverRecord | null> {
  const inspection = await db.inspection.findFirst({
    where: { bookingId, type: InspectionType.HANDOVER, voidedAt: null },
    select: {
      id: true,
      status: true,
      completedAt: true,
      suitcaseStatus: true,
      generalNotes: true,
      completedBy: { select: { name: true } },
      signatures: { where: { voidedAt: null }, select: { id: true, type: true, signerRole: true, signerName: true, signerStaffId: true, signedAt: true } },
      assetInspections: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          assetId: true,
          kitAssetId: true,
          sortOrder: true,
          status: true,
          notes: true,
          slotLabelSnapshot: true,
          assetCodeSnapshot: true,
          categoryNameSnapshot: true,
          nameSnapshot: true,
          manufacturerSnapshot: true,
          modelSnapshot: true,
          serialNumberSnapshot: true,
          admBarcodeSnapshot: true,
          accessoryInspections: {
            orderBy: [{ sortOrder: 'asc' }],
            select: {
              accessoryId: true,
              status: true,
              quantityExpected: true,
              quantityReceived: true,
              sortOrder: true,
              labelSnapshot: true,
              accessoryTypeSnapshot: true,
              serialNumberSnapshot: true,
              admBarcodeSnapshot: true,
            },
          },
        },
      },
    },
  })
  if (!inspection) return null

  return {
    inspectionId: inspection.id,
    status: inspection.status,
    completed: inspection.status === 'COMPLETED',
    completedAt: inspection.completedAt,
    completedByName: inspection.completedBy?.name ?? null,
    suitcaseStatus: inspection.suitcaseStatus,
    generalNotes: inspection.generalNotes,
    signatures: inspection.signatures,
    lines: inspection.assetInspections.map((line) => ({
      assetId: line.assetId,
      kitAssetId: line.kitAssetId,
      sortOrder: line.sortOrder,
      slotLabelSnapshot: line.slotLabelSnapshot,
      assetCodeSnapshot: line.assetCodeSnapshot,
      categoryNameSnapshot: line.categoryNameSnapshot,
      nameSnapshot: line.nameSnapshot,
      manufacturerSnapshot: line.manufacturerSnapshot,
      modelSnapshot: line.modelSnapshot,
      serialNumberSnapshot: line.serialNumberSnapshot,
      admBarcodeSnapshot: line.admBarcodeSnapshot,
      handoverStatus: line.status,
      handoverNotes: line.notes,
      wasHandedOver: line.status === 'INCLUDED',
      accessories: line.accessoryInspections.map((accessory) => ({
        accessoryId: accessory.accessoryId,
        labelSnapshot: accessory.labelSnapshot,
        accessoryTypeSnapshot: accessory.accessoryTypeSnapshot,
        serialNumberSnapshot: accessory.serialNumberSnapshot,
        admBarcodeSnapshot: accessory.admBarcodeSnapshot,
        quantityHandedOver: accessory.quantityReceived ?? accessory.quantityExpected,
        handoverStatus: accessory.status,
        sortOrder: accessory.sortOrder,
      })),
    })),
  }
}

// -----------------------------------------------------------------------------
// The live return
// -----------------------------------------------------------------------------

export interface ReturnAccessoryLine {
  id: string
  accessoryId: string
  status: ItemConditionStatus
  quantityExpected: number
  quantityReceived: number | null
  notes: string | null
  labelSnapshot: string
  accessoryTypeSnapshot: string
  serialNumberSnapshot: string | null
  admBarcodeSnapshot: string | null
  /** How this accessory left, from the handover document. */
  handoverStatus: ItemConditionStatus | null
  /** It went out, so an explicit return answer is expected. */
  wasHandedOver: boolean
}

export interface ReturnAssetLine {
  id: string
  assetId: string
  kitAssetId: string | null
  status: ItemConditionStatus
  notes: string | null
  sortOrder: number
  slotLabelSnapshot: string | null
  assetCodeSnapshot: string
  categoryNameSnapshot: string
  nameSnapshot: string
  manufacturerSnapshot: string | null
  modelSnapshot: string | null
  serialNumberSnapshot: string | null
  admBarcodeSnapshot: string | null
  /** How this item left, from the handover document. */
  handoverStatus: ItemConditionStatus | null
  handoverNotes: string | null
  /** It went out, so it has to be accounted for on return. */
  wasHandedOver: boolean
  /** The asset today, for context - not for deciding what must come back. */
  current: { status: string; deleted: boolean; activeMaintenanceCount: number; stillInKit: boolean }
  accessories: ReturnAccessoryLine[]
}

export interface ReturnChecklistLine {
  id: string
  label: string
  description: string | null
  phase: ChecklistPhase
  isRequired: boolean
  sortOrder: number
  result: { status: ChecklistStatus; notes: string | null } | null
}

export interface ReturnInspection {
  id: string
  status: InspectionStatus
  suitcaseStatus: SuitcaseStatus
  generalNotes: string | null
  startedAt: Date
  startedByName: string | null
  completedAt: Date | null
  completedByName: string | null
  lockedAt: Date | null
  lines: ReturnAssetLine[]
  checklist: ReturnChecklistLine[]
  signatures: HandoverSignatureMeta[]
}

const RETURN_PHASES: ChecklistPhase[] = ['RETURN', 'BOTH']

/** The live (not voided) return inspection with every line, or null. */
export async function getLiveReturn(db: Db, bookingId: string): Promise<ReturnInspection | null> {
  const inspection = await db.inspection.findFirst({
    where: { bookingId, type: InspectionType.RETURN, voidedAt: null },
    select: {
      id: true,
      status: true,
      suitcaseStatus: true,
      generalNotes: true,
      startedAt: true,
      completedAt: true,
      lockedAt: true,
      startedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      assetInspections: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          assetId: true,
          kitAssetId: true,
          status: true,
          notes: true,
          sortOrder: true,
          slotLabelSnapshot: true,
          assetCodeSnapshot: true,
          categoryNameSnapshot: true,
          nameSnapshot: true,
          manufacturerSnapshot: true,
          modelSnapshot: true,
          serialNumberSnapshot: true,
          admBarcodeSnapshot: true,
          asset: {
            select: {
              status: true,
              deletedAt: true,
              kitAssets: { where: { removedAt: null }, select: { id: true, kitId: true }, take: 1 },
              _count: { select: { maintenanceRecords: { where: { deletedAt: null, status: { in: [...ACTIVE_MAINTENANCE_STATUSES] } } } } },
            },
          },
          accessoryInspections: {
            orderBy: [{ sortOrder: 'asc' }],
            select: {
              id: true,
              accessoryId: true,
              status: true,
              quantityExpected: true,
              quantityReceived: true,
              notes: true,
              labelSnapshot: true,
              accessoryTypeSnapshot: true,
              serialNumberSnapshot: true,
              admBarcodeSnapshot: true,
            },
          },
        },
      },
      signatures: { where: { voidedAt: null }, select: { id: true, type: true, signerRole: true, signerName: true, signerStaffId: true, signedAt: true } },
      booking: {
        select: {
          kitId: true,
          checklistItems: {
            where: { phase: { in: RETURN_PHASES } },
            orderBy: [{ sortOrder: 'asc' }],
            select: { id: true, label: true, description: true, phase: true, isRequired: true, sortOrder: true },
          },
        },
      },
    },
  })
  if (!inspection) return null

  // The handover is the authority on what went out; join it in by asset and
  // accessory so each row can show the condition it left in.
  const [results, handover] = await Promise.all([
    db.checklistResult.findMany({ where: { inspectionId: inspection.id }, select: { bookingChecklistItemId: true, status: true, notes: true } }),
    getHandoverForReturn(db, bookingId),
  ])
  const resultByItem = new Map(results.map((result) => [result.bookingChecklistItemId, { status: result.status, notes: result.notes }]))
  const handoverByAsset = new Map((handover?.lines ?? []).map((line) => [line.assetId, line]))
  const handoverByAccessory = new Map((handover?.lines ?? []).flatMap((line) => line.accessories.map((accessory) => [accessory.accessoryId, accessory] as const)))

  return {
    id: inspection.id,
    status: inspection.status,
    suitcaseStatus: inspection.suitcaseStatus,
    generalNotes: inspection.generalNotes,
    startedAt: inspection.startedAt,
    startedByName: inspection.startedBy?.name ?? null,
    completedAt: inspection.completedAt,
    completedByName: inspection.completedBy?.name ?? null,
    lockedAt: inspection.lockedAt,
    lines: inspection.assetInspections.map((line) => {
      const source = handoverByAsset.get(line.assetId) ?? null
      return {
        id: line.id,
        assetId: line.assetId,
        kitAssetId: line.kitAssetId,
        status: line.status,
        notes: line.notes,
        sortOrder: line.sortOrder,
        slotLabelSnapshot: line.slotLabelSnapshot,
        assetCodeSnapshot: line.assetCodeSnapshot,
        categoryNameSnapshot: line.categoryNameSnapshot,
        nameSnapshot: line.nameSnapshot,
        manufacturerSnapshot: line.manufacturerSnapshot,
        modelSnapshot: line.modelSnapshot,
        serialNumberSnapshot: line.serialNumberSnapshot,
        admBarcodeSnapshot: line.admBarcodeSnapshot,
        handoverStatus: source?.handoverStatus ?? null,
        handoverNotes: source?.handoverNotes ?? null,
        wasHandedOver: source?.wasHandedOver ?? false,
        current: {
          status: line.asset.status,
          deleted: line.asset.deletedAt !== null,
          activeMaintenanceCount: line.asset._count.maintenanceRecords,
          stillInKit: line.asset.kitAssets.some((membership) => membership.kitId === inspection.booking.kitId),
        },
        accessories: line.accessoryInspections.map((accessory) => {
          const accessorySource = handoverByAccessory.get(accessory.accessoryId) ?? null
          return {
            id: accessory.id,
            accessoryId: accessory.accessoryId,
            status: accessory.status,
            quantityExpected: accessory.quantityExpected,
            quantityReceived: accessory.quantityReceived,
            notes: accessory.notes,
            labelSnapshot: accessory.labelSnapshot,
            accessoryTypeSnapshot: accessory.accessoryTypeSnapshot,
            serialNumberSnapshot: accessory.serialNumberSnapshot,
            admBarcodeSnapshot: accessory.admBarcodeSnapshot,
            handoverStatus: accessorySource?.handoverStatus ?? null,
            wasHandedOver: accessorySource?.handoverStatus === 'INCLUDED',
          }
        }),
      }
    }),
    checklist: inspection.booking.checklistItems.map((item) => ({ ...item, result: resultByItem.get(item.id) ?? null })),
    signatures: inspection.signatures,
  }
}

// -----------------------------------------------------------------------------
// Summary for the booking page
// -----------------------------------------------------------------------------

export interface ReturnIssueRow {
  id: string
  issueNumber: string
  type: IssueType
  severity: IssueSeverity
  status: IssueStatus
  title: string
  assetCode: string | null
}

export interface ReturnSummary {
  inspectionId: string
  status: InspectionStatus
  startedAt: Date
  startedByName: string | null
  completedAt: Date | null
  completedByName: string | null
  suitcaseStatus: SuitcaseStatus
  generalNotes: string | null
  accountedCount: number
  returnedCount: number
  damagedCount: number
  missingCount: number
  accessoryProblemCount: number
  checklistTotal: number
  checklistPassed: number
  signatures: HandoverSignatureMeta[]
  issues: ReturnIssueRow[]
}

/** Compact facts about the return for the booking workspace. */
export async function getReturnSummary(db: Db, bookingId: string): Promise<ReturnSummary | null> {
  const inspection = await db.inspection.findFirst({
    where: { bookingId, type: InspectionType.RETURN, voidedAt: null },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      suitcaseStatus: true,
      generalNotes: true,
      startedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      assetInspections: { select: { status: true } },
      accessoryInspections: { select: { status: true } },
      checklistResults: { select: { status: true } },
      signatures: { where: { voidedAt: null }, select: { id: true, type: true, signerRole: true, signerName: true, signerStaffId: true, signedAt: true } },
    },
  })
  if (!inspection) return null

  const issues = await db.issue.findMany({
    where: { inspectionId: inspection.id },
    orderBy: [{ createdAt: 'asc' }],
    select: { id: true, issueNumber: true, type: true, severity: true, status: true, title: true, asset: { select: { assetCode: true } } },
  })

  const lines = inspection.assetInspections
  return {
    inspectionId: inspection.id,
    status: inspection.status,
    startedAt: inspection.startedAt,
    startedByName: inspection.startedBy?.name ?? null,
    completedAt: inspection.completedAt,
    completedByName: inspection.completedBy?.name ?? null,
    suitcaseStatus: inspection.suitcaseStatus,
    generalNotes: inspection.generalNotes,
    accountedCount: lines.filter((line) => line.status !== 'NOT_APPLICABLE').length,
    returnedCount: lines.filter((line) => line.status === 'INCLUDED').length,
    damagedCount: lines.filter((line) => line.status === 'DAMAGED').length,
    missingCount: lines.filter((line) => line.status === 'MISSING').length,
    accessoryProblemCount: inspection.accessoryInspections.filter((accessory) => accessory.status === 'MISSING' || accessory.status === 'DAMAGED').length,
    checklistTotal: inspection.checklistResults.length,
    checklistPassed: inspection.checklistResults.filter((result) => result.status === 'PASS').length,
    signatures: inspection.signatures,
    issues: issues.map((issue) => ({
      id: issue.id,
      issueNumber: issue.issueNumber,
      type: issue.type,
      severity: issue.severity,
      status: issue.status,
      title: issue.title,
      assetCode: issue.asset?.assetCode ?? null,
    })),
  }
}
