'use client'

import { Camera, ImageOff, LoaderCircle, Upload } from 'lucide-react'
import { useActionState, useId, useRef, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/datetime'
import type { PhotoFormState } from '@/server/actions/photos.actions'
import type { PhotoMeta } from '@/server/dal/attachments.dal'

/**
 * Optional photo evidence: a compact strip of thumbnails and one small upload
 * control.
 *
 * Deliberately quiet. Photos are useful when something is disputed, so they
 * sit in a corner of the step rather than in the way of it: no required field,
 * no per-asset prompt, and the workflow completes whether there are twelve
 * photos or none. Thumbnails come from the authorised file route, so an image
 * only renders for someone allowed to see the booking.
 *
 * On a phone or tablet the file input opens the camera directly (`capture`),
 * which is the whole interaction: point, shoot, upload.
 */
export function PhotoEvidence({
  bookingId,
  photos,
  action,
  disabled,
  timeZone,
  label,
  hint,
}: {
  bookingId: string
  photos: PhotoMeta[]
  action: (previous: PhotoFormState, formData: FormData) => Promise<PhotoFormState>
  disabled: boolean
  timeZone: string
  label: string
  hint: string
}) {
  const [state, formAction, pending] = useActionState<PhotoFormState, FormData>(action, null)
  const [chosen, setChosen] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const id = useId()

  return (
    <section className="rounded-lg border border-line bg-panel-header/40 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Camera aria-hidden className="h-4 w-4 text-accent-foreground" />
          {label}
          <span className="text-xs font-normal text-muted">optional</span>
        </h3>
        <span className="text-xs text-muted">
          {photos.length === 0 ? 'No photos' : `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
        </span>
      </header>
      <p className="mt-1 text-xs text-muted">{hint}</p>

      {photos.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-3">
          {photos.map((photo) => (
            <li key={photo.id}>
              <a
                href={`/api/files/photo/${photo.id}`}
                target="_blank"
                rel="noreferrer"
                className="group block w-28 overflow-hidden rounded-lg border border-line bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                title={`${photo.fileName}${photo.caption ? ` · ${photo.caption}` : ''} · opens full size`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- authorised route, arbitrary uploaded dimensions */}
                <img src={`/api/files/photo/${photo.id}`} alt={photo.caption ?? photo.fileName} className="h-20 w-full bg-panel-header object-cover transition-opacity group-hover:opacity-90" />
                <span className="block truncate px-2 py-1 text-[11px] text-muted">
                  {photo.caption ?? formatDateTime(photo.createdAt, timeZone)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {!disabled ? (
        <form
          action={formAction}
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={() => {
            setChosen(null)
          }}
        >
          <input type="hidden" name="bookingId" value={bookingId} />
          <label
            htmlFor={`${id}-file`}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 text-sm font-medium text-foreground hover:bg-panel-header"
          >
            <Camera aria-hidden className="h-4 w-4" />
            {chosen ?? 'Take or choose a photo'}
          </label>
          <input
            ref={fileRef}
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

      {state && !state.ok ? (
        <Alert variant="error" className="mt-3">
          {state.fieldErrors?.photo ?? state.message}
        </Alert>
      ) : null}

      {disabled && photos.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
          <ImageOff aria-hidden className="h-3.5 w-3.5" />
          No photo evidence was recorded.
        </p>
      ) : null}
    </section>
  )
}
