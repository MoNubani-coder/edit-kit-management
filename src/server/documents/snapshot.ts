import 'server-only'

import type { InspectionType } from '@prisma/client'

/**
 * Reading a frozen inspection document (AD-6).
 *
 * When a handover or a return completes, the fully-resolved document is
 * serialised into `Inspection.documentSnapshot`. Everything printed here comes
 * from that JSON and nothing else - no live joins, no current kit contents, no
 * current serial numbers. A handover regenerated in three years shows what was
 * signed, even if the kit has since been dismantled and the assets renamed.
 *
 * The snapshot is written by our own services, but it is still parsed
 * defensively: a document from an older shape must render rather than crash,
 * so every field is read through a narrowing helper and anything unreadable
 * becomes null.
 */

export type DocumentKind = 'handover' | 'return'

export interface DocumentSignature {
  type: string
  signerName: string | null
  signedAt: string | null
  /** Deliberately not carried into any view model. */
  imageHash?: string | null
}

export interface DocumentAccessory {
  label: string | null
  type: string | null
  expected: number | null
  received: number | null
  status: string | null
  notes: string | null
  handedOver: boolean | null
}

export interface DocumentLine {
  assetCode: string | null
  name: string | null
  category: string | null
  slot: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  barcode: string | null
  required: boolean | null
  /** Handover: the condition it left in. Return: how it left, for comparison. */
  handoverStatus: string | null
  /** Return only: the condition it came back in. */
  returnStatus: string | null
  status: string | null
  notes: string | null
  accessories: DocumentAccessory[]
}

export interface DocumentCheck {
  label: string | null
  required: boolean | null
  status: string | null
  notes: string | null
}

export interface DocumentSoftware {
  name: string | null
  version: string | null
  required: boolean | null
  status: string | null
  installedVersion: string | null
  notes: string | null
}

export interface FrozenDocument {
  kind: DocumentKind
  bookingNumber: string | null
  purpose: string | null
  bookingStart: string | null
  bookingEnd: string | null
  collectedAt: string | null
  expectedReturnDate: string | null
  returnedAt: string | null
  punctuality: string | null
  minutesLate: number | null
  editor: { name: string | null; staffId: string | null; type: string | null; contactNumber: string | null; company: string | null; department: string | null }
  kit: { code: string | null; name: string | null; barcode: string | null; suitcaseStatus: string | null }
  engineer: { assigned: string | null; handedOverBy: string | null; returnReceivedBy: string | null }
  equipment: DocumentLine[]
  software: DocumentSoftware[]
  checklist: DocumentCheck[]
  generalNotes: string | null
  signatures: DocumentSignature[]
  /** Return documents name the handover they were measured against. */
  measuredAgainst: { completedAt: string | null; lineCount: number | null } | null
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)
const arr = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : [])
const nested = (value: unknown, key: string): Json => (isObject(value) && isObject(value[key]) ? (value[key] as Json) : {})

/**
 * Turns a stored snapshot into the one shape both renderers use. Returns null
 * only when there is no usable object at all - an inspection that was never
 * completed, or a row whose snapshot is missing.
 */
export function readDocument(kind: DocumentKind, snapshot: unknown): FrozenDocument | null {
  if (!isObject(snapshot)) return null

  const booking = nested(snapshot, 'booking')
  const editor = nested(snapshot, 'editor')
  const kit = nested(snapshot, 'kit')
  const engineer = nested(snapshot, 'engineer')
  const handover = nested(snapshot, 'handover')

  return {
    kind,
    bookingNumber: str(booking.number),
    purpose: str(booking.purpose),
    bookingStart: str(booking.bookingStart),
    bookingEnd: str(booking.bookingEnd),
    // A handover records when it was collected; a return repeats it from the
    // booking, so either key may carry it.
    collectedAt: str(snapshot.collectedAt) ?? str(booking.collectionDate),
    expectedReturnDate: str(booking.expectedReturnDate),
    returnedAt: str(snapshot.returnedAt),
    punctuality: str(snapshot.punctuality),
    minutesLate: num(snapshot.minutesLate),
    editor: {
      name: str(editor.name),
      staffId: str(editor.staffId),
      type: str(editor.type),
      contactNumber: str(editor.contactNumber),
      company: str(editor.company),
      department: str(editor.department),
    },
    kit: { code: str(kit.code), name: str(kit.name), barcode: str(kit.barcode), suitcaseStatus: str(kit.suitcaseStatus) },
    engineer: { assigned: str(engineer.assigned), handedOverBy: str(engineer.handedOverBy), returnReceivedBy: str(engineer.returnReceivedBy) },
    equipment: arr(snapshot.equipment).map((line) => ({
      assetCode: str(line.assetCode),
      name: str(line.name),
      category: str(line.category),
      slot: str(line.slot),
      manufacturer: str(line.manufacturer),
      model: str(line.model),
      serialNumber: str(line.serialNumber),
      barcode: str(line.barcode),
      required: bool(line.required) ?? bool(line.handedOver),
      handoverStatus: str(line.handoverStatus),
      returnStatus: str(line.returnStatus),
      status: str(line.status) ?? str(line.returnStatus),
      notes: str(line.notes),
      accessories: arr(line.accessories).map((accessory) => ({
        label: str(accessory.label),
        type: str(accessory.type),
        expected: num(accessory.expected),
        received: num(accessory.received),
        status: str(accessory.status) ?? str(accessory.returnStatus),
        notes: str(accessory.notes),
        handedOver: bool(accessory.handedOver),
      })),
    })),
    software: arr(snapshot.software).map((entry) => ({
      name: str(entry.name),
      version: str(entry.version),
      required: bool(entry.required),
      status: str(entry.status),
      installedVersion: str(entry.installedVersion),
      notes: str(entry.notes),
    })),
    checklist: arr(snapshot.checklist).map((entry) => ({ label: str(entry.label), required: bool(entry.required), status: str(entry.status), notes: str(entry.notes) })),
    generalNotes: str(snapshot.generalNotes),
    signatures: arr(snapshot.signatures).map((signature) => ({ type: str(signature.type) ?? '', signerName: str(signature.signerName), signedAt: str(signature.signedAt) })),
    measuredAgainst: Object.keys(handover).length > 0 ? { completedAt: str(handover.completedAt), lineCount: num(handover.lineCount) } : null,
  }
}

export function documentTitle(kind: DocumentKind): string {
  return kind === 'handover' ? 'Equipment Handover Record' : 'Equipment Return Record'
}

export function inspectionTypeFor(kind: DocumentKind): InspectionType {
  return kind === 'handover' ? 'HANDOVER' : 'RETURN'
}
