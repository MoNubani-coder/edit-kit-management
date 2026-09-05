'use client'

import { useTheme } from 'next-themes'
import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils/cn'

/**
 * Pull-cord light switch for the colour theme.
 *
 * A single <button> (so it is focusable, labelled and keyboard-operable) that
 * draws a small bulb, a cord and a handle. Pointer Events drive the physical
 * interaction for mouse, touch and stylus alike:
 *
 *   pointerdown  -> capture the pointer, remember the start position
 *   pointermove  -> the cord follows vertical movement, clamped to MAX_PULL
 *   pointerup    -> past THRESHOLD: toggle; then the cord springs back
 *
 * A tap (no meaningful movement), Enter and Space all toggle through the
 * button's normal click, so dragging is never the only way in. A drag that
 * falls short of the threshold snaps back and does nothing.
 *
 * Reduced motion: the cord still follows the pointer (that is direct
 * manipulation, not animation) but the spring-back and the bulb nudge are
 * suppressed.
 */

/** Pointer travel in pixels. */
export const PULL_CORD = {
  maxPull: 40,
  threshold: 24,
  /** Movement below this is a tap, not a drag. */
  tapTolerance: 4,
} as const

const BULB_CY = 16
const BULB_R = 8
const CORD_TOP = 27
const CORD_REST = 16
const HANDLE_H = 11
const VIEW_W = 32
const VIEW_H = CORD_TOP + CORD_REST + PULL_CORD.maxPull + HANDLE_H + 2

const noopSubscribe = () => () => {}

/** True once mounted on the client - the theme is unknown during SSR. */
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface PullCordThemeToggleProps {
  /** `full` renders at 100 %; `compact` at 75 % for the command bar and the login page. */
  variant?: 'full' | 'compact'
  className?: string
}

export function PullCordThemeToggle({ variant = 'full', className }: PullCordThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()
  const reducedMotion = usePrefersReducedMotion()

  const scale = variant === 'compact' ? 0.75 : 1
  const isLight = mounted && resolvedTheme === 'light'

  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [nudge, setNudge] = useState(false)

  const startY = useRef(0)
  const maxTravel = useRef(0)
  const suppressClick = useRef(false)
  // Mirrors `dragging` for the event handlers, which may run before React
  // re-renders between two pointer events.
  const draggingRef = useRef(false)

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'light' ? 'dark' : 'light')
    if (!reducedMotion) setNudge(true)
  }, [reducedMotion, resolvedTheme, setTheme])

  const travelFrom = (event: PointerEvent<HTMLButtonElement>) =>
    clamp((event.clientY - startY.current) / scale, 0, PULL_CORD.maxPull)

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    suppressClick.current = false
    startY.current = event.clientY
    maxTravel.current = 0
    draggingRef.current = true
    setDragging(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // jsdom and some older engines do not implement pointer capture.
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    const travel = travelFrom(event)
    maxTravel.current = Math.max(maxTravel.current, travel)
    setPull(travel)
  }

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    setPull(0)

    const travel = cancelled ? 0 : travelFrom(event)
    const wasDrag = maxTravel.current > PULL_CORD.tapTolerance

    if (wasDrag) {
      // The browser may still fire a click for this gesture; it must not toggle twice.
      suppressClick.current = true
      if (travel >= PULL_CORD.threshold) toggle()
    }

    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // see above
    }
  }

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false
      event.preventDefault()
      return
    }
    // Taps, mouse clicks without a drag, and keyboard activation land here.
    toggle()
  }

  // Keyboard: a native <button> fires click for Enter (keydown) and Space
  // (keyup), so onClick is the single activation path - no double toggles.

  const label = !mounted ? 'Switch colour theme' : isLight ? 'Switch to dark mode' : 'Switch to light mode'
  const cordLength = CORD_REST + pull
  const motion = dragging || reducedMotion ? 'none' : 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-theme-state={!mounted ? 'unknown' : isLight ? 'light' : 'dark'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event, false)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onClick={onClick}
      className={cn(
        'group relative inline-flex select-none touch-none items-start justify-center rounded-lg text-current',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
      style={{ width: VIEW_W * scale, height: VIEW_H * scale }}
    >
      <svg
        aria-hidden
        width={VIEW_W * scale}
        height={VIEW_H * scale}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="overflow-visible"
      >
        {/* ceiling mount */}
        <rect x={VIEW_W / 2 - 6} y={0} width={12} height={2.5} rx={1.25} className="fill-current opacity-40" />
        <line x1={VIEW_W / 2} y1={2.5} x2={VIEW_W / 2} y2={BULB_CY - BULB_R} className="stroke-current opacity-40" strokeWidth={1.5} />

        {/* bulb */}
        <g
          className={cn(nudge && 'animate-bulb-nudge')}
          onAnimationEnd={() => setNudge(false)}
          style={{ transformOrigin: `${VIEW_W / 2}px ${BULB_CY}px` }}
        >
          <circle
            cx={VIEW_W / 2}
            cy={BULB_CY}
            r={BULB_R}
            className={cn(
              'theme-transition',
              isLight ? 'bulb-on fill-amber-300 stroke-amber-400' : 'fill-transparent stroke-current opacity-70',
            )}
            strokeWidth={1.5}
          />
          {/* filament */}
          <path
            d={`M ${VIEW_W / 2 - 3} ${BULB_CY + 2} q 3 -5 6 0`}
            className={cn('fill-none', isLight ? 'stroke-amber-600' : 'stroke-current opacity-40')}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
          {/* bulb base */}
          <rect x={VIEW_W / 2 - 3.5} y={BULB_CY + BULB_R - 1} width={7} height={3.5} rx={1} className="fill-current opacity-60" />
        </g>

        {/* cord: scales from its top so it stretches while dragging */}
        <rect
          x={VIEW_W / 2 - 0.75}
          y={CORD_TOP}
          width={1.5}
          height={CORD_REST}
          className="fill-current opacity-55"
          style={{
            transformOrigin: `${VIEW_W / 2}px ${CORD_TOP}px`,
            transform: `scaleY(${cordLength / CORD_REST})`,
            transition: motion,
          }}
        />

        {/* handle */}
        <g style={{ transform: `translateY(${pull}px)`, transition: motion }}>
          <rect
            x={VIEW_W / 2 - 3.5}
            y={CORD_TOP + CORD_REST}
            width={7}
            height={HANDLE_H}
            rx={3}
            className="fill-current opacity-85 group-hover:opacity-100"
          />
        </g>
      </svg>
    </button>
  )
}
