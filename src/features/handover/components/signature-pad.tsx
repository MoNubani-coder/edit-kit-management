'use client'

import { Check, Eraser, LoaderCircle, PenLine } from 'lucide-react'
import { type FormEvent, type PointerEvent, useActionState, useCallback, useEffect, useRef, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils/cn'
import type { SignerRoleValue } from '@/lib/validation/handover'
import { captureSignatureFormAction, type HandoverFormState } from '@/server/actions/handover.actions'
import type { HandoverSignatureMeta } from '@/server/dal/handover.dal'

/**
 * In-person signature on the engineer's device. A plain <canvas> driven by
 * Pointer Events - mouse, finger and stylus alike - drawn as dark ink on a
 * white "paper" so the stored PNG reads the same in either theme. The image is
 * the only thing the form sends: who signed is decided by the server from the
 * booking (editor) or the session (engineer).
 *
 * The pad itself is phase-agnostic: the handover posts to its own action and
 * the return (Phase 9) passes its own through `action`, so there is one canvas
 * implementation for both.
 */

const INK = '#0f1b33'
const PAPER = '#ffffff'
const HEIGHT = 220

export function SignaturePad({
  bookingId,
  role,
  signerName,
  existing,
  disabled,
  timeZone,
  action = captureSignatureFormAction,
  title: titleOverride,
  caption,
  optional = false,
}: {
  bookingId: string
  role: SignerRoleValue
  /** Who the server will attribute this signature to. */
  signerName: string
  existing: HandoverSignatureMeta | null
  disabled: boolean
  timeZone: string
  /** The Server Action this pad posts to; defaults to the handover's. */
  action?: (previous: HandoverFormState, formData: FormData) => Promise<HandoverFormState>
  title?: string
  caption?: string
  /** Shown when this signature is not required to complete. */
  optional?: boolean
}) {
  const [state, formAction, pending] = useActionState<HandoverFormState, FormData>(action, null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [resign, setResign] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const padOpen = !disabled && (!existing || resign)

  const paper = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(HEIGHT * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = PAPER
    context.fillRect(0, 0, width, HEIGHT)
    context.strokeStyle = INK
    context.lineWidth = 2.4
    context.lineCap = 'round'
    context.lineJoin = 'round'
  }, [])

  // Lay the paper whenever the pad is shown; ink state is reset by the buttons that open it.
  useEffect(() => {
    if (padOpen) paper()
  }, [padOpen, paper])

  const position = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pending) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    drawing.current = true
    const { x, y } = position(event)
    context.beginPath()
    context.moveTo(x, y)
    // A tap leaves a dot, so a very short signature still registers.
    context.lineTo(x + 0.1, y + 0.1)
    context.stroke()
    setHasInk(true)
    setError(null)
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const { x, y } = position(event)
    context.lineTo(x, y)
    context.stroke()
  }

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const clear = () => {
    paper()
    setHasInk(false)
    setError(null)
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const canvas = canvasRef.current
    if (!hasInk || !canvas) {
      event.preventDefault()
      setError('Sign in the box before saving.')
      return
    }
    if (imageRef.current) imageRef.current.value = canvas.toDataURL('image/png')
  }

  const title = titleOverride ?? (role === 'EDITOR' ? 'Editor signature' : 'Engineer signature')

  return (
    <div className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel-header px-5 py-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
            <PenLine aria-hidden className="h-4 w-4 text-accent-foreground" />
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Signing as <span className="font-medium text-foreground">{signerName}</span>
            {caption ?? (role === 'EDITOR' ? ' · the editor named on the booking' : ' · the signed-in engineer')}
            {optional ? ' · optional' : ''}
          </p>
        </div>
        {existing ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300">
            <Check aria-hidden className="h-3.5 w-3.5" />
            Signed {formatDateTime(existing.signedAt, timeZone)}
          </span>
        ) : null}
      </header>

      <div className="space-y-3 p-5">
        {existing && !resign ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground">
              Signed by <span className="font-medium">{existing.signerName}</span>
              {existing.signerStaffId ? <span className="ml-2 font-mono text-xs text-muted">{existing.signerStaffId}</span> : null}
            </p>
            {!disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHasInk(false)
                  setError(null)
                  setResign(true)
                }}
              >
                Sign again
              </Button>
            ) : null}
          </div>
        ) : null}

        {padOpen ? (
          <form action={formAction} onSubmit={onSubmit} noValidate className="space-y-3">
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="role" value={role} />
            <input ref={imageRef} type="hidden" name="image" defaultValue="" />
            <div className="relative">
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`${title} pad: draw your signature here`}
                className={cn('block h-[220px] w-full cursor-crosshair rounded-lg border-2 border-dashed border-line-strong bg-white', hasInk && 'border-solid border-accent')}
                style={{ touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={onPointerUp}
              />
              {!hasInk ? <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">Sign here with a finger, stylus or mouse</span> : null}
              <span aria-hidden className="pointer-events-none absolute inset-x-8 bottom-10 border-b border-slate-300" />
            </div>
            {error ? (
              <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">
                {error}
              </p>
            ) : null}
            {state && !state.ok ? <Alert variant="error">{state.fieldErrors?.image ?? state.message}</Alert> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
                {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
                Save signature
              </Button>
              <Button type="button" variant="secondary" size="lg" onClick={clear} disabled={pending}>
                <Eraser aria-hidden className="h-4 w-4" />
                Clear
              </Button>
              {existing ? (
                <Button type="button" variant="ghost" size="lg" onClick={() => setResign(false)} disabled={pending}>
                  Keep existing
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}

        {disabled && !existing ? <p className="text-sm text-muted">Not signed.</p> : null}
      </div>
    </div>
  )
}
