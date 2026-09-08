import { z } from 'zod'

import { pageSizeSchema } from '@/lib/pagination'

import { BOOKING_STATUSES, type BookingSchedule } from '@/lib/booking-rules'
import { zonedLocalToDate } from '@/lib/datetime'

import { formDataToObject } from './assets'

/**
 * Booking schemas. Dates arrive as `datetime-local` wall-clock strings in the
 * business time zone and are converted to instants by `parseSchedule` on the
 * server; the schema itself stays pure and runs in the browser too.
 */

export { formDataToObject }
export { BOOKING_STATUS_LABELS, BOOKING_STATUSES } from '@/lib/booking-rules'

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const localDateTime = z.string().trim().regex(LOCAL_DATETIME, 'Enter a date and time.')
const optionalLocalDateTime = z.preprocess(emptyToUndefined, localDateTime.optional())

/**
 * Who the kit is for, typed into the booking. These are booking-level snapshot
 * fields: they belong to the booking as historical data and never change
 * because a directory entry was edited later. `editorId` is the legacy path -
 * a directory profile - and is optional; when it is absent the requester
 * fields are required, when it is present the service snapshots the profile
 * into the same fields.
 */
const requesterFields = {
  requesterName: optionalText(120),
  /** Optional: external staff may have no staff ID. */
  requesterStaffId: optionalText(40),
  requesterMobile: optionalText(40),
  projectName: optionalText(200),
  workOrder: optionalText(80),
}

const bookingFields = {
  /** Legacy: a directory profile. Optional since the requester became booking data. */
  editorId: optionalText(64),
  kitId: z.string().trim().min(1, 'Choose a kit.'),
  ...requesterFields,
  bookingStart: localDateTime,
  bookingEnd: localDateTime,
  /** Blank means "collected at the booking start". */
  collectionDate: optionalLocalDateTime,
  /** Blank means "due back at the booking end". */
  expectedReturnDate: optionalLocalDateTime,
  purpose: optionalText(300),
  notes: optionalText(2000),
}

type RequesterShape = { editorId?: string; requesterName?: string; requesterMobile?: string; projectName?: string; workOrder?: string }

/** Without a directory profile, the booking has to say who it is for. */
function requireRequester(value: RequesterShape, ctx: z.RefinementCtx): void {
  if (value.editorId) return
  const required: Array<[keyof RequesterShape, string]> = [
    ['requesterName', 'Enter the name of the person the kit is for.'],
    ['requesterMobile', 'Enter a mobile number.'],
    ['projectName', 'Enter the project name.'],
    ['workOrder', 'Enter the work order.'],
  ]
  for (const [field, message] of required) {
    if (!value[field]) ctx.addIssue({ code: 'custom', path: [field], message })
  }
}

export const BOOKING_INTENTS = ['draft', 'reserve'] as const
export type BookingIntent = (typeof BOOKING_INTENTS)[number]

export const createBookingSchema = z
  .object({
    ...bookingFields,
    intent: z.enum(BOOKING_INTENTS).default('draft'),
  })
  .superRefine(requireRequester)
/**
 * Note the extra field: an engineer profile can be assigned server-side (the
 * seed does), but it is deliberately absent from the schema above, so a posted
 * `engineerId` is dropped before it reaches the service. Who prepared a booking
 * and who hands a kit over is the authenticated user, never a posted value.
 */
export type CreateBookingInput = z.output<typeof createBookingSchema> & { engineerId?: string }

/** Every edit carries the reason it was made; the audit trail shows it. */
export const updateBookingSchema = z
  .object({
    ...bookingFields,
    reason: z.string().trim().min(3, 'Say why the booking is being changed.').max(500, 'Use at most 500 characters.'),
  })
  .superRefine(requireRequester)
export type UpdateBookingInput = z.output<typeof updateBookingSchema> & { engineerId?: string }

// -----------------------------------------------------------------------------
// The pre-handover checklist
// -----------------------------------------------------------------------------

export const CHECKLIST_ANSWERS = ['PASS', 'FAIL', 'NOT_APPLICABLE'] as const
export type ChecklistAnswer = (typeof CHECKLIST_ANSWERS)[number]

export const checklistPreparationAnswerSchema = z.object({
  id: z.string().min(1),
  status: z.preprocess(emptyToUndefined, z.enum(CHECKLIST_ANSWERS).optional()),
  notes: optionalText(500),
})

/** Answers given while preparing the booking, before the handover exists. */
export const prepareChecklistSchema = z.object({
  checks: z.array(checklistPreparationAnswerSchema),
})
export type PrepareChecklistInput = z.output<typeof prepareChecklistSchema>

/** `check.<id>.status` / `check.<id>.notes` form fields into the schema's shape. */
export function parseChecklistFields(raw: Record<string, unknown>): { checks: Array<{ id: string; status?: unknown; notes?: unknown }> } {
  const byId = new Map<string, { id: string; status?: unknown; notes?: unknown }>()
  for (const [key, value] of Object.entries(raw)) {
    const match = /^check\.([^.]+)\.(status|notes)$/.exec(key)
    if (!match) continue
    const [, id, field] = match
    const entry = byId.get(id) ?? { id }
    entry[field as 'status' | 'notes'] = value
    byId.set(id, entry)
  }
  return { checks: [...byId.values()] }
}

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for the cancellation.').max(500, 'Use at most 500 characters.'),
})
export type CancelBookingInput = z.output<typeof cancelBookingSchema>

/** The schedule as instants, or the field errors for values that are not dates. */
export function parseSchedule(
  input: Pick<CreateBookingInput, 'bookingStart' | 'bookingEnd' | 'collectionDate' | 'expectedReturnDate'>,
  timeZone: string,
): { schedule: BookingSchedule; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const read = (field: 'bookingStart' | 'bookingEnd' | 'collectionDate' | 'expectedReturnDate'): Date | null => {
    const value = input[field]
    if (!value) return null
    const date = zonedLocalToDate(value, timeZone)
    if (!date) errors[field] = 'Enter a valid date and time.'
    return date
  }
  const bookingStart = read('bookingStart') ?? new Date(NaN)
  const bookingEnd = read('bookingEnd') ?? new Date(NaN)
  const collectionDate = read('collectionDate')
  const expectedReturnDate = read('expectedReturnDate') ?? bookingEnd
  return { schedule: { bookingStart, bookingEnd, collectionDate, expectedReturnDate }, errors }
}

// -----------------------------------------------------------------------------
// List parameters (URL -> typed query)
// -----------------------------------------------------------------------------

export const BOOKING_FILTERS = [
  'all',
  'today',
  'draft',
  'reserved',
  'ready',
  'checked-out',
  'due-soon',
  'overdue',
  'return-inspection',
  'completed',
  'cancelled',
] as const
export type BookingFilter = (typeof BOOKING_FILTERS)[number]

export const BOOKING_FILTER_LABELS: Record<BookingFilter, string> = {
  all: 'All',
  today: 'Today',
  draft: 'Draft',
  reserved: 'Reserved',
  ready: 'Ready for handover',
  'checked-out': 'Checked out',
  'due-soon': 'Due soon',
  overdue: 'Overdue',
  'return-inspection': 'Return inspection',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const BOOKING_SORT_KEYS = ['bookingStart', 'bookingNumber', 'expectedReturnDate', 'status', 'createdAt'] as const
export type BookingSortKey = (typeof BOOKING_SORT_KEYS)[number]

export const BOOKING_DEFAULT_PAGE_SIZE = 25

const listParamsSchema = z.object({
  q: optionalText(100),
  filter: z.enum(BOOKING_FILTERS).catch('all'),
  sort: z.enum(BOOKING_SORT_KEYS).catch('bookingStart'),
  dir: z.enum(['asc', 'desc']).catch('desc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: pageSizeSchema(BOOKING_DEFAULT_PAGE_SIZE),
})

export type BookingListParams = z.output<typeof listParamsSchema>

type RawParams = Record<string, string | string[] | undefined>

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseBookingListParams(raw: RawParams): BookingListParams {
  const picked = Object.fromEntries(['q', 'filter', 'sort', 'dir', 'page', 'pageSize'].map((key) => [key, first(raw[key])]))
  const parsed = listParamsSchema.safeParse(picked)
  if (parsed.success) return parsed.data
  return listParamsSchema.parse({})
}

export const BOOKING_TABS = ['overview', 'checklist', 'equipment', 'activity'] as const
export type BookingTab = (typeof BOOKING_TABS)[number]

export const BOOKING_TAB_LABELS: Record<BookingTab, string> = {
  overview: 'Overview',
  checklist: 'Checklist',
  equipment: 'Equipment',
  activity: 'Activity',
}

export function parseBookingTab(value: string | string[] | undefined): BookingTab {
  const key = first(value)
  return (BOOKING_TABS as readonly string[]).includes(key ?? '') ? (key as BookingTab) : 'overview'
}

export const BOOKING_STATUS_VALUES = BOOKING_STATUSES
