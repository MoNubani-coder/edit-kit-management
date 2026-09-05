import {
  Boxes,
  CalendarClock,
  CircleCheck,
  type LucideIcon,
  PackageCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'

export type KpiIcon = 'available' | 'reserved' | 'checkedOut' | 'overdue' | 'maintenance' | 'issues'

const ICONS: Record<KpiIcon, LucideIcon> = {
  available: CircleCheck,
  reserved: CalendarClock,
  checkedOut: PackageCheck,
  overdue: TriangleAlert,
  maintenance: Wrench,
  issues: Boxes,
}

/**
 * The headline numbers as one continuous strip: a single framed panel whose
 * cells are separated by hairlines (the 1px grid gap shows the frame colour
 * through). Reads as an instrument panel rather than a row of loose boxes.
 */
export function StatStrip({
  children,
  columns = 6,
  className,
}: {
  children: ReactNode
  /** Figures per row on wide screens: 3 gives the two-row operations board. */
  columns?: 3 | 6
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-panel border border-line bg-line',
        columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * One stat. `attention` is only set when the value demands action (overdue >
 * 0, open issues > 0), so the strip stays calm until something needs a look.
 */
export function Stat({
  title,
  value,
  hint,
  icon,
  attention = false,
}: {
  title: string
  value: number
  hint?: string
  icon: KpiIcon
  attention?: boolean
}) {
  const Icon = ICONS[icon]

  return (
    <div className="theme-transition relative flex min-h-[8.5rem] flex-col justify-between bg-panel p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{title}</p>
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            attention
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
              : 'bg-accent-soft text-accent-foreground',
          )}
        >
          <Icon aria-hidden className="h-4 w-4" />
        </span>
      </div>
      <div>
        <p
          className={cn(
            'font-display text-[38px] font-semibold leading-none tabular-nums tracking-tight',
            attention ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-2 truncate text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  )
}
