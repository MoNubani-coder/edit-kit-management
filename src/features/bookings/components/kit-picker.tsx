import { Boxes, Check, Search } from 'lucide-react'
import Link from 'next/link'

import { BookingStatusBadge, KitStatusBadge } from '@/components/common/status-badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { KitAvailabilityBadge } from '@/features/kits/components/availability-badge'
import { AvailabilityNotice } from '@/features/kits/components/availability-notice'
import { formatDate, formatTime } from '@/lib/datetime'
import type { KitChoice } from '@/server/services/bookings.service'

const TD = 'px-4 py-3 align-top'

function Upcoming({ bookings, timeZone, conflictIds }: { bookings: KitChoice['upcoming']; timeZone: string; conflictIds: Set<string> }) {
  if (bookings.length === 0) return <span className="text-xs text-subtle">No upcoming bookings</span>
  return (
    <ul className="space-y-1 text-xs">
      {bookings.map((booking) => (
        <li key={booking.id} className={conflictIds.has(booking.id) ? 'text-rose-700 dark:text-rose-300' : 'text-muted'}>
          <span className="font-mono">{booking.bookingNumber}</span> · {formatDate(booking.bookingStart, timeZone)} {formatTime(booking.bookingStart, timeZone)} → {formatDate(booking.bookingEnd, timeZone)}{' '}
          {formatTime(booking.bookingEnd, timeZone)} · {booking.editorName} <BookingStatusBadge status={booking.status} />
        </li>
      ))}
    </ul>
  )
}

/**
 * Section 2 of the booking form: which kit. Search by code, name or barcode;
 * each result shows the Phase 5 readiness verdict, its equipment count and the
 * live bookings already on it, so the operator can pick a free window.
 */
export function KitPicker({
  base,
  hidden,
  term,
  results,
  selected,
  changeHref,
  selectHref,
  timeZone,
  canChange = true,
  enabled = true,
}: {
  base: string
  hidden: Record<string, string | undefined>
  term: string
  results: KitChoice[]
  selected: KitChoice | null
  changeHref: string
  selectHref: (kitId: string) => string
  timeZone: string
  canChange?: boolean
  /** False until the editor has been chosen. */
  enabled?: boolean
}) {
  return (
    <section className={`theme-transition rounded-panel border border-line bg-panel ${enabled ? '' : 'opacity-60'}`}>
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft font-mono text-xs text-accent-foreground">2</span>
            Kit
          </h2>
          <p className="mt-0.5 text-xs text-muted">Readiness comes from the kit’s equipment (Phase 5 rule); the free window is checked against other live bookings when you reserve.</p>
        </div>
        {selected && canChange ? (
          <Link href={changeHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Change
          </Link>
        ) : null}
      </header>

      {!enabled ? (
        <p className="px-5 py-4 text-sm text-muted">Choose the editor first.</p>
      ) : selected ? (
        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-foreground">
              <Boxes aria-hidden className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                <span className="font-mono text-accent-foreground">{selected.kitCode}</span>
                {selected.name}
                <KitStatusBadge status={selected.status} />
                <KitAvailabilityBadge availability={selected.readiness} />
              </p>
              <p className="text-xs text-muted">
                {selected.readiness.memberCount} {selected.readiness.memberCount === 1 ? 'item' : 'items'} · {selected.readiness.requiredCount} required
                {selected.admBarcode ? ` · ${selected.admBarcode}` : ''}
              </p>
            </div>
            {selected.readiness.available ? <Check aria-hidden className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : null}
          </div>
          <AvailabilityNotice availability={selected.readiness} />
          {selected.conflicts.length > 0 ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
              <p className="font-medium">This window overlaps {selected.conflicts.length === 1 ? 'a live booking' : `${selected.conflicts.length} live bookings`}</p>
              <Upcoming bookings={selected.conflicts} timeZone={timeZone} conflictIds={new Set(selected.conflicts.map((booking) => booking.id))} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="px-5 py-4">
          <form method="get" action={base} role="search" className="flex flex-wrap items-center gap-2">
            {Object.entries(hidden).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
            <div className="relative min-w-[16rem] flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input type="search" name="kq" defaultValue={term} autoFocus autoComplete="off" placeholder="Scan a kit barcode, or search by kit code or name…" aria-label="Search kits" className="pl-9" />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {term && results.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              No kit matches <span className="font-mono text-foreground">{term}</span>. Retired kits are not offered.
            </p>
          ) : null}

          {results.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="min-w-full text-sm">
                <tbody>
                  {results.map((kit) => (
                    <tr key={kit.id} className="border-t border-line first:border-t-0 transition-colors hover:bg-panel-header">
                      <td className={TD}>
                        <p className="font-mono text-xs font-semibold text-accent-foreground">{kit.kitCode}</p>
                        <p className="font-medium text-foreground">{kit.name}</p>
                        <p className="text-xs text-muted">
                          {kit.readiness.memberCount} {kit.readiness.memberCount === 1 ? 'item' : 'items'} · {kit.readiness.requiredCount} required
                        </p>
                      </td>
                      <td className={TD}>
                        <span className="flex flex-col items-start gap-1">
                          <KitStatusBadge status={kit.status} />
                          <KitAvailabilityBadge availability={kit.readiness} />
                        </span>
                      </td>
                      <td className={`${TD} hidden md:table-cell`}>
                        {kit.readiness.reasons.length > 0 ? (
                          <ul className="space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                            {kit.readiness.reasons.slice(0, 3).map((reason, index) => (
                              <li key={`${reason.code}:${index}`}>{reason.reason}</li>
                            ))}
                            {kit.readiness.reasons.length > 3 ? <li className="text-muted">and {kit.readiness.reasons.length - 3} more</li> : null}
                          </ul>
                        ) : (
                          <span className="text-xs text-emerald-700 dark:text-emerald-300">All required equipment available</span>
                        )}
                        <div className="mt-2">
                          <Upcoming bookings={kit.upcoming} timeZone={timeZone} conflictIds={new Set(kit.conflicts.map((booking) => booking.id))} />
                        </div>
                      </td>
                      <td className={`${TD} text-right`}>
                        {kit.readiness.available ? (
                          <Link href={selectHref(kit.id)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                            Select
                          </Link>
                        ) : (
                          <span className="text-xs text-muted">Not ready to reserve</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
