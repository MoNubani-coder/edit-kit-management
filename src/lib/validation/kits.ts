import { z } from 'zod'

import { pageSizeSchema } from '@/lib/pagination'

import { formDataToObject } from './assets'

/**
 * Kit, kit-membership, kit-software and checklist-assignment schemas. Shared
 * by the client forms and the Server Actions; no Prisma import.
 */

export { formDataToObject }

export const KIT_STATUSES = ['AVAILABLE', 'RESERVED', 'CHECKED_OUT', 'MAINTENANCE', 'DAMAGED', 'RETIRED'] as const
export type KitStatusValue = (typeof KIT_STATUSES)[number]

/** Statuses a person may set by hand; RESERVED and CHECKED_OUT belong to bookings. */
export const MANUAL_KIT_STATUSES = ['AVAILABLE', 'MAINTENANCE', 'DAMAGED', 'RETIRED'] as const
/** Statuses a new kit may be recorded with. */
export const CREATE_KIT_STATUSES = ['AVAILABLE', 'MAINTENANCE', 'DAMAGED'] as const

export const KIT_STATUS_LABELS: Record<KitStatusValue, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  CHECKED_OUT: 'Checked out',
  MAINTENANCE: 'Maintenance',
  DAMAGED: 'Damaged',
  RETIRED: 'Retired',
}

export const SUITCASE_STATUSES = ['GOOD', 'MINOR_DAMAGE', 'DAMAGED', 'MISSING', 'NOT_APPLICABLE'] as const
export type SuitcaseStatusValue = (typeof SUITCASE_STATUSES)[number]

export const SUITCASE_STATUS_LABELS: Record<SuitcaseStatusValue, string> = {
  GOOD: 'Good',
  MINOR_DAMAGE: 'Minor damage',
  DAMAGED: 'Damaged',
  MISSING: 'Missing',
  NOT_APPLICABLE: 'No case',
}

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())

/**
 * A yes / no choice submitted as a `<select>` (or hidden input) with the
 * literal values `true` / `false`. Unlike a checkbox, an absent field is
 * distinguishable from an unticked one, so the default is meaningful.
 */
const requiredChoice = z
  .preprocess(emptyToUndefined, z.enum(['true', 'false']).optional())
  .transform((value) => value !== 'false')

// -----------------------------------------------------------------------------
// Kit
// -----------------------------------------------------------------------------

/** MBP-02, WIN-01, AUDIO-01, CAM-01 … : upper-case groups joined by hyphens. */
export const KIT_CODE_PATTERN = /^[A-Z0-9]{2,12}(-[A-Z0-9]{1,8}){0,3}$/

const kitFields = {
  kitCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Enter a kit code.')
    .max(40, 'Use at most 40 characters.')
    .regex(KIT_CODE_PATTERN, 'Use letters, digits and hyphens, e.g. MBP-03 or AUDIO-01.'),
  name: z.string().trim().min(2, 'Enter a name of at least 2 characters.').max(120, 'Use at most 120 characters.'),
  admBarcode: optionalText(64),
  description: optionalText(2000),
  location: optionalText(120),
  notes: optionalText(2000),
  suitcaseStatus: z.enum(SUITCASE_STATUSES).default('GOOD'),
}

export const createKitSchema = z.object({
  ...kitFields,
  status: z.enum(CREATE_KIT_STATUSES).default('AVAILABLE'),
})
export type CreateKitInput = z.output<typeof createKitSchema>

export const updateKitSchema = z.object({
  ...kitFields,
  status: z.enum(KIT_STATUSES),
  /** Why the status is changing; recorded in the audit trail. */
  statusReason: optionalText(300),
})
export type UpdateKitInput = z.output<typeof updateKitSchema>

// -----------------------------------------------------------------------------
// Membership
// -----------------------------------------------------------------------------

/** How many candidates the equipment picker shows at once. */
export const ASSET_CANDIDATE_LIMIT = 25

export const kitMemberInputSchema = z.object({
  assetId: z.string().trim().min(1, 'Choose the equipment to add.'),
  slotLabel: optionalText(60),
  isRequired: requiredChoice,
  /** The picker's search term, so the add can return to the same results. */
  pick: optionalText(100),
})
export type KitMemberInput = z.output<typeof kitMemberInputSchema>

export const kitMemberUpdateSchema = z.object({
  slotLabel: optionalText(60),
  isRequired: requiredChoice,
})
export type KitMemberUpdateInput = z.output<typeof kitMemberUpdateSchema>

// -----------------------------------------------------------------------------
// Software and checklist
// -----------------------------------------------------------------------------

export const kitSoftwareInputSchema = z.object({
  softwareApplicationId: z.string().trim().min(1, 'Choose an application.'),
  isRequired: requiredChoice,
})
export type KitSoftwareInput = z.output<typeof kitSoftwareInputSchema>

export const kitChecklistInputSchema = z.object({
  /** Empty clears the assignment: bookings then fall back to the default template. */
  templateId: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
})
export type KitChecklistInput = z.output<typeof kitChecklistInputSchema>

// -----------------------------------------------------------------------------
// List parameters (URL -> typed query)
// -----------------------------------------------------------------------------

export const KIT_VIEWS = ['all', 'available', 'reserved', 'checked-out', 'maintenance', 'retired'] as const
export type KitView = (typeof KIT_VIEWS)[number]

export const KIT_VIEW_LABELS: Record<KitView, string> = {
  all: 'All kits',
  available: 'Available',
  reserved: 'Reserved',
  'checked-out': 'Checked out',
  maintenance: 'Maintenance / Unavailable',
  retired: 'Retired',
}

export const KIT_SORT_KEYS = ['kitCode', 'name', 'status', 'updatedAt'] as const
export type KitSortKey = (typeof KIT_SORT_KEYS)[number]

export const KIT_DEFAULT_PAGE_SIZE = 25

const listParamsSchema = z.object({
  q: optionalText(100),
  view: z.enum(KIT_VIEWS).catch('all'),
  sort: z.enum(KIT_SORT_KEYS).catch('kitCode'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: pageSizeSchema(KIT_DEFAULT_PAGE_SIZE),
})

export type KitListParams = z.output<typeof listParamsSchema>

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Tolerant parse: anything malformed falls back to its default. */
export function parseKitListParams(raw: RawParams): KitListParams {
  const picked = Object.fromEntries(['q', 'view', 'sort', 'dir', 'page', 'pageSize'].map((key) => [key, first(raw[key])]))
  const parsed = listParamsSchema.safeParse(picked)
  if (parsed.success) return parsed.data
  return listParamsSchema.parse({})
}

/** The workspace tabs on /kits/[id]. */
/** Software is no longer an operational tab: verification does not gate a handover. */
export const KIT_TABS = ['overview', 'equipment', 'checklist', 'history'] as const
export type KitTab = (typeof KIT_TABS)[number]

export const KIT_TAB_LABELS: Record<KitTab, string> = {
  overview: 'Overview',
  equipment: 'Equipment',
  checklist: 'Checklist',
  history: 'History',
}

export function parseKitTab(value: string | string[] | undefined): KitTab {
  const key = first(value)
  return (KIT_TABS as readonly string[]).includes(key ?? '') ? (key as KitTab) : 'overview'
}
