import { Construction } from 'lucide-react'
import type { ReactNode } from 'react'

import { EmptyState } from './empty-state'
import { PageHeader } from './page-header'

/**
 * Stand-in for sections that arrive in later phases. Each route still runs its
 * real permission check before rendering this, so the protection is exercised
 * today even though the feature is not.
 */
export function PlaceholderPage({
  eyebrow,
  title,
  description,
  phase,
  tabs,
  emptyTitle,
}: {
  eyebrow?: string
  title: string
  description: string
  phase: number
  tabs?: ReactNode
  /** Overrides the empty-state heading, e.g. for a selected tab. */
  emptyTitle?: string
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} tabs={tabs} />
      <div className="rounded-panel border border-line bg-panel">
        <EmptyState
          icon={Construction}
          title={emptyTitle ?? `Arrives in Phase ${phase}`}
          description={`This section is protected today and will be populated in Phase ${phase}.`}
        />
      </div>
    </>
  )
}
