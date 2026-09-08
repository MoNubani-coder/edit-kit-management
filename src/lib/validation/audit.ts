import { z } from 'zod'

/**
 * Audit log list parameters, and the words the page uses for what it shows.
 *
 * The log is append-only and read-only: there is nothing to validate on the
 * way in, because nothing goes in through a form. What needs validating is the
 * query string, which decides what an administrator is looking at and is
 * therefore attacker-controlled like any other URL.
 *
 * No Prisma import: the action and entity lists are declared here so the
 * client bundle can label a row without pulling the schema in. `AUDIT_ACTIONS`
 * is checked against the enum by a test, so adding an action to the schema
 * without adding it here fails the suite rather than rendering as raw
 * SCREAMING_SNAKE.
 */

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'ROLE_CHANGED',
  'BOOKING_CREATED',
  'BOOKING_UPDATED',
  'BOOKING_STATUS_CHANGED',
  'BOOKING_CANCELLED',
  'KIT_ASSIGNED',
  'ASSET_STATUS_CHANGED',
  'KIT_STATUS_CHANGED',
  'KIT_ASSET_ADDED',
  'KIT_ASSET_REMOVED',
  'KIT_SOFTWARE_ADDED',
  'KIT_SOFTWARE_REMOVED',
  'KIT_CHECKLIST_CHANGED',
  'EDITOR_STATUS_CHANGED',
  'EDITOR_USER_LINKED',
  'EDITOR_USER_UNLINKED',
  'HANDOVER_STARTED',
  'HANDOVER_COMPLETED',
  'RETURN_STARTED',
  'RETURN_COMPLETED',
  'SIGNATURE_SUBMITTED',
  'SIGNATURE_VOIDED',
  'INSPECTION_VOIDED',
  'ISSUE_CREATED',
  'ISSUE_UPDATED',
  'ISSUE_RESOLVED',
  'ISSUE_CLOSED',
  'MAINTENANCE_CREATED',
  'MAINTENANCE_UPDATED',
  'MAINTENANCE_STATUS_CHANGED',
  'ADMIN_OVERRIDE',
  'EXPORT_GENERATED',
  'SETTING_CHANGED',
  'FILE_UPLOADED',
  'FILE_DELETED',
] as const

export type AuditActionValue = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ACTION_LABELS: Record<AuditActionValue, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Removed',
  RESTORE: 'Restored',
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'Sign-in refused',
  LOGOUT: 'Signed out',
  PASSWORD_CHANGED: 'Password changed',
  ROLE_CHANGED: 'Role changed',
  BOOKING_CREATED: 'Booking created',
  BOOKING_UPDATED: 'Booking updated',
  BOOKING_STATUS_CHANGED: 'Booking status changed',
  BOOKING_CANCELLED: 'Booking cancelled',
  KIT_ASSIGNED: 'Kit assigned',
  ASSET_STATUS_CHANGED: 'Equipment status changed',
  KIT_STATUS_CHANGED: 'Kit status changed',
  KIT_ASSET_ADDED: 'Equipment added to kit',
  KIT_ASSET_REMOVED: 'Equipment removed from kit',
  KIT_SOFTWARE_ADDED: 'Software added to kit',
  KIT_SOFTWARE_REMOVED: 'Software removed from kit',
  KIT_CHECKLIST_CHANGED: 'Kit checklist changed',
  EDITOR_STATUS_CHANGED: 'Editor status changed',
  EDITOR_USER_LINKED: 'Editor linked to an account',
  EDITOR_USER_UNLINKED: 'Editor unlinked from an account',
  HANDOVER_STARTED: 'Handover started',
  HANDOVER_COMPLETED: 'Handover completed',
  RETURN_STARTED: 'Return started',
  RETURN_COMPLETED: 'Return completed',
  SIGNATURE_SUBMITTED: 'Signature captured',
  SIGNATURE_VOIDED: 'Signature voided',
  INSPECTION_VOIDED: 'Inspection voided',
  ISSUE_CREATED: 'Issue raised',
  ISSUE_UPDATED: 'Issue updated',
  ISSUE_RESOLVED: 'Issue resolved',
  ISSUE_CLOSED: 'Issue closed',
  MAINTENANCE_CREATED: 'Maintenance raised',
  MAINTENANCE_UPDATED: 'Maintenance updated',
  MAINTENANCE_STATUS_CHANGED: 'Maintenance status changed',
  ADMIN_OVERRIDE: 'Administrative override',
  EXPORT_GENERATED: 'Export generated',
  SETTING_CHANGED: 'Setting changed',
  FILE_UPLOADED: 'File added',
  FILE_DELETED: 'File removed',
}

/**
 * Coarse groups for the filter, so an administrator can ask "show me the
 * sign-ins" without picking eight actions out of forty.
 */
export const AUDIT_GROUPS = ['all', 'auth', 'bookings', 'handover', 'equipment', 'issues', 'admin'] as const
export type AuditGroup = (typeof AUDIT_GROUPS)[number]

export const AUDIT_GROUP_LABELS: Record<AuditGroup, string> = {
  all: 'Everything',
  auth: 'Sign-in and accounts',
  bookings: 'Bookings',
  handover: 'Handover and return',
  equipment: 'Equipment and kits',
  issues: 'Issues and maintenance',
  admin: 'Administration',
}

export const AUDIT_GROUP_ACTIONS: Record<Exclude<AuditGroup, 'all'>, readonly AuditActionValue[]> = {
  auth: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'ROLE_CHANGED'],
  bookings: ['BOOKING_CREATED', 'BOOKING_UPDATED', 'BOOKING_STATUS_CHANGED', 'BOOKING_CANCELLED', 'KIT_ASSIGNED'],
  handover: ['HANDOVER_STARTED', 'HANDOVER_COMPLETED', 'RETURN_STARTED', 'RETURN_COMPLETED', 'SIGNATURE_SUBMITTED', 'SIGNATURE_VOIDED', 'INSPECTION_VOIDED', 'FILE_UPLOADED', 'FILE_DELETED'],
  equipment: ['ASSET_STATUS_CHANGED', 'KIT_STATUS_CHANGED', 'KIT_ASSET_ADDED', 'KIT_ASSET_REMOVED', 'KIT_SOFTWARE_ADDED', 'KIT_SOFTWARE_REMOVED', 'KIT_CHECKLIST_CHANGED'],
  issues: ['ISSUE_CREATED', 'ISSUE_UPDATED', 'ISSUE_RESOLVED', 'ISSUE_CLOSED', 'MAINTENANCE_CREATED', 'MAINTENANCE_UPDATED', 'MAINTENANCE_STATUS_CHANGED'],
  admin: ['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'EDITOR_STATUS_CHANGED', 'EDITOR_USER_LINKED', 'EDITOR_USER_UNLINKED', 'ADMIN_OVERRIDE', 'SETTING_CHANGED', 'EXPORT_GENERATED'],
}

/** The entity types the application actually writes audit rows about. */
export const AUDIT_ENTITY_TYPES = ['Booking', 'Kit', 'Asset', 'Issue', 'EditorProfile', 'User', 'EquipmentCategory'] as const
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  Booking: 'Booking',
  Kit: 'Kit',
  Asset: 'Equipment',
  Issue: 'Issue',
  EditorProfile: 'Editor',
  User: 'Account',
  EquipmentCategory: 'Category',
}

export const AUDIT_SORT_KEYS = ['createdAt', 'action', 'entityType', 'actorName'] as const
export type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number]

export const AUDIT_DEFAULT_PAGE_SIZE = 50

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
/** A date input gives `YYYY-MM-DD`; anything else is dropped rather than guessed at. */
const optionalDay = z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined))

const listParamsSchema = z.object({
  q: optionalText(120),
  group: z.enum(AUDIT_GROUPS).catch('all'),
  action: z.preprocess(emptyToUndefined, z.enum(AUDIT_ACTIONS).optional().catch(undefined)),
  actorId: optionalText(64),
  entityType: z.preprocess(emptyToUndefined, z.enum(AUDIT_ENTITY_TYPES).optional().catch(undefined)),
  from: optionalDay,
  to: optionalDay,
  sort: z.enum(AUDIT_SORT_KEYS).catch('createdAt'),
  dir: z.enum(['asc', 'desc']).catch('desc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(AUDIT_DEFAULT_PAGE_SIZE),
})

export type AuditListParams = z.output<typeof listParamsSchema>

type RawParams = Record<string, string | string[] | undefined>

const KEYS = ['q', 'group', 'action', 'actorId', 'entityType', 'from', 'to', 'sort', 'dir', 'page', 'pageSize'] as const

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseAuditListParams(raw: RawParams): AuditListParams {
  const picked = Object.fromEntries(KEYS.map((key) => [key, first(raw[key])]))
  const parsed = listParamsSchema.safeParse(picked)
  if (parsed.success) return parsed.data
  return { group: 'all', sort: 'createdAt', dir: 'desc', page: 1, pageSize: AUDIT_DEFAULT_PAGE_SIZE }
}

/** The same parameters back as a URL, so every view is a link. */
export function auditLogHref(params: AuditListParams, overrides: Partial<AuditListParams> = {}): string {
  const merged = { ...params, ...overrides }
  const search = new URLSearchParams()
  if (merged.q) search.set('q', merged.q)
  if (merged.group !== 'all') search.set('group', merged.group)
  if (merged.action) search.set('action', merged.action)
  if (merged.actorId) search.set('actorId', merged.actorId)
  if (merged.entityType) search.set('entityType', merged.entityType)
  if (merged.from) search.set('from', merged.from)
  if (merged.to) search.set('to', merged.to)
  if (merged.sort !== 'createdAt') search.set('sort', merged.sort)
  if (merged.dir !== 'desc') search.set('dir', merged.dir)
  if (merged.page > 1) search.set('page', String(merged.page))
  if (merged.pageSize !== AUDIT_DEFAULT_PAGE_SIZE) search.set('pageSize', String(merged.pageSize))
  const query = search.toString()
  return query ? `/admin/audit-logs?${query}` : '/admin/audit-logs'
}
