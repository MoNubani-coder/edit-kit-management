// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The account dropdown around the animated Sign out item: once the user has
 * clicked Sign out, Escape and outside clicks no longer dismiss the menu, so
 * the scene can finish and the real action runs.
 */

const signOutAction = vi.fn<() => Promise<void>>()
vi.mock('@/server/actions/auth.actions', () => ({ signOutAction: () => signOutAction() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))

const { AppShell } = await import('@/components/layout/app-shell')
const { ThemeProvider } = await import('@/components/theme/theme-provider')
const { DOOR_SWING_ANIMATION } = await import('@/components/layout/sign-out-menu-item')

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
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

function endDoorSwing(target: Element) {
  for (const type of ['animationend', 'webkitAnimationEnd']) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'animationName', { value: DOOR_SWING_ANIMATION })
    target.dispatchEvent(event)
  }
}

function renderShell() {
  return render(
    <ThemeProvider>
      <AppShell appName="Edit Kit Management System" tagline="Engineering" todayLabel="05 Sep" user={{ name: 'Khalid Al Mansoori', email: 'engineer@example.ae', role: 'ENGINEER' }} sections={[]}>
        <p>content</p>
      </AppShell>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  stubMatchMedia()
  signOutAction.mockReset()
  signOutAction.mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AccountMenu sign-out', () => {
  it('keeps the menu open through Escape and outside clicks while the scene plays, then signs out once', async () => {
    renderShell()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Account: Khalid/ }))
    const item = screen.getByRole('menuitem', { name: 'Sign out' })

    fireEvent.click(item)
    expect(item.dataset.state).toBe('leaving')

    // The two ways a menu normally closes.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument()
    expect(signOutAction).not.toHaveBeenCalled()

    // The avatar button no longer toggles the menu away either.
    fireEvent.click(screen.getByRole('button', { name: /Account: Khalid/ }))
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument()

    await act(async () => {
      endDoorSwing(item.querySelector('.ek-door-leaf')!)
    })
    expect(signOutAction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('menuitem', { name: 'Signing out…' })).toBeInTheDocument()
  })

  it('still dismisses normally when nothing is in progress', async () => {
    renderShell()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Account: Khalid/ }))
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Account' })).toBeNull()
    expect(signOutAction).not.toHaveBeenCalled()
  })
})
