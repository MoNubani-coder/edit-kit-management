import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/utils/cn'

/** Server-side pagination footer: range, numbered window, previous / next. */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  hrefFor,
}: {
  page: number
  pageCount: number
  total: number
  pageSize: number
  hrefFor: (page: number) => string
}) {
  // An empty result has its own empty state; a footer reading "0–0 of 0" adds nothing.
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4))
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => windowStart + index)

  const linkBase =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <nav aria-label="Pagination" className="flex flex-col gap-3 border-t border-line px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted">
        Showing <span className="font-medium tabular-nums text-foreground">{from}–{to}</span> of{' '}
        <span className="font-medium tabular-nums text-foreground">{total}</span>
      </p>
      {pageCount > 1 ? (
        <ul className="flex items-center gap-1">
          <li>
            {page > 1 ? (
              <Link href={hrefFor(page - 1)} aria-label="Previous page" className={cn(linkBase, 'text-muted hover:bg-panel-header hover:text-foreground')}>
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </Link>
            ) : (
              <span aria-disabled className={cn(linkBase, 'text-subtle opacity-50')}>
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </span>
            )}
          </li>
          {pages.map((number) => (
            <li key={number}>
              <Link
                href={hrefFor(number)}
                aria-current={number === page ? 'page' : undefined}
                className={cn(
                  linkBase,
                  'tabular-nums',
                  number === page ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-panel-header hover:text-foreground',
                )}
              >
                {number}
              </Link>
            </li>
          ))}
          <li>
            {page < pageCount ? (
              <Link href={hrefFor(page + 1)} aria-label="Next page" className={cn(linkBase, 'text-muted hover:bg-panel-header hover:text-foreground')}>
                <ChevronRight aria-hidden className="h-4 w-4" />
              </Link>
            ) : (
              <span aria-disabled className={cn(linkBase, 'text-subtle opacity-50')}>
                <ChevronRight aria-hidden className="h-4 w-4" />
              </span>
            )}
          </li>
        </ul>
      ) : null}
    </nav>
  )
}
