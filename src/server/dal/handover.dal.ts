import 'server-only'

import {
  type BookingStatus,
  type ChecklistPhase,
  type ChecklistStatus,
  type InspectionStatus,
  InspectionType,
  type ItemConditionStatus,
  type KitStatus,
  type Prisma,
  type SignatureType,
  type SignerRole,
  type SoftwareStatus,
  type SuitcaseStatus,
} from '@prisma/client'

import { ACTIVE_MAINTENANCE_STATUSES } from '@/server/dal/assets.dal'
import type { Db } from '@/server/db/prisma'

/**
 * Handover reads. The handover is an `Inspection` of type HANDOVER with
 * snapshot lines for every kit member (`AssetInspection`), their accessories
 * (`AccessoryInspection`), the kit's software (`SoftwareCheck`) and the
 * booking's checklist (`BookingChecklistItem` + `ChecklistResult`), plus the
 * two signatures. Everything here returns display rows with explicit selects;
 * signature rows never leave with their storage path or hash.
 */

// -----------------------------------------------------------------------------
// The booking as the handover needs it
// -----------------------------------------------------------------------------

export interface HandoverBooking {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
  purpose: string | null
  notes: string | null
  checklistTemplateId: string | null
  editor: {
    id: string
    fullName: string
    staffId: string | null
    isExternal: boolean
    isActive: boolean
    deleted: boolean
    contactNumber: string | null
    email: string | null
    company: string | null
    department: string | null
  }
  kit: { id: string; kitCode: string; name: string; status: KitStatus; admBarcode: string | null; suitcaseStatus: SuitcaseStatus; deleted: boolean; defaultChecklistTemplateId: string | null }
  engineer: { id: string; fullName: string; staffId: string | null; userId: string }
}

export async function getHandoverBooking(db: Db, bookingId: string): Promise<HandoverBooking | null> {
  const booking = await db.booking.findFirst({
    where: { id: bookingId, deletedAt: null },
    select: {
      id: true,
      bookingNumber: true,
      status: true,
      bookingStart: true,
      bookingEnd: true,
      collectionDate: true,
      expectedReturnDate: true,
      purpose: true,
      notes: true,
      checklistTemplateId: true,
      editor: {
        select: { id: true, fullName: true, staffId: true, isExternal: true, isActive: true, deletedAt: true, contactNumber: true, email: true, company: true, department: true },
      },
      kit: { select: { id: true, kitCode: true, name: true, status: true, admBarcode: true, suitcaseStatus: true, deletedAt: true, defaultChecklistTemplateId: true } },
      engineer: { select: { id: true, fullName: true, staffId: true, userId: true } },
    },
  })
  if (!booking) return null
  const { deletedAt: editorDeleted, ...editor } = booking.editor
  const { deletedAt: kitDeleted, ...kit } = booking.kit
  return { ...booking, editor: { ...editor, deleted: editorDeleted !== null }, kit: { ...kit, deleted: kitDeleted !== null } }
}

// -----------------------------------------------------------------------------
// Snapshot sources (read once, when the handover starts)
// -----------------------------------------------------------------------------

export interface SnapshotMember {
  kitAssetId: string
  assetId: string
  slotLabel: string | null
  isRequired: boolean
  sortOrder: number
  assetCode: string
  name: string
  categoryName: string
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  admBarcode: string | null
  accessories: Array<{ id: string; label: string | null; typeName: string; quantity: number; isRequired: boolean; serialNumber: string | null; admBarcode: string | null; sortOrder: number }>
}

export async function getSnapshotMembers(db: Db, kitId: string): Promise<SnapshotMember[]> {
  const rows = await db.kitAsset.findMany({
    where: { kitId, removedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { addedAt: 'asc' }],
    select: {
      id: true,
      slotLabel: true,
      isRequired: true,
      sortOrder: true,
      asset: {
        select: {
          id: true,
          assetCode: true,
          name: true,
          manufacturer: true,
          model: true,
          serialNumber: true,
          admBarcode: true,
          category: { select: { name: true } },
          accessories: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, label: true, quantity: true, isRequired: true, serialNumber: true, admBarcode: true, sortOrder: true, accessoryType: { select: { name: true } } },
          },
        },
      },
    },
  })
  return rows.map((row) => ({
    kitAssetId: row.id,
    assetId: row.asset.id,
    slotLabel: row.slotLabel,
    isRequired: row.isRequired,
    sortOrder: row.sortOrder,
    assetCode: row.asset.assetCode,
    name: row.asset.name,
    categoryName: row.asset.category.name,
    manufacturer: row.asset.manufacturer,
    model: row.asset.model,
    serialNumber: row.asset.serialNumber,
    admBarcode: row.asset.admBarcode,
    accessories: row.asset.accessories.map((accessory) => ({
      id: accessory.id,
      label: accessory.label,
      typeName: accessory.accessoryType.name,
      quantity: accessory.quantity,
      isRequired: accessory.isRequired,
      serialNumber: accessory.serialNumber,
      admBarcode: accessory.admBarcode,
      sortOrder: accessory.sortOrder,
    })),
  }))
}

export interface SnapshotSoftware {
  softwareApplicationId: string
  name: string
  version: string | null
  vendor: string | null
  isRequired: boolean
  sortOrder: number
}

export async function getSnapshotSoftware(db: Db, kitId: string): Promise<SnapshotSoftware[]> {
  const rows = await db.kitSoftware.findMany({
    where: { kitId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { isRequired: true, sortOrder: true, software: { select: { id: true, name: true, version: true, vendor: true } } },
  })
  return rows.map((row) => ({ softwareApplicationId: row.software.id, name: row.software.name, version: row.software.version, vendor: row.software.vendor, isRequired: row.isRequired, sortOrder: row.sortOrder }))
}

export interface SnapshotChecklistItem {
  sourceTemplateItemId: string
  label: string
  description: string | null
  phase: ChecklistPhase
  isRequired: boolean
  sortOrder: number
}

/** The kit's own template, else the system default; null when neither exists. */
export async function getChecklistTemplateForKit(db: Db, kitTemplateId: string | null): Promise<{ id: string; name: string; items: SnapshotChecklistItem[] } | null> {
  const template =
    (kitTemplateId
      ? await db.checklistTemplate.findFirst({ where: { id: kitTemplateId, deletedAt: null, isActive: true }, select: { id: true, name: true } })
      : null) ?? (await db.checklistTemplate.findFirst({ where: { isDefault: true, deletedAt: null, isActive: true }, select: { id: true, name: true } }))
  if (!template) return null
  const items = await db.checklistTemplateItem.findMany({
    where: { templateId: template.id },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true, label: true, description: true, phase: true, isRequired: true, sortOrder: true },
  })
  return { id: template.id, name: template.name, items: items.map((item) => ({ sourceTemplateItemId: item.id, label: item.label, description: item.description, phase: item.phase, isRequired: item.isRequired, sortOrder: item.sortOrder })) }
}

// -----------------------------------------------------------------------------
// The live handover
// -----------------------------------------------------------------------------

export interface HandoverAccessoryLine {
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
  isRequired: boolean
}

export interface HandoverAssetLine {
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
  /** From the kit membership at snapshot time; a removed membership counts as required. */
  isRequired: boolean
  /** The asset today - status and active maintenance - for the readiness re-check display. */
  current: { status: string; deleted: boolean; activeMaintenanceCount: number; stillInKit: boolean }
  accessories: HandoverAccessoryLine[]
}

export interface HandoverSoftwareLine {
  id: string
  softwareApplicationId: string
  status: SoftwareStatus
  installedVersion: string | null
  notes: string | null
  nameSnapshot: string
  versionSnapshot: string | null
  vendorSnapshot: string | null
  isRequired: boolean
  sortOrder: number
}

export interface HandoverChecklistLine {
  id: string
  label: string
  description: string | null
  phase: ChecklistPhase
  isRequired: boolean
  sortOrder: number
  result: { status: ChecklistStatus; notes: string | null } | null
}

/** What the page may know about a signature: who, when - never where it is stored. */
export interface HandoverSignatureMeta {
  id: string
  type: SignatureType
  signerRole: SignerRole
  signerName: string
  signerStaffId: string | null
  signedAt: Date
}

export interface HandoverInspection {
  id: string
  status: InspectionStatus
  suitcaseStatus: SuitcaseStatus
  generalNotes: string | null
  startedAt: Date
  startedByName: string | null
  completedAt: Date | null
  completedByName: string | null
  lockedAt: Date | null
  lines: HandoverAssetLine[]
  software: HandoverSoftwareLine[]
  checklist: HandoverChecklistLine[]
  signatures: HandoverSignatureMeta[]
}

const HANDOVER_PHASES: ChecklistPhase[] = ['HANDOVER', 'BOTH']

/** The live (not voided) handover inspection of a booking with every line, or null. */
export async function getLiveHandover(db: Db, bookingId: string): Promise<HandoverInspection | null> {
  const inspection = await db.inspection.findFirst({
    where: { bookingId, type: InspectionType.HANDOVER, voidedAt: null },
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
              kitAssets: { where: { removedAt: null }, select: { id: true, isRequired: true, kitId: true }, take: 1 },
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
              accessory: { select: { isRequired: true } },
            },
          },
        },
      },
      softwareChecks: {
        orderBy: [{ sortOrder: 'asc' }],
        select: { id: true, softwareApplicationId: true, status: true, installedVersion: true, notes: true, nameSnapshot: true, versionSnapshot: true, vendorSnapshot: true, sortOrder: true },
      },
      signatures: {
        where: { voidedAt: null },
        select: { id: true, type: true, signerRole: true, signerName: true, signerStaffId: true, signedAt: true },
      },
      booking: {
        select: {
          kitId: true,
          checklistItems: {
            where: { phase: { in: HANDOVER_PHASES } },
            orderBy: [{ sortOrder: 'asc' }],
            select: { id: true, label: true, description: true, phase: true, isRequired: true, sortOrder: true },
          },
          kit: { select: { kitSoftware: { select: { softwareApplicationId: true, isRequired: true } } } },
        },
      },
    },
  })
  if (!inspection) return null

  const results = await db.checklistResult.findMany({
    where: { inspectionId: inspection.id },
    select: { bookingChecklistItemId: true, status: true, notes: true },
  })
  const resultByItem = new Map(results.map((result) => [result.bookingChecklistItemId, { status: result.status, notes: result.notes }]))
  const requiredSoftware = new Map(inspection.booking.kit.kitSoftware.map((row) => [row.softwareApplicationId, row.isRequired]))
  // Membership at snapshot time: the kitAssetId on the line points at the KitAsset row.
  const kitAssetIds = inspection.assetInspections.map((line) => line.kitAssetId).filter((id): id is string => Boolean(id))
  const memberships = kitAssetIds.length > 0 ? await db.kitAsset.findMany({ where: { id: { in: kitAssetIds } }, select: { id: true, isRequired: true } }) : []
  const requiredByMembership = new Map(memberships.map((row) => [row.id, row.isRequired]))

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
    lines: inspection.assetInspections.map((line) => ({
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
      isRequired: (line.kitAssetId ? requiredByMembership.get(line.kitAssetId) : undefined) ?? true,
      current: {
        status: line.asset.status,
        deleted: line.asset.deletedAt !== null,
        activeMaintenanceCount: line.asset._count.maintenanceRecords,
        stillInKit: line.asset.kitAssets.some((membership) => membership.kitId === inspection.booking.kitId),
      },
      accessories: line.accessoryInspections.map((accessory) => ({
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
        isRequired: accessory.accessory.isRequired,
      })),
    })),
    software: inspection.softwareChecks.map((check) => ({ ...check, isRequired: requiredSoftware.get(check.softwareApplicationId) ?? true })),
    checklist: inspection.booking.checklistItems.map((item) => ({ ...item, result: resultByItem.get(item.id) ?? null })),
    signatures: inspection.signatures,
  }
}

/** Compact facts about a completed handover for the booking workspace. */
export interface HandoverSummary {
  inspectionId: string
  status: InspectionStatus
  completedAt: Date | null
  completedByName: string | null
  startedAt: Date
  lineCount: number
  includedCount: number
  checklistTotal: number
  checklistPassed: number
  signatures: HandoverSignatureMeta[]
}

export async function getHandoverSummary(db: Db, bookingId: string): Promise<HandoverSummary | null> {
  const inspection = await db.inspection.findFirst({
    where: { bookingId, type: InspectionType.HANDOVER, voidedAt: null },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      completedBy: { select: { name: true } },
      assetInspections: { select: { status: true } },
      checklistResults: { select: { status: true } },
      signatures: { where: { voidedAt: null }, select: { id: true, type: true, signerRole: true, signerName: true, signerStaffId: true, signedAt: true } },
    },
  })
  if (!inspection) return null
  return {
    inspectionId: inspection.id,
    status: inspection.status,
    completedAt: inspection.completedAt,
    completedByName: inspection.completedBy?.name ?? null,
    startedAt: inspection.startedAt,
    lineCount: inspection.assetInspections.length,
    includedCount: inspection.assetInspections.filter((line) => line.status === 'INCLUDED').length,
    checklistTotal: inspection.checklistResults.length,
    checklistPassed: inspection.checklistResults.filter((result) => result.status === 'PASS').length,
    signatures: inspection.signatures,
  }
}

/** Signature rows with their storage details - service use only, never returned to pages. */
export async function getLiveSignatureInternal(db: Db, inspectionId: string, type: SignatureType) {
  return db.signature.findFirst({ where: { inspectionId, type, voidedAt: null }, select: { id: true, imagePath: true, imageHash: true, signerName: true, signedAt: true } })
}

/** Quick existence + status read used before every mutation. */
export async function getInspectionState(db: Db, inspectionId: string) {
  return db.inspection.findUnique({ where: { id: inspectionId }, select: { id: true, bookingId: true, status: true, lockedAt: true, voidedAt: true } })
}

export type { Prisma }
