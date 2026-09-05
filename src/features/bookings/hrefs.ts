import { BOOKING_DEFAULT_PAGE_SIZE, type BookingListParams, type BookingTab } from '@/lib/validation/bookings'

/** URL for the booking list with some parameters changed; defaults are omitted. */
export function bookingsHref(params: BookingListParams, overrides: Partial<BookingListParams> = {}): string {
  const next: BookingListParams = { ...params, ...overrides }
  const resetPage = Object.keys(overrides).some((key) => key !== 'page')
  const search = new URLSearchParams()

  if (next.q) search.set('q', next.q)
  if (next.filter !== 'all') search.set('filter', next.filter)
  if (next.sort !== 'bookingStart') search.set('sort', next.sort)
  if (next.dir !== 'desc') search.set('dir', next.dir)
  if (next.pageSize !== BOOKING_DEFAULT_PAGE_SIZE) search.set('pageSize', String(next.pageSize))
  const page = resetPage ? 1 : next.page
  if (page > 1) search.set('page', String(page))

  const encoded = search.toString()
  return encoded ? `/bookings?${encoded}` : '/bookings'
}

/** URL for one booking workspace tab. */
export function bookingHref(id: string, tab: BookingTab = 'overview', extra: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams()
  if (tab !== 'overview') search.set('tab', tab)
  for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value)
  const encoded = search.toString()
  return encoded ? `/bookings/${id}?${encoded}` : `/bookings/${id}`
}

/** The picker state of the create / edit form lives in the URL. */
export interface BookingFormUrlState {
  editorId?: string
  kitId?: string
  /** Editor search term. */
  eq?: string
  /** Kit search term. */
  kq?: string
}

export function bookingFormHref(base: string, state: BookingFormUrlState): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(state)) if (value) search.set(key, value)
  const encoded = search.toString()
  return encoded ? `${base}?${encoded}` : base
}
