import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'

/**
 * Framed content panel: tinted header with a display-face title, a teal count
 * chip and a "View all" link; the body sits flush so tables run edge to edge.
 * `attention` adds a thin amber top edge - nothing louder.
 */
export function SectionCard({
  title,
  description,
  action,
  count,
  tone = 'default',
  children,
  className,
}: {
  title: string
  description?: string
  action?: { href: string; label: string }
  count?: number
  tone?: 'default' | 'attention'
  children: ReactNode
  className?: string
}) {
  const id = `section-${slug(title)}`

  return (
    <section
      className={cn(
        'theme-transition flex flex-col overflow-hidden rounded-panel border border-line bg-panel',
        tone === 'attention' && 'border-t-2 border-t-amber-400 dark:border-t-amber-300',
        className,
      )}
      aria-labelledby={id}
    >
      <header className="flex items-start justify-between gap-4 border-b border-line bg-panel-header px-5 py-3.5">
        <div className="min-w-0">
          <h2 id={id} className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
            {title}
            {typeof count === 'number' ? (
              <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent-foreground">
                {count}
              </span>
            ) : null}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {action.label}
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  )
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
