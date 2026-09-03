import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils/cn'

export type InputProps = ComponentProps<'input'> & { invalid?: boolean }

export function Input({ className, invalid = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60',
        invalid
          ? 'border-red-500 focus-visible:ring-red-500'
          : 'border-slate-300 focus-visible:ring-slate-900',
        className,
      )}
      {...props}
    />
  )
}
