'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'

/** localStorage key holding the chosen theme; survives navigation and sign-out. */
export const THEME_STORAGE_KEY = 'ekms-theme'

/**
 * Global theme state, backed by next-themes.
 *
 * - `attribute="class"` puts `light` / `dark` on <html>; the Tailwind `dark:`
 *   variant and the CSS tokens in globals.css key off that class.
 * - `enableSystem` means the default follows the operating system until the
 *   user pulls the cord, after which their choice is stored and wins.
 * - `nonce` is the per-request CSP nonce minted by proxy.ts, so the tiny
 *   anti-flash script next-themes injects is allowed by the strict
 *   `script-src` policy without any `unsafe-inline`.
 */
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      storageKey={THEME_STORAGE_KEY}
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  )
}
