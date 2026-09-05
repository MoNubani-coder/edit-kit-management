import { z } from 'zod'

import { formDataToObject } from './assets'

/**
 * Editor profile schemas. Shared by the client forms and the Server Actions;
 * no Prisma import. The profile is the person who receives a kit - an
 * external editor with no account, or an internal editor who may optionally be
 * linked to a User.
 */

export { formDataToObject }

export const EDITOR_TYPES = ['INTERNAL', 'EXTERNAL'] as const
export type EditorType = (typeof EDITOR_TYPES)[number]

export const EDITOR_TYPE_LABELS: Record<EditorType, string> = {
  INTERNAL: 'Internal',
  EXTERNAL: 'External',
}

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())

/** Yes / no submitted as the literal strings `true` / `false`; absent means the default. */
const choice = (fallback: boolean) =>
  z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()).transform((value) => (value === undefined ? fallback : value === 'true'))

/** EDT-2210, EXT-5001, 104378 …: upper-case letters, digits and hyphens. */
export const STAFF_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/

const editorFields = {
  fullName: z.string().trim().min(2, 'Enter the editor’s full name.').max(120, 'Use at most 120 characters.'),
  staffId: z.preprocess(
    emptyToUndefined,
    z.string().trim().toUpperCase().regex(STAFF_ID_PATTERN, 'Use 2–32 letters, digits or hyphens, e.g. EDT-2210 or EXT-5001.').optional(),
  ),
  email: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email('Enter a valid email address.').max(254).optional()),
  contactNumber: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 ()-]{5,30}$/, 'Enter a phone number with digits, spaces, +, ( ) or -.')
      .optional(),
  ),
  department: optionalText(120),
  company: optionalText(120),
  type: z.enum(EDITOR_TYPES),
  notes: optionalText(2000),
}

export const createEditorSchema = z.object({
  ...editorFields,
  /** Optional account link, INTERNAL editors only; validated by the service. */
  userId: optionalText(64),
  isActive: choice(true),
})
export type CreateEditorInput = z.output<typeof createEditorSchema>

export const updateEditorSchema = z.object(editorFields)
export type UpdateEditorInput = z.output<typeof updateEditorSchema>

export const editorActiveSchema = z.object({
  isActive: choice(true),
  reason: optionalText(300),
})
export type EditorActiveInput = z.output<typeof editorActiveSchema>

export const editorLinkSchema = z.object({
  userId: z.string().trim().min(1, 'Choose a user account.'),
})
export type EditorLinkInput = z.output<typeof editorLinkSchema>

// -----------------------------------------------------------------------------
// List parameters (URL -> typed query)
// -----------------------------------------------------------------------------

export const EDITOR_VIEWS = ['all', 'internal', 'external', 'active', 'inactive'] as const
export type EditorView = (typeof EDITOR_VIEWS)[number]

export const EDITOR_VIEW_LABELS: Record<EditorView, string> = {
  all: 'All editors',
  internal: 'Internal',
  external: 'External',
  active: 'Active',
  inactive: 'Inactive',
}

export const EDITOR_SORT_KEYS = ['fullName', 'staffId', 'updatedAt'] as const
export type EditorSortKey = (typeof EDITOR_SORT_KEYS)[number]

export const EDITOR_DEFAULT_PAGE_SIZE = 25

const listParamsSchema = z.object({
  q: optionalText(100),
  view: z.enum(EDITOR_VIEWS).catch('all'),
  sort: z.enum(EDITOR_SORT_KEYS).catch('fullName'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(EDITOR_DEFAULT_PAGE_SIZE),
})

export type EditorListParams = z.output<typeof listParamsSchema>

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseEditorListParams(raw: RawParams): EditorListParams {
  const picked = Object.fromEntries(['q', 'view', 'sort', 'dir', 'page', 'pageSize'].map((key) => [key, first(raw[key])]))
  const parsed = listParamsSchema.safeParse(picked)
  if (parsed.success) return parsed.data
  return listParamsSchema.parse({})
}

/** The workspace tabs on /editors/[id]. */
export const EDITOR_TABS = ['overview', 'active', 'history', 'issues', 'activity'] as const
export type EditorTab = (typeof EDITOR_TABS)[number]

export const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  overview: 'Overview',
  active: 'Active bookings',
  history: 'Booking history',
  issues: 'Issues',
  activity: 'Activity',
}

export function parseEditorTab(value: string | string[] | undefined): EditorTab {
  const key = first(value)
  return (EDITOR_TABS as readonly string[]).includes(key ?? '') ? (key as EditorTab) : 'overview'
}

/** Page number for the paginated booking tabs (`?page=`). */
export function parsePage(value: string | string[] | undefined): number {
  const parsed = Number(first(value))
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}
