/** Skeleton shown while the dashboard queries run. Matches the real layout. */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="animate-pulse space-y-7">
      <div className="mb-7 border-b border-line pb-6">
        <div className="h-3 w-20 rounded bg-line" />
        <div className="mt-2 h-7 w-44 rounded bg-line" />
        <div className="mt-2 h-4 w-72 rounded bg-line" />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="min-h-[7.5rem] bg-panel p-5">
            <div className="h-3 w-24 rounded bg-line" />
            <div className="mt-6 h-8 w-12 rounded bg-line" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-panel border border-line bg-panel">
            <div className="border-b border-line bg-panel-header px-5 py-4">
              <div className="h-4 w-36 rounded bg-line" />
            </div>
            <div className="space-y-3 p-5">
              <div className="h-4 w-full rounded bg-line" />
              <div className="h-4 w-5/6 rounded bg-line" />
              <div className="h-4 w-2/3 rounded bg-line" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
