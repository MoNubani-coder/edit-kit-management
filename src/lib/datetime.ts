/**
 * Business-time helpers.
 *
 * Every timestamp in the database is an instant (TIMESTAMPTZ). "Today",
 * "tomorrow" and every displayed date are questions about a *wall clock* in
 * the business time zone (Asia/Dubai by default - `APP_TIMEZONE`). These
 * functions are the only place that conversion happens; components receive a
 * `timeZone` string and call these, never `toLocaleString` on their own.
 *
 * Implemented on `Intl` alone so no extra dependency is needed and the output
 * does not vary with the ICU locale data of the host ("Sep" vs "Sept").
 */

export const DEFAULT_TIME_ZONE = 'Asia/Dubai'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The wall-clock reading of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some engines report midnight as "24" even with h23.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  }
}

/** `YYYY-MM-DD` of the business day `date` falls on. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone)
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (+4 h for Dubai). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const wholeSeconds = date.getTime() - (((date.getTime() % 1000) + 1000) % 1000)
  return wallAsUtc - wholeSeconds
}

/**
 * The instant at which the business day containing `date` began (local
 * midnight). Two passes handle a DST change between `date` and that midnight.
 */
export function startOfBusinessDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone)
  const wallMidnight = Date.UTC(p.year, p.month - 1, p.day)

  const firstGuess = new Date(wallMidnight - timeZoneOffsetMs(date, timeZone))
  const offsetAtMidnight = timeZoneOffsetMs(firstGuess, timeZone)

  return new Date(wallMidnight - offsetAtMidnight)
}

export interface BusinessDayRange {
  /** Inclusive. */
  start: Date
  /** Exclusive - the start of the next business day. */
  end: Date
}

/** `[start, end)` of the business day containing `date`. */
export function businessDayRange(date: Date, timeZone: string): BusinessDayRange {
  const start = startOfBusinessDay(date, timeZone)
  // 36 h forward lands safely inside the next day even across a DST change.
  const end = startOfBusinessDay(new Date(start.getTime() + 36 * HOUR_MS), timeZone)
  return { start, end }
}

export function isSameBusinessDay(a: Date, b: Date, timeZone: string): boolean {
  return zonedDateKey(a, timeZone) === zonedDateKey(b, timeZone)
}

/** Whole business days from `from` to `to` (negative when `to` is earlier). */
export function businessDaysBetween(from: Date, to: Date, timeZone: string): number {
  const a = startOfBusinessDay(from, timeZone).getTime()
  const b = startOfBusinessDay(to, timeZone).getTime()
  return Math.round((b - a) / DAY_MS)
}

/** `03 Sep 2026` */
export function formatDate(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone)
  return `${pad(day)} ${MONTHS[month - 1]} ${year}`
}

/** `14:30` */
export function formatTime(date: Date, timeZone: string): string {
  const { hour, minute } = zonedParts(date, timeZone)
  return `${pad(hour)}:${pad(minute)}`
}

/** `03 Sep 2026, 14:30` */
export function formatDateTime(date: Date, timeZone: string): string {
  return `${formatDate(date, timeZone)}, ${formatTime(date, timeZone)}`
}

/** `45 min`, `3 h`, `2 d 4 h` */
export function humanDuration(ms: number): string {
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const hours = Math.floor(abs / HOUR_MS)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(abs / DAY_MS)
  const remainingHours = Math.floor((abs - days * DAY_MS) / HOUR_MS)
  return remainingHours > 0 ? `${days} d ${remainingHours} h` : `${days} d`
}

let relativeFormatter: Intl.RelativeTimeFormat | undefined

/** `in 3 hours`, `2 days ago`, `yesterday`, `tomorrow`, `now`. */
export function formatRelative(target: Date, now: Date): string {
  relativeFormatter ??= new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const diff = target.getTime() - now.getTime()
  const abs = Math.abs(diff)
  const sign = diff < 0 ? -1 : 1

  if (abs < 45_000) return 'now'
  if (abs < HOUR_MS) return relativeFormatter.format(sign * Math.round(abs / 60_000), 'minute')
  if (abs < 2 * DAY_MS) return relativeFormatter.format(sign * Math.round(abs / HOUR_MS), 'hour')
  if (abs < 60 * DAY_MS) return relativeFormatter.format(sign * Math.round(abs / DAY_MS), 'day')
  return relativeFormatter.format(sign * Math.round(abs / (30 * DAY_MS)), 'month')
}

export type DueTone = 'neutral' | 'amber' | 'red'

export interface DueDescription {
  label: string
  tone: DueTone
}

/**
 * How a return date reads on the dashboard: overdue, due today, due tomorrow,
 * or a plain date. Tone drives the badge colour, kept deliberately calm.
 */
export function describeDue(expected: Date, now: Date, timeZone: string): DueDescription {
  if (expected.getTime() < now.getTime()) {
    return { label: `Overdue by ${humanDuration(now.getTime() - expected.getTime())}`, tone: 'red' }
  }

  const days = businessDaysBetween(now, expected, timeZone)
  const time = formatTime(expected, timeZone)

  if (days === 0) return { label: `Due today, ${time}`, tone: 'amber' }
  if (days === 1) return { label: `Due tomorrow, ${time}`, tone: 'neutral' }
  return { label: `Due ${formatDate(expected, timeZone)}`, tone: 'neutral' }
}

/**
 * A wall-clock reading typed into a `datetime-local` input (`YYYY-MM-DDTHH:mm`)
 * in `timeZone`, as an instant. Two passes through the offset handle the
 * hour around a DST transition; `null` when the text is not a date.
 */
export function zonedLocalToDate(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute, second || 0)
  if (Number.isNaN(guess)) return null
  const first = new Date(guess - timeZoneOffsetMs(new Date(guess), timeZone))
  const date = new Date(guess - timeZoneOffsetMs(first, timeZone))
  return Number.isNaN(date.getTime()) ? null : date
}

/** The inverse: an instant as the `datetime-local` value for `timeZone`. */
export function toZonedLocalInput(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}
