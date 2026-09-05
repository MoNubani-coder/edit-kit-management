import { z } from 'zod'

/**
 * Equipment (asset), accessory and category schemas. Shared by the client
 * forms (for immediate feedback) and the server actions (the check that
 * counts). No Prisma import: these run in the browser too.
 */

export const ASSET_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'CHECKED_OUT',
  'MAINTENANCE',
  'DAMAGED',
  'MISSING',
  'RETIRED',
] as const
export type AssetStatusValue = (typeof ASSET_STATUSES)[number]

/** Statuses a person may set by hand; the rest belong to workflows. */
export const MANUAL_ASSET_STATUSES = ['AVAILABLE', 'DAMAGED', 'MISSING', 'RETIRED'] as const
/** Statuses new equipment may be recorded with. */
export const CREATE_ASSET_STATUSES = ['AVAILABLE', 'DAMAGED', 'MISSING'] as const

export const ASSET_STATUS_LABELS: Record<AssetStatusValue, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  CHECKED_OUT: 'Checked out',
  MAINTENANCE: 'Maintenance',
  DAMAGED: 'Damaged',
  MISSING: 'Missing',
  RETIRED: 'Retired',
}

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())

const checkbox = z.preprocess(
  (value) => value === 'on' || value === 'true' || value === true,
  z.boolean(),
)

// -----------------------------------------------------------------------------
// Equipment
// -----------------------------------------------------------------------------

const assetFields = {
  name: z.string().trim().min(2, 'Enter a name of at least 2 characters.').max(120, 'Use at most 120 characters.'),
  categoryId: z.string().trim().min(1, 'Choose a category.'),
  manufacturer: optionalText(80),
  model: optionalText(120),
  serialNumber: optionalText(120),
  admBarcode: optionalText(64),
  location: optionalText(120),
  notes: optionalText(2000),
}

export const createAssetSchema = z.object({
  ...assetFields,
  status: z.enum(CREATE_ASSET_STATUSES).default('AVAILABLE'),
})
export type CreateAssetInput = z.output<typeof createAssetSchema>

export const updateAssetSchema = z.object({
  ...assetFields,
  status: z.enum(ASSET_STATUSES),
  /** Why the status is changing; recorded in the status log. */
  statusReason: optionalText(300),
})
export type UpdateAssetInput = z.output<typeof updateAssetSchema>

// -----------------------------------------------------------------------------
// Accessories
// -----------------------------------------------------------------------------

export const accessoryInputSchema = z.object({
  accessoryTypeId: z.string().trim().min(1, 'Choose an accessory type.'),
  label: optionalText(80),
  quantity: z.coerce.number().int('Whole numbers only.').min(1, 'At least 1.').max(99, 'At most 99.').default(1),
  serialNumber: optionalText(120),
  admBarcode: optionalText(64),
  isRequired: checkbox.default(false),
  notes: optionalText(500),
})
export type AccessoryInput = z.output<typeof accessoryInputSchema>

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name of at least 2 characters.').max(80, 'Use at most 80 characters.'),
  code: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,40}$/, 'Use 2-40 letters, digits or underscores.')
      .optional(),
  ),
  description: optionalText(300),
  icon: optionalText(40),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})
export type CategoryInput = z.output<typeof categoryInputSchema>

// -----------------------------------------------------------------------------
// List parameters (URL -> typed query)
// -----------------------------------------------------------------------------

export const ASSET_VIEWS = ['all', 'available', 'checked-out', 'maintenance', 'missing-damaged', 'retired'] as const
export type AssetView = (typeof ASSET_VIEWS)[number]

export const ASSET_VIEW_LABELS: Record<AssetView, string> = {
  all: 'All equipment',
  available: 'Available',
  'checked-out': 'Checked out',
  maintenance: 'Maintenance',
  'missing-damaged': 'Missing / Damaged',
  retired: 'Retired',
}

export const ASSET_ASSIGNMENTS = ['all', 'in-kit', 'unassigned'] as const
export type AssetAssignment = (typeof ASSET_ASSIGNMENTS)[number]

export const ASSET_SORT_KEYS = ['assetCode', 'name', 'category', 'manufacturer', 'model', 'status', 'updatedAt'] as const
export type AssetSortKey = (typeof ASSET_SORT_KEYS)[number]

export const DEFAULT_PAGE_SIZE = 25

const listParamsSchema = z.object({
  q: optionalText(100),
  category: optionalText(64),
  view: z.enum(ASSET_VIEWS).catch('all'),
  assignment: z.enum(ASSET_ASSIGNMENTS).catch('all'),
  sort: z.enum(ASSET_SORT_KEYS).catch('assetCode'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(DEFAULT_PAGE_SIZE),
})

export type AssetListParams = z.output<typeof listParamsSchema>

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Tolerant parse: anything malformed falls back to its default. */
export function parseAssetListParams(raw: RawParams): AssetListParams {
  const picked = Object.fromEntries(
    ['q', 'category', 'view', 'assignment', 'sort', 'dir', 'page', 'pageSize'].map((key) => [key, first(raw[key])]),
  )
  const parsed = listParamsSchema.safeParse(picked)
  if (parsed.success) return parsed.data
  return listParamsSchema.parse({})
}

/** FormData -> plain object (last value wins for repeated keys). */
export function formDataToObject(formData: FormData): Record<string, string> {
  const object: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') object[key] = value
  }
  return object
}
