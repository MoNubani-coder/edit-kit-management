import { Search } from 'lucide-react'
import Link from 'next/link'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BOOKING_DEFAULT_PAGE_SIZE, type BookingListParams } from '@/lib/validation/bookings'
import { cn } from '@/lib/utils/cn'

/** Search as a GET form so every list state is a URL. */
export function BookingsToolbar({ params, clearHref, seesAll }: { params: BookingListParams; clearHref: string; seesAll: boolean }) {
  return (
    <form method="get" action="/bookings" role="search" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      {params.filter !== 'all' ? <input type="hidden" name="filter" value={params.filter} /> : null}
      {params.sort !== 'bookingStart' ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {params.dir !== 'desc' ? <input type="hidden" name="dir" value={params.dir} /> : null}
      {params.pageSize !== BOOKING_DEFAULT_PAGE_SIZE ? <input type="hidden" name="pageSize" value={params.pageSize} /> : null}

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder={seesAll ? 'Search booking number, editor, staff ID, kit code, kit name or kit barcode…' : 'Search your bookings by number or kit…'}
          aria-label="Search bookings"
          autoComplete="off"
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {params.q ? (
          <Link href={clearHref} className={cn(buttonVariants({ variant: 'ghost' }), 'whitespace-nowrap')}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  )
}
