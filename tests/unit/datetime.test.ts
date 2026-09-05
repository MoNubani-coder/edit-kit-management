import { describe, expect, it } from 'vitest'

import {
  businessDayRange,
  businessDaysBetween,
  describeDue,
  formatDate,
  formatDateTime,
  formatRelative,
  formatTime,
  humanDuration,
  isSameBusinessDay,
  startOfBusinessDay,
  timeZoneOffsetMs,
  zonedDateKey,
} from '@/lib/datetime'

const DUBAI = 'Asia/Dubai'

describe('business day in Asia/Dubai', () => {
  // 21:00 UTC on 3 Sep is already 01:00 on 4 Sep in Dubai (+04:00).
  const lateEveningUtc = new Date('2026-09-03T21:00:00.000Z')

  it('places 21:00 UTC on the next Dubai calendar day', () => {
    expect(zonedDateKey(lateEveningUtc, DUBAI)).toBe('2026-09-04')
    expect(zonedDateKey(lateEveningUtc, 'UTC')).toBe('2026-09-03')
  })

  it('starts the business day at Dubai midnight, which is 20:00 UTC the evening before', () => {
    expect(startOfBusinessDay(lateEveningUtc, DUBAI).toISOString()).toBe('2026-09-03T20:00:00.000Z')
    const range = businessDayRange(lateEveningUtc, DUBAI)
    expect(range.start.toISOString()).toBe('2026-09-03T20:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-09-04T20:00:00.000Z')
  })

  it('reports the +4 h offset and same-day comparisons in local terms', () => {
    expect(timeZoneOffsetMs(lateEveningUtc, DUBAI)).toBe(4 * 60 * 60 * 1000)
    expect(isSameBusinessDay(lateEveningUtc, new Date('2026-09-04T15:59:59.000Z'), DUBAI)).toBe(true)
    expect(isSameBusinessDay(lateEveningUtc, new Date('2026-09-03T19:59:59.000Z'), DUBAI)).toBe(false)
    expect(businessDaysBetween(lateEveningUtc, new Date('2026-09-06T05:00:00.000Z'), DUBAI)).toBe(2)
    expect(businessDaysBetween(lateEveningUtc, new Date('2026-09-03T10:00:00.000Z'), DUBAI)).toBe(-1)
  })
})

describe('daylight-saving zones', () => {
  it('handles the day the clocks go forward in Europe/London (23-hour day)', () => {
    const noon = new Date('2026-03-29T12:00:00.000Z')
    const range = businessDayRange(noon, 'Europe/London')
    // Midnight local was still GMT; the next midnight is BST.
    expect(range.start.toISOString()).toBe('2026-03-29T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-03-29T23:00:00.000Z')
  })

  it('handles the day the clocks go back (25-hour day)', () => {
    const noon = new Date('2026-10-25T12:00:00.000Z')
    const range = businessDayRange(noon, 'Europe/London')
    expect(range.start.toISOString()).toBe('2026-10-24T23:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-10-26T00:00:00.000Z')
  })
})

describe('formatting', () => {
  const instant = new Date('2026-09-03T10:30:00.000Z')

  it('renders dates as DD Mon YYYY and times as HH:mm in the business zone', () => {
    expect(formatDate(instant, DUBAI)).toBe('03 Sep 2026')
    expect(formatTime(instant, DUBAI)).toBe('14:30')
    expect(formatDateTime(instant, DUBAI)).toBe('03 Sep 2026, 14:30')
    expect(formatTime(new Date('2026-09-03T20:00:00.000Z'), DUBAI)).toBe('00:00')
  })

  it('describes durations compactly', () => {
    expect(humanDuration(30 * 60_000)).toBe('30 min')
    expect(humanDuration(5 * 3_600_000)).toBe('5 h')
    expect(humanDuration(50 * 3_600_000)).toBe('2 d 2 h')
    expect(humanDuration(48 * 3_600_000)).toBe('2 d')
  })

  it('describes relative times with natural words', () => {
    const now = new Date('2026-09-03T10:00:00.000Z')
    expect(formatRelative(new Date('2026-09-03T10:00:20.000Z'), now)).toBe('now')
    expect(formatRelative(new Date('2026-09-03T09:35:00.000Z'), now)).toBe('25 minutes ago')
    expect(formatRelative(new Date('2026-09-03T13:00:00.000Z'), now)).toBe('in 3 hours')
    expect(formatRelative(new Date('2026-09-06T10:00:00.000Z'), now)).toBe('in 3 days')
    expect(formatRelative(new Date('2026-09-01T10:00:00.000Z'), now)).toBe('2 days ago')
  })
})

describe('describeDue', () => {
  const now = new Date('2026-09-03T06:00:00.000Z') // 10:00 Dubai

  it('flags overdue returns with the elapsed time', () => {
    expect(describeDue(new Date('2026-09-03T03:00:00.000Z'), now, DUBAI)).toEqual({
      label: 'Overdue by 3 h',
      tone: 'red',
    })
  })

  it('distinguishes today, tomorrow and later in the business zone', () => {
    expect(describeDue(new Date('2026-09-03T13:00:00.000Z'), now, DUBAI)).toEqual({ label: 'Due today, 17:00', tone: 'amber' })
    expect(describeDue(new Date('2026-09-04T05:00:00.000Z'), now, DUBAI)).toEqual({ label: 'Due tomorrow, 09:00', tone: 'neutral' })
    expect(describeDue(new Date('2026-09-10T05:00:00.000Z'), now, DUBAI)).toEqual({ label: 'Due 10 Sep 2026', tone: 'neutral' })
    // 22:00 UTC today is already tomorrow in Dubai.
    expect(describeDue(new Date('2026-09-03T22:00:00.000Z'), now, DUBAI).label).toBe('Due tomorrow, 02:00')
  })
})
