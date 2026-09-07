import type { ReactNode } from 'react'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'

export type StepState = 'todo' | 'done' | 'blocked' | 'locked'

const STATE: Record<StepState, { label: string; tone: BadgeTone }> = {
  todo: { label: 'To do', tone: 'neutral' },
  done: { label: 'Recorded', tone: 'green' },
  blocked: { label: 'Needs attention', tone: 'amber' },
  locked: { label: 'Locked', tone: 'blue' },
}

/**
 * One numbered stage of the handover. The number encodes a real sequence -
 * equipment before checklist before signatures before completion - and the
 * chip says where the stage stands.
 */
export function StepCard({
  step,
  id,
  title,
  description,
  state,
  children,
  className,
}: {
  step: number
  id: string
  title: string
  description?: string
  state?: StepState
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('theme-transition scroll-mt-24 rounded-panel border border-line bg-panel', className)} aria-labelledby={`${id}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft font-mono text-xs text-accent-foreground">{step}</span>
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        {state ? (
          <Badge tone={STATE[state].tone} dot>
            {STATE[state].label}
          </Badge>
        ) : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}
