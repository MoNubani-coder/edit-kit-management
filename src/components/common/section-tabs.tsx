import Link from 'next/link'

import { cn } from '@/lib/utils/cn'

export interface SectionTab {
  key: string
  label: string
  href: string
  count?: number
}

/**
 * Horizontal tab bar for a workspace: underline on the active tab, optional
 * count chip. Server component; the page decides which tab is active (from
 * the pathname or a query parameter) and passes its key.
 */
export function SectionTabs({
  tabs,
  active,
  label = 'Sections',
  className,
}: {
  tabs: readonly SectionTab[]
  active: string | null
  label?: string
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn('border-b border-line', className)}>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.key === active
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t',
                  isActive
                    ? 'border-accent text-foreground'
                    : 'border-transparent text-muted hover:border-line-strong hover:text-foreground',
                )}
              >
                {tab.label}
                {typeof tab.count === 'number' ? (
                  <span
                    className={cn(
                      'rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                      isActive ? 'bg-accent-soft text-accent-foreground' : 'bg-panel-header text-muted',
                    )}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
