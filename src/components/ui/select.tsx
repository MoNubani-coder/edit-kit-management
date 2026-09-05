import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils/cn'

export type SelectProps = ComponentProps<'select'> & { invalid?: boolean }

/** Native select with the same frame as `Input`; native for keyboard and touch. */
export function Select({ className, invalid = false, children, ...props }: SelectProps) {
  return (
    <span className="relative block">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          'flex h-10 w-full appearance-none rounded-lg border bg-panel px-3 py-2 pr-9 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-60',
          invalid ? 'border-rose-500 focus-visible:ring-rose-500' : 'border-line-strong focus-visible:border-accent focus-visible:ring-ring',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
    </span>
  )
}
