import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'

type AlertVariant = 'error' | 'warning' | 'info'

const styles: Record<AlertVariant, { box: string; Icon: typeof Info }> = {
  error: {
    box: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200',
    Icon: CircleAlert,
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
    Icon: TriangleAlert,
  },
  info: {
    box: 'border-accent/30 bg-accent-soft text-accent-foreground',
    Icon: Info,
  },
}

export function Alert({
  variant = 'info',
  title,
  children,
  className,
}: {
  variant?: AlertVariant
  title?: string
  children?: ReactNode
  className?: string
}) {
  const { box, Icon } = styles[variant]

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', box, className)}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  )
}
