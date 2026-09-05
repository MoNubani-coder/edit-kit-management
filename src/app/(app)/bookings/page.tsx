import { Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BookingsTable } from '@/features/dashboard/components/bookings-table'
import { env } from '@/lib/env'
import { cn } from '@/lib/utils/cn'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import {
  BOOKING_FILTER_LABELS,
  BOOKING_LIST_FILTERS,
  listBookingsForActor,
  parseBookingListFilter,
} from '@/server/dal/bookings.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Bookings' }

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/**
 * Operational booking list: search, quick filters and a wide table. The DAL
 * scopes every query to the actor - engineers, admins and viewers see all
 * bookings, an editor only their own. Creating and managing bookings arrives
 * in Phase 7.
 */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requirePermissionForPage(['booking.read', 'booking.readOwn'])
  const params = await searchParams
  const query = first(params.q).trim().slice(0, 100)
  const filter = parseBookingListFilter(first(params.filter))
  const now = new Date()

  const bookings = await listBookingsForActor(prisma, actor, {
    search: query,
    filter,
    now,
    timeZone: env.APP_TIMEZONE,
  })
  const seesAll = can(actor, 'booking.read')

  const hrefFor = (nextFilter: string) => {
    const search = new URLSearchParams()
    if (nextFilter !== 'all') search.set('filter', nextFilter)
    if (query) search.set('q', query)
    const encoded = search.toString()
    return encoded ? `/bookings?${encoded}` : '/bookings'
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations / Bookings"
        title="Bookings"
        description={
          seesAll
            ? 'Manage reservations, equipment handovers and returns.'
            : 'Bookings made in your name. Other editors’ bookings are never shown here.'
        }
      />

      <div className="space-y-4">
        <form method="get" action="/bookings" role="search" className="flex flex-col gap-3 md:flex-row md:items-center">
          {filter !== 'all' ? <input type="hidden" name="filter" value={filter} /> : null}
          <div className="relative flex-1 md:max-w-xl">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search booking, editor, kit or asset…"
              aria-label="Search bookings"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter bookings">
          {BOOKING_LIST_FILTERS.map((key) => {
            const active = key === filter
            return (
              <Link
                key={key}
                href={hrefFor(key)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-line bg-panel text-muted hover:border-line-strong hover:text-foreground',
                )}
              >
                {BOOKING_FILTER_LABELS[key]}
              </Link>
            )
          })}
        </div>

        <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-2.5 text-xs text-muted">
            <span>
              <span className="font-semibold tabular-nums text-foreground">{bookings.length}</span>{' '}
              {bookings.length === 1 ? 'booking' : 'bookings'}
              {filter !== 'all' ? ` · ${BOOKING_FILTER_LABELS[filter]}` : ''}
              {query ? ` · matching “${query}”` : ''}
            </span>
            <span className="hidden sm:inline">Most recent first</span>
          </div>
          <BookingsTable
            rows={bookings.map((booking) => ({
              id: booking.id,
              bookingNumber: booking.bookingNumber,
              status: booking.status,
              editorName: booking.editor.fullName,
              kitCode: booking.kit.kitCode,
              kitName: booking.kit.name,
              bookingStart: booking.bookingStart,
              bookingEnd: booking.bookingEnd,
              collectionDate: null,
              expectedReturnDate: booking.expectedReturnDate,
              actualReturnDate: null,
            }))}
            variant="list"
            timeZone={env.APP_TIMEZONE}
            now={now}
            emptyAction={filter !== 'all' || query ? { href: '/bookings', label: 'Clear filters' } : undefined}
          />
        </div>
      </div>
    </>
  )
}
