import { Construction } from 'lucide-react'

import { EmptyState } from './empty-state'
import { PageHeader } from './page-header'

/**
 * Stand-in for sections that arrive in later phases. Each route still runs its
 * real permission check before rendering this, so the protection is exercised
 * today even though the feature is not.
 */
export function PlaceholderPage({
  title,
  description,
  phase,
}: {
  title: string
  description: string
  phase: number
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-panel border border-line bg-panel">
        <EmptyState
          icon={Construction}
          title={`Arrives in Phase ${phase}`}
          description="This section is protected today and will be populated when its phase is delivered."
        />
      </div>
    </>
  )
}
