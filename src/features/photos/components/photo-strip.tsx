import { Camera } from 'lucide-react'

import { formatDateTime } from '@/lib/datetime'
import type { PhotoMeta } from '@/server/dal/attachments.dal'

/**
 * Read-only evidence, grouped by the inspection it belongs to, for the booking
 * page. Small on purpose: it says evidence exists and opens it, and never
 * competes with the workflow it documents.
 */
export function PhotoStrip({ photos, timeZone }: { photos: PhotoMeta[]; timeZone: string }) {
  if (photos.length === 0) return null

  const groups: Array<{ title: string; items: PhotoMeta[] }> = [
    { title: 'Handover', items: photos.filter((photo) => photo.inspectionType === 'HANDOVER') },
    { title: 'Return', items: photos.filter((photo) => photo.inspectionType === 'RETURN') },
    { title: 'Other', items: photos.filter((photo) => photo.inspectionType === null) },
  ].filter((group) => group.items.length > 0)

  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <Camera aria-hidden className="h-4 w-4 text-accent-foreground" />
          Photo evidence
        </h2>
        <span className="text-xs text-muted">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </span>
      </header>
      <div className="space-y-4 px-5 py-4">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
              {group.title} · {group.items.length}
            </p>
            <ul className="mt-2 flex flex-wrap gap-3">
              {group.items.map((photo) => (
                <li key={photo.id}>
                  <a
                    href={`/api/files/photo/${photo.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group block w-32 overflow-hidden rounded-lg border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    title={`${photo.fileName}${photo.uploadedByName ? ` · ${photo.uploadedByName}` : ''} · opens full size`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- authorised route, arbitrary uploaded dimensions */}
                    <img src={`/api/files/photo/${photo.id}`} alt={photo.caption ?? photo.fileName} className="h-24 w-full bg-panel-header object-cover transition-opacity group-hover:opacity-90" />
                    <span className="block truncate px-2 py-1 text-[11px] text-muted">{photo.caption ?? formatDateTime(photo.createdAt, timeZone)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
