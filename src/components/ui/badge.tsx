import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils/cn'

export type BadgeTone = 'neutral' | 'slate' | 'green' | 'amber' | 'red' | 'blue'

/**
 * Square-cornered status chips with an optional leading dot. Light and dark
 * values sit side by side so the tone reads the same in both modes.
 */
const tones: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: {
    chip: 'bg-slate-100 text-slate-700 dark:bg-white/8 dark:text-slate-300',
    dot: 'bg-slate-400 dark:bg-slate-500',
  },
  slate: {
    chip: 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900',
    dot: 'bg-slate-300 dark:bg-slate-700',
  },
  green: {
    chip: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
  },
  amber: {
    chip: 'bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
    dot: 'bg-amber-500 dark:bg-amber-400',
  },
  red: {
    chip: 'bg-rose-50 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300',
    dot: 'bg-rose-500 dark:bg-rose-400',
  },
  blue: {
    chip: 'bg-accent-soft text-accent-foreground',
    dot: 'bg-accent',
  },
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide',
        tones[tone].chip,
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tones[tone].dot)} /> : null}
      {children}
    </span>
  )
}
