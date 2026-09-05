import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils/cn'

export type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean }

export function Textarea({ className, invalid = false, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        'flex min-h-[6rem] w-full rounded-lg border bg-panel px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-60',
        invalid ? 'border-rose-500 focus-visible:ring-rose-500' : 'border-line-strong focus-visible:border-accent focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  )
}
