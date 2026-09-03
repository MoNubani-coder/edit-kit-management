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
      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <p className="text-sm font-medium text-slate-700">Arrives in Phase {phase}</p>
        <p className="mt-1 text-sm text-slate-500">
          This section is protected today and will be populated when its phase is delivered.
        </p>
      </div>
    </>
  )
}
