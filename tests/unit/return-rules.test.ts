import { describe, expect, it } from 'vitest'

import { BOOKING_STATUSES, canStartReturn, minutesLate, RETURN_GRACE_MINUTES, RETURN_START_STATUSES, returnPunctuality } from '@/lib/booking-rules'

/**
 * The return's pure rules: which statuses a return may start from, and how
 * early / on time / late is derived from the two timestamps the booking
 * already stores. Nothing about lateness is persisted, so this derivation is
 * the only source of it.
 */

const MINUTE = 60 * 1000
const at = (offsetMinutes: number) => new Date(Date.UTC(2026, 8, 7, 12, 0) + offsetMinutes * MINUTE)

describe('where a return may start', () => {
  it('accepts a kit that is out, late or not', () => {
    expect(canStartReturn('CHECKED_OUT')).toBe(true)
    expect(canStartReturn('OVERDUE')).toBe(true)
    expect(RETURN_START_STATUSES).toEqual(['CHECKED_OUT', 'OVERDUE'])
  })

  it('refuses every other status, including one already being returned or completed', () => {
    for (const status of BOOKING_STATUSES) {
      if (status === 'CHECKED_OUT' || status === 'OVERDUE') continue
      expect(canStartReturn(status), status).toBe(false)
    }
  })
})

describe('early, on time or late', () => {
  const expected = at(0)

  it('calls a return inside the grace window on time, either side', () => {
    expect(returnPunctuality(expected, expected)).toBe('on-time')
    expect(returnPunctuality(expected, at(RETURN_GRACE_MINUTES))).toBe('on-time')
    expect(returnPunctuality(expected, at(-RETURN_GRACE_MINUTES))).toBe('on-time')
  })

  it('calls anything past the grace window late, and anything well before it early', () => {
    expect(returnPunctuality(expected, at(RETURN_GRACE_MINUTES + 1))).toBe('late')
    expect(returnPunctuality(expected, at(24 * 60))).toBe('late')
    expect(returnPunctuality(expected, at(-RETURN_GRACE_MINUTES - 1))).toBe('early')
    expect(returnPunctuality(expected, at(-48 * 60))).toBe('early')
  })

  it('honours an explicit grace window', () => {
    expect(returnPunctuality(expected, at(30), 60)).toBe('on-time')
    expect(returnPunctuality(expected, at(30), 5)).toBe('late')
  })

  it('reports how late in whole minutes, and zero when it was not late', () => {
    expect(minutesLate(expected, at(90))).toBe(90)
    // Seconds are truncated, never rounded up into a minute that did not pass.
    expect(minutesLate(expected, new Date(expected.getTime() + 90 * MINUTE + 59_000))).toBe(90)
    expect(minutesLate(expected, expected)).toBe(0)
    expect(minutesLate(expected, at(-120))).toBe(0)
  })
})
