import { z } from 'zod'

import { pageSizeSchema } from '@/lib/pagination'

import { formDataToObject } from './assets'

/**
 * Administration schemas: accounts, the software catalogue and the checklist
 * templates.
 *
 * These three areas were the Administration placeholders. Everything they
 * write already had a table and a consumer - kits check software at handover,
 * bookings copy checklist items when a handover starts - so what was missing
 * was the way in, not the model.
 *
 * No Prisma import: the enum-shaped lists are declared here so a client
 * component can label a row without pulling the schema into the bundle. Tests
 * check each list against the enum it mirrors.
 */

export { formDataToObject }

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())
const checkbox = z.preprocess((value) => value === 'true' || value === 'on' || value === true, z.boolean())

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

export const USER_ROLES = ['ADMIN', 'ENGINEER', 'EDITOR', 'VIEWER'] as const
export type UserRoleValue = (typeof USER_ROLES)[number]

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const
export type UserStatusValue = (typeof USER_STATUSES)[number]

export const USER_STATUS_LABELS: Record<UserStatusValue, string> = {
  INVITED: 'Invited',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DISABLED: 'Disabled',
}

/** The statuses an administrator may set from the list. */
export const SETTABLE_USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const

export const USER_FILTERS = ['all', 'active', 'suspended', 'locked', 'never-signed-in'] as const
export type UserFilter = (typeof USER_FILTERS)[number]

export const USER_FILTER_LABELS: Record<UserFilter, string> = {
  all: 'All',
  active: 'Active',
  suspended: 'Suspended or disabled',
  locked: 'Locked out',
  'never-signed-in': 'Never signed in',
}

export const USER_SORT_KEYS = ['name', 'email', 'role', 'status', 'lastLoginAt'] as const
export type UserSortKey = (typeof USER_SORT_KEYS)[number]

export const USER_DEFAULT_PAGE_SIZE = 25

const userListParamsSchema = z.object({
  q: optionalText(100),
  filter: z.enum(USER_FILTERS).catch('all'),
  role: z.preprocess(emptyToUndefined, z.enum(USER_ROLES).optional().catch(undefined)),
  sort: z.enum(USER_SORT_KEYS).catch('name'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: pageSizeSchema(USER_DEFAULT_PAGE_SIZE),
})

export type UserListParams = z.output<typeof userListParamsSchema>

export function parseUserListParams(raw: Record<string, string | string[] | undefined>): UserListParams {
  const picked = Object.fromEntries(['q', 'filter', 'role', 'sort', 'dir', 'page', 'pageSize'].map((key) => [key, first(raw[key])]))
  const parsed = userListParamsSchema.safeParse(picked)
  if (parsed.success) return parsed.data
  return { filter: 'all', sort: 'name', dir: 'asc', page: 1, pageSize: USER_DEFAULT_PAGE_SIZE }
}

export function usersHref(params: UserListParams, overrides: Partial<UserListParams> = {}): string {
  // Changing the question restarts at the first page; only paging keeps the page.
  const resetPage = Object.keys(overrides).some((key) => key !== 'page')
  const merged = { ...params, ...overrides, page: resetPage ? 1 : overrides.page ?? params.page }
  const search = new URLSearchParams()
  if (merged.q) search.set('q', merged.q)
  if (merged.filter !== 'all') search.set('filter', merged.filter)
  if (merged.role) search.set('role', merged.role)
  if (merged.sort !== 'name') search.set('sort', merged.sort)
  if (merged.dir !== 'asc') search.set('dir', merged.dir)
  if (merged.page > 1) search.set('page', String(merged.page))
  if (merged.pageSize !== USER_DEFAULT_PAGE_SIZE) search.set('pageSize', String(merged.pageSize))
  const query = search.toString()
  return query ? `/admin/users?${query}` : '/admin/users'
}

export const setUserRoleSchema = z.object({
  userId: z.string().min(1, 'Select an account.'),
  role: z.enum(USER_ROLES),
  reason: optionalText(500),
})
export type SetUserRoleInput = z.output<typeof setUserRoleSchema>

export const unlockUserSchema = z.object({ userId: z.string().min(1, 'Select an account.') })
export type UnlockUserInput = z.output<typeof unlockUserSchema>

// -----------------------------------------------------------------------------
// Software catalogue
// -----------------------------------------------------------------------------

export const softwareInputSchema = z.object({
  name: z.string().trim().min(2, 'Give the application a name.').max(120, 'Use at most 120 characters.'),
  vendor: optionalText(120),
  version: optionalText(60),
  licenseType: optionalText(60),
  notes: optionalText(500),
  sortOrder: z.coerce.number().int().min(0).max(999).catch(0),
})
export type SoftwareInput = z.output<typeof softwareInputSchema>

// -----------------------------------------------------------------------------
// Checklist templates
// -----------------------------------------------------------------------------

export const CHECKLIST_PHASES = ['HANDOVER', 'RETURN', 'BOTH'] as const
export type ChecklistPhaseValue = (typeof CHECKLIST_PHASES)[number]

export const CHECKLIST_PHASE_LABELS: Record<ChecklistPhaseValue, string> = {
  HANDOVER: 'Handover only',
  RETURN: 'Return only',
  BOTH: 'Handover and return',
}

export const checklistTemplateInputSchema = z.object({
  name: z.string().trim().min(3, 'Give the template a name.').max(120, 'Use at most 120 characters.'),
  description: optionalText(500),
})
export type ChecklistTemplateInput = z.output<typeof checklistTemplateInputSchema>

export const checklistItemInputSchema = z.object({
  label: z.string().trim().min(3, 'Say what has to be checked.').max(200, 'Use at most 200 characters.'),
  description: optionalText(500),
  phase: z.enum(CHECKLIST_PHASES),
  isRequired: checkbox,
  sortOrder: z.coerce.number().int().min(0).max(999).catch(0),
})
export type ChecklistItemInput = z.output<typeof checklistItemInputSchema>
