// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The animated Sign out entry in jsdom. The real Server Action is mocked so the
 * tests can assert *when* and *how often* it is called: once, after the door
 * closes (or the fallback timer), never twice, immediately under reduced
 * motion, and again after a failure.
 */

const signOutAction = vi.fn<() => Promise<void>>()
vi.mock('@/server/actions/auth.actions', () => ({ signOutAction: () => signOutAction() }))

const { DOOR_SWING_ANIMATION, SIGN_OUT_FALLBACK_MS, SignOutMenuItem } = await import('@/components/layout/sign-out-menu-item')

function stubMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

/** A redirect from the action is how a *successful* sign-out ends. */
const redirect = () => Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })

/**
 * jsdom has no AnimationEvent, so React DOM falls back to the vendor-prefixed
 * event name it finds on a style object; dispatch both spellings carrying the
 * animation name. The component's own guard keeps this to one sign-out.
 */
function endAnimation(target: Element, animationName: string) {
  for (const type of ['animationend', 'webkitAnimationEnd']) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'animationName', { value: animationName })
    target.dispatchEvent(event)
  }
}

function item(): HTMLButtonElement {
  return screen.getByRole('menuitem') as HTMLButtonElement
}

beforeEach(() => {
  vi.useFakeTimers()
  stubMatchMedia(false)
  signOutAction.mockReset()
  signOutAction.mockRejectedValue(redirect())
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SignOutMenuItem', () => {
  it('renders as the menu item with the door at rest and no figure', () => {
    render(<SignOutMenuItem />)
    expect(item()).toHaveAccessibleName('Sign out')
    expect(item()).not.toHaveAttribute('title')
    expect(item().dataset.state).toBe('idle')
    expect(item().querySelector('.ek-door-leaf')).not.toBeNull()
    expect(item().querySelector('.ek-figure')).toBeNull()
    expect(signOutAction).not.toHaveBeenCalled()
  })

  it('plays the leaving scene first and signs out when the door has closed', async () => {
    render(<SignOutMenuItem />)
    fireEvent.click(item())

    expect(item().dataset.state).toBe('leaving')
    expect(item()).toHaveAttribute('aria-busy', 'true')
    expect(item().querySelector('.ek-figure')).not.toBeNull()
    expect(signOutAction).not.toHaveBeenCalled()

    await act(async () => {
      endAnimation(item().querySelector('.ek-door-leaf')!, DOOR_SWING_ANIMATION)
    })
    expect(signOutAction).toHaveBeenCalledTimes(1)
    expect(item().dataset.state).toBe('signing-out')
    expect(item()).toHaveAccessibleName('Signing out…')
  })

  it('ignores other animations ending and falls back to a timer if the door event never arrives', async () => {
    render(<SignOutMenuItem />)
    fireEvent.click(item())
    await act(async () => {
      endAnimation(item().querySelector('.ek-figure')!, 'ek-run')
    })
    expect(signOutAction).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(SIGN_OUT_FALLBACK_MS + 1)
    })
    expect(signOutAction).toHaveBeenCalledTimes(1)
  })

  it('never signs out twice, however many times it is clicked while leaving', async () => {
    render(<SignOutMenuItem />)
    fireEvent.click(item())
    fireEvent.click(item())
    fireEvent.click(item())
    await act(async () => {
      endAnimation(item().querySelector('.ek-door-leaf')!, DOOR_SWING_ANIMATION)
    })
    fireEvent.click(item())
    await act(async () => {
      vi.advanceTimersByTime(SIGN_OUT_FALLBACK_MS + 1)
    })
    expect(signOutAction).toHaveBeenCalledTimes(1)
  })

  it('signs out immediately with no scene when the user prefers reduced motion', async () => {
    stubMatchMedia(true)
    render(<SignOutMenuItem />)
    await act(async () => {
      fireEvent.click(item())
    })
    expect(signOutAction).toHaveBeenCalledTimes(1)
    expect(item().querySelector('.ek-figure')).toBeNull()
    expect(item().dataset.state).toBe('signing-out')
  })

  it('recovers when the sign-out fails: says so, returns to rest and can be tried again', async () => {
    signOutAction.mockRejectedValueOnce(new Error('database unavailable'))
    render(<SignOutMenuItem />)
    fireEvent.click(item())
    await act(async () => {
      endAnimation(item().querySelector('.ek-door-leaf')!, DOOR_SWING_ANIMATION)
    })
    await act(async () => {})

    expect(signOutAction).toHaveBeenCalledTimes(1)
    expect(item().dataset.state).toBe('failed')
    expect(item()).not.toHaveAttribute('aria-busy')
    expect(item()).toHaveAttribute('aria-invalid', 'true')
    expect(item()).toHaveAccessibleDescription('Sign-out failed. Try again.')
    // The message lives inside the menu item: an ARIA menu allows no other children.
    expect(screen.queryByRole('alert')).toBeNull()

    // Second attempt: the scene plays again and the action is called again.
    fireEvent.click(item())
    expect(item().dataset.state).toBe('leaving')
    await act(async () => {
      endAnimation(item().querySelector('.ek-door-leaf')!, DOOR_SWING_ANIMATION)
    })
    expect(signOutAction).toHaveBeenCalledTimes(2)
  })

  it('is operable from the keyboard with Enter and Space', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    render(<SignOutMenuItem />)
    await user.tab()
    expect(item()).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(item().dataset.state).toBe('leaving')
    expect(signOutAction).not.toHaveBeenCalled()

    cleanup()
    signOutAction.mockClear()
    render(<SignOutMenuItem />)
    await user.tab()
    await user.keyboard(' ')
    expect(item().dataset.state).toBe('leaving')
  })
})

describe('SignOutMenuItem when the menu goes away mid-scene', () => {
  it('still signs out exactly once if it is unmounted while the figure is leaving', async () => {
    const { unmount } = render(<SignOutMenuItem />)
    fireEvent.click(item())
    expect(item().dataset.state).toBe('leaving')
    unmount()
    await act(async () => {})
    expect(signOutAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(SIGN_OUT_FALLBACK_MS * 3)
    })
    expect(signOutAction).toHaveBeenCalledTimes(1)
  })

  it('does not sign out when unmounted at rest', async () => {
    const { unmount } = render(<SignOutMenuItem />)
    unmount()
    await act(async () => {})
    expect(signOutAction).not.toHaveBeenCalled()
  })

  it('tells its parent when it is busy so the menu can stay open', () => {
    const onBusyChange = vi.fn()
    render(<SignOutMenuItem onBusyChange={onBusyChange} />)
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(item())
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
  })
})
