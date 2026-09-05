'use client'

import { LoaderCircle, LogOut } from 'lucide-react'
import { type AnimationEvent, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from 'react'

import { cn } from '@/lib/utils/cn'
import { signOutAction } from '@/server/actions/auth.actions'

/**
 * The Sign out entry of the account menu, with a small leaving scene: a figure
 * appears, runs to the door on the right, the door opens, the figure steps
 * through, the door closes - then the real `signOutAction` runs exactly as
 * before (audit entry, session cookie cleared, redirect to /login).
 *
 * The animation is CSS keyframes on an inline SVG, about 900 ms. The action is
 * fired when the door's closing animation ends (with a timer as a fallback in
 * case the event never arrives), never twice: a second click while the figure
 * is leaving is ignored. With `prefers-reduced-motion: reduce` the click signs
 * out immediately and no scene is drawn. If the action fails the entry returns
 * to rest, says so, and can be clicked again - the UI is never left stuck.
 *
 * Once the user has clicked, the sign-out is committed: the parent menu is told
 * it is busy (so it does not dismiss on Escape or an outside click), and if the
 * item is unmounted anyway before the scene ends, the action still runs.
 */

/** Duration of the leaving scene; the door-swing keyframes end at this mark. */
export const SIGN_OUT_ANIMATION_MS = 900
/** If the animationend event never fires, sign out anyway after this long. */
export const SIGN_OUT_FALLBACK_MS = SIGN_OUT_ANIMATION_MS + 300
/** How long to give Next.js's own redirect before navigating to /login by hand. */
const NAVIGATION_GRACE_MS = 1500
/** The keyframes whose end triggers the real sign-out. */
export const DOOR_SWING_ANIMATION = 'ek-door-swing'

const LOGIN_PATH = '/login'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type Phase = 'idle' | 'leaving' | 'signing-out' | 'failed'

const noopSubscribe = () => () => {}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return noopSubscribe()
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener?.('change', onChange)
  return () => media.removeEventListener?.('change', onChange)
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED_MOTION_QUERY).matches : false),
    () => false,
  )
}

/** Next.js signals a redirect from a Server Action with a tagged error; that is success, not failure. */
function isRedirectSignal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error && String((error as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')
}

/**
 * The scene: floor, door frame on the right, a leaf hinged on its left edge,
 * and (while leaving) a running figure clipped at the doorway so it vanishes
 * inside. Colours follow the menu text (`currentColor`) and the accent
 * tokens, so both themes look right without extra rules.
 */
function DoorScene({ leaving, clipId }: { leaving: boolean; clipId: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 44 24"
      width="44"
      height="24"
      className="ek-door-scene shrink-0 overflow-visible text-muted transition-colors group-hover:text-foreground"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="38.5" height="24" />
        </clipPath>
      </defs>
      {/* floor */}
      <line x1="2" y1="22.5" x2="42" y2="22.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
      {/* doorway (lit when the door is open) */}
      <rect className="ek-doorway" x="29.5" y="5.5" width="9" height="17" fill="var(--accent)" opacity="0" />
      {/* the figure: drawn only while leaving so the scene is calm at rest */}
      {leaving ? (
        <g clipPath={`url(#${clipId})`}>
          <g className="ek-figure" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none">
            <circle cx="6" cy="9" r="2.1" fill="currentColor" stroke="none" />
            <line x1="6" y1="11.2" x2="6" y2="16.8" />
            <g className="ek-arm">
              <line x1="6" y1="12.5" x2="9.2" y2="14.4" />
            </g>
            <g className="ek-leg ek-leg-left">
              <line x1="6" y1="16.8" x2="4" y2="21.8" />
            </g>
            <g className="ek-leg ek-leg-right">
              <line x1="6" y1="16.8" x2="8" y2="21.8" />
            </g>
          </g>
        </g>
      ) : null}
      {/* door leaf, hinged on the left */}
      <rect className="ek-door-leaf" x="29.5" y="5.5" width="9" height="17" rx="0.5" fill="currentColor" opacity="0.85" />
      <circle className="ek-door-knob" cx="36.6" cy="14.5" r="0.75" fill="var(--panel)" />
      {/* frame */}
      <rect x="28.5" y="4.5" width="11" height="18" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function SignOutMenuItem({ className, onBusyChange }: { className?: string; onBusyChange?: (busy: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  // Mirrors `phase` for the unmount cleanup, which runs outside render.
  const phaseRef = useRef<Phase>('idle')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  const [, startTransition] = useTransition()
  const reducedMotion = usePrefersReducedMotion()
  const clipId = useId()
  const submitted = useRef(false)
  const mounted = useRef(true)
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearFallback = () => {
    if (fallback.current) {
      clearTimeout(fallback.current)
      fallback.current = null
    }
  }

  /** Runs the existing Server Action exactly once per attempt. */
  const signOut = useCallback(() => {
    if (submitted.current) return
    submitted.current = true
    clearFallback()
    setPhase('signing-out')
    startTransition(async () => {
      try {
        await signOutAction()
        // Next.js follows the action's redirect on its own and this menu unmounts with
        // the page. Should we still be mounted a moment later, go to the login page by
        // hand - the session is already gone server-side, so nothing is left half done.
        fallback.current = setTimeout(() => {
          if (!mounted.current) return
          try {
            window.location.assign(new URL(LOGIN_PATH, window.location.origin).toString())
          } catch {
            /* navigation unavailable (tests) */
          }
        }, NAVIGATION_GRACE_MS)
      } catch (error) {
        if (isRedirectSignal(error)) return
        if (!mounted.current) return
        submitted.current = false
        setPhase('failed')
      }
    })
  }, [startTransition])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (fallback.current) clearTimeout(fallback.current)
      // The user already chose to sign out; the menu closing (Escape, outside click)
      // must not cancel it. Run the action now instead of waiting for the scene.
      if (phaseRef.current === 'leaving' && !submitted.current) {
        submitted.current = true
        void signOutAction().catch(() => {})
      }
    }
  }, [])

  const busy = phase === 'leaving' || phase === 'signing-out'
  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const onClick = () => {
    if (phase === 'leaving' || phase === 'signing-out') return
    if (reducedMotion) {
      signOut()
      return
    }
    setPhase('leaving')
    fallback.current = setTimeout(signOut, SIGN_OUT_FALLBACK_MS)
  }

  const onAnimationEnd = (event: AnimationEvent<HTMLButtonElement>) => {
    if (event.animationName === DOOR_SWING_ANIMATION && phase === 'leaving') signOut()
  }

  return (
    <div className={className}>
      <button
        type="button"
        role="menuitem"
        data-state={phase}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        aria-invalid={phase === 'failed' || undefined}
        aria-describedby={phase === 'failed' ? `${clipId}-failure` : undefined}
        onClick={onClick}
        onAnimationEnd={onAnimationEnd}
        className={cn(
          'group flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-panel-header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          busy && 'cursor-progress',
        )}
      >
        {phase === 'signing-out' ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin text-muted" /> : <LogOut aria-hidden className="h-4 w-4 text-muted transition-colors group-hover:text-foreground" />}
        <span className="flex-1 text-left">
          {phase === 'signing-out' ? 'Signing out…' : 'Sign out'}
          {phase === 'failed' ? (
            <span id={`${clipId}-failure`} className="block text-xs font-normal text-rose-600 dark:text-rose-300">
              Sign-out failed. Try again.
            </span>
          ) : null}
        </span>
        <DoorScene leaving={phase === 'leaving'} clipId={clipId} />
      </button>
    </div>
  )
}
