// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PULL_CORD, PullCordThemeToggle } from '@/components/theme/pull-cord-theme-toggle'
import { THEME_STORAGE_KEY, ThemeProvider } from '@/components/theme/theme-provider'

/**
 * The pull-cord switch rendered inside the real ThemeProvider (next-themes) in
 * jsdom. The operating-system preference is stubbed to "light" so the initial
 * `system` theme resolves deterministically.
 */

function stubMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark') ? prefersDark : false,
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

function renderToggle() {
  return render(
    <ThemeProvider>
      <PullCordThemeToggle />
    </ThemeProvider>,
  )
}

function button(): HTMLButtonElement {
  return screen.getByRole('button') as HTMLButtonElement
}

function drag(target: Element, distance: number) {
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'mouse', button: 0, clientY: 100 })
  fireEvent.pointerMove(target, { pointerId: 1, pointerType: 'mouse', clientY: 100 + distance / 2 })
  fireEvent.pointerMove(target, { pointerId: 1, pointerType: 'mouse', clientY: 100 + distance })
  fireEvent.pointerUp(target, { pointerId: 1, pointerType: 'mouse', clientY: 100 + distance })
  // Browsers follow a completed pointer gesture with a click on the same element.
  fireEvent.click(target)
}

beforeEach(() => {
  stubMatchMedia(false)
  window.localStorage.clear()
  document.documentElement.className = ''
})

afterEach(() => {
  cleanup()
})

describe('PullCordThemeToggle', () => {
  it('starts from the system preference and labels the opposite mode', async () => {
    renderToggle()
    await act(async () => {})

    expect(button()).toHaveAttribute('aria-label', 'Switch to dark mode')
    expect(button().dataset.themeState).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('honours a previously stored choice over the system preference', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    renderToggle()
    await act(async () => {})

    expect(button()).toHaveAttribute('aria-label', 'Switch to light mode')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggles on click, updates the label and persists the selection', async () => {
    const user = userEvent.setup()
    renderToggle()
    await act(async () => {})

    await user.click(button())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(button()).toHaveAttribute('aria-label', 'Switch to light mode')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    await user.click(button())
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(button()).toHaveAttribute('aria-label', 'Switch to dark mode')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('is operable from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup()
    renderToggle()
    await act(async () => {})

    await user.tab()
    expect(button()).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.keyboard(' ')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('toggles when the cord is pulled past the threshold, exactly once', async () => {
    renderToggle()
    await act(async () => {})

    await act(async () => {
      drag(button(), PULL_CORD.threshold + 8)
    })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('does nothing when the pull falls short of the threshold', async () => {
    renderToggle()
    await act(async () => {})

    await act(async () => {
      drag(button(), PULL_CORD.threshold - 10)
    })

    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('clamps the pull distance and never lets the cord exceed its maximum', async () => {
    renderToggle()
    await act(async () => {})

    const target = button()
    await act(async () => {
      fireEvent.pointerDown(target, { pointerId: 2, pointerType: 'touch', button: 0, clientY: 50 })
      fireEvent.pointerMove(target, { pointerId: 2, pointerType: 'touch', clientY: 400 })
    })

    const handle = target.querySelectorAll('g')[1] as SVGGElement
    expect(handle.style.transform).toBe(`translateY(${PULL_CORD.maxPull}px)`)

    await act(async () => {
      fireEvent.pointerUp(target, { pointerId: 2, pointerType: 'touch', clientY: 400 })
    })
    expect(handle.style.transform).toBe('translateY(0px)')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
