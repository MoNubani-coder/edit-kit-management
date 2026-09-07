'use client'

import { Camera, ImageOff, LoaderCircle, Upload } from 'lucide-react'
import { useActionState, useId, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/datetime'
import type { PhotoFormState } from '@/server/actions/photos.actions'
import { uploadIssuePhotoAction } from '@/server/actions/photos.actions'
import type { PhotoMeta } from '@/server/dal/attachments.dal'

/**
 * Evidence on an issue: the dent, the empty slot, the serial plate.
 *
 * Same rules as inspection evidence - optional, camera-first on a phone,
 * validated by its bytes on the server - served through the authorised file
 * route so an image only renders for someone allowed to read issues.
 */
export function IssuePhotos({ issueId, photos, canAdd, timeZone }: { issueId: string; photos: PhotoMeta[]; canAdd: boolean; timeZone: string }) {
  const [state, formAction, pending] = useActionState<PhotoFormState, FormData>(uploadIssuePhotoAction, null)
  const [chosen, setChosen] = useState<string | null>(null)
  const id = useId()

  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <Camera aria-hidden className="h-4 w-4 text-accent-foreground" />
          Photos
        </h2>
        <span className="text-xs text-muted">{photos.length === 0 ? 'None' : `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}</span>
      </header>

      <div className="space-y-3 px-5 py-4">
        {photos.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {photos.map((photo) => (
              <li key={photo.id}>
                <a
                  href={`/api/files/issue-photo/${photo.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group block w-32 overflow-hidden rounded-lg border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  title={`${photo.fileName}${photo.uploadedByName ? ` · ${photo.uploadedByName}` : ''} · opens full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- authorised route, arbitrary uploaded dimensions */}
                  <img src={`/api/files/issue-photo/${photo.id}`} alt={photo.caption ?? photo.fileName} className="h-24 w-full bg-panel-header object-cover transition-opacity group-hover:opacity-90" />
                  <span className="block truncate px-2 py-1 text-[11px] text-muted">{photo.caption ?? formatDateTime(photo.createdAt, timeZone)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <ImageOff aria-hidden className="h-4 w-4 text-subtle" />
            No photo evidence on this issue.
          </p>
        )}

        {canAdd ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2" onSubmit={() => setChosen(null)}>
            <input type="hidden" name="issueId" value={issueId} />
            <label
              htmlFor={`${id}-file`}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 text-sm font-medium text-foreground hover:bg-panel-header"
            >
              <Camera aria-hidden className="h-4 w-4" />
              {chosen ?? 'Take or choose a photo'}
            </label>
            <input
              id={`${id}-file`}
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              onChange={(event) => setChosen(event.target.files?.[0]?.name ?? null)}
            />
            <Input name="caption" placeholder="Caption (optional)" maxLength={200} className="h-11 w-full sm:w-56" aria-label="Photo caption" />
            <Button type="submit" variant="secondary" size="lg" disabled={pending || !chosen} aria-busy={pending}>
              {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Upload aria-hidden className="h-4 w-4" />}
              Add photo
            </Button>
          </form>
        ) : null}

        {state && !state.ok ? <Alert variant="error">{state.fieldErrors?.photo ?? state.message}</Alert> : null}
      </div>
    </section>
  )
}
