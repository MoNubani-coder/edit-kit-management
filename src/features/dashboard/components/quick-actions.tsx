import { ArrowUpRight, Boxes, CalendarRange, type LucideIcon, MonitorSmartphone, TriangleAlert } from 'lucide-react'
import Link from 'next/link'

import type { QuickAction, QuickActionIcon } from '@/server/services/dashboard.service'

const ICONS: Record<QuickActionIcon, LucideIcon> = {
  bookings: CalendarRange,
  kits: Boxes,
  assets: MonitorSmartphone,
  issues: TriangleAlert,
}

/** Shortcut chips. The list is already filtered by permission on the server. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null

  return (
    <nav aria-label="Shortcuts" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Go to</span>
      {actions.map((action) => {
        const Icon = ICONS[action.icon]
        return (
          <Link
            key={action.href}
            href={action.href}
            title={action.description}
            className="group inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Icon aria-hidden className="h-4 w-4 text-accent-foreground" />
            {action.label}
            <ArrowUpRight aria-hidden className="h-3.5 w-3.5 text-subtle transition-colors group-hover:text-accent-foreground" />
          </Link>
        )
      })}
    </nav>
  )
}
