import { z } from 'zod'

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

const bookingFields = {
  editorId: z.string().trim().min(1, 'Choose an editor.'),
  kitId: z.string().trim().min(1, 'Choose a kit.'),
  engineerId: z.string().trim().min(1, 'Choose the engineer responsible.'),
  bookingStart: localDateTime,
  bookingEnd: localDateTime,
  /** Blank means "collected at the booking start". */
  collectionDate: optionalLocalDateTime,
  /** Blank means "due back at the booking end". */
  expectedReturnDate: optionalLocalDateTime,
  purpose: optionalText(300),
  notes: optionalText(2000),
}

export const BOOKING_INTENTS = ['draft', 'reserve'] as const
export type BookingIntent = (typeof BOOKING_INTENTS)[number]

export const createBookingSchema = z.object({
  ...bookingFields,
  intent: z.enum(BOOKING_INTENTS).default('draft'),
})
export type CreateBookingInput = z.output<typeof createBookingSchema>

export const updateBookingSchema = z.object(bookingFields)
export type UpdateBookingInput = z.output<typeof updateBookingSchema>

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
  pageSize: z.coerce.number().int().min(5).max(100).catch(BOOKING_DEFAULT_PAGE_SIZE),
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

export const BOOKING_TABS = ['overview', 'equipment', 'activity'] as const
export type BookingTab = (typeof BOOKING_TABS)[number]

export const BOOKING_TAB_LABELS: Record<BookingTab, string> = {
  overview: 'Overview',
  equipment: 'Equipment',
  activity: 'Activity',
}

export function parseBookingTab(value: string | string[] | undefined): BookingTab {
  const key = first(value)
  return (BOOKING_TABS as readonly string[]).includes(key ?? '') ? (key as BookingTab) : 'overview'
}

export const BOOKING_STATUS_VALUES = BOOKING_STATUSES
