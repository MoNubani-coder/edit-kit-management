import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

/** Calm "nothing here" panel: dashed frame, teal-tinted icon, one sentence. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  action?: { href: string; label: string }
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn(compact ? 'p-4' : 'p-6', className)}>
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong text-center',
          compact ? 'px-4 py-7' : 'px-6 py-12',
        )}
      >
        {Icon ? (
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-foreground">
            <Icon aria-hidden className="h-5 w-5" />
          </div>
        ) : null}
        <p className="font-display text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
        {action ? (
          <Link href={action.href} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-4')}>
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
