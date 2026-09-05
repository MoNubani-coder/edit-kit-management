import type { ReactNode } from 'react'

import { PullCordThemeToggle } from '@/components/theme/pull-cord-theme-toggle'
import { APP_TAGLINE, BRAND_HIGHLIGHTS } from '@/lib/constants/branding'
import { env } from '@/lib/env'

/**
 * Sign-in frame. A navy brand panel (the same navy as the application rail)
 * sits beside the form column on wide screens; below `lg` it collapses to a
 * navy band above the card. The compact pull-cord in the corner switches the
 * theme here too, so the login page and the application always agree.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="relative hidden bg-nav text-nav-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <div className="absolute right-8 top-8 text-nav-muted hover:text-nav-foreground">
          <PullCordThemeToggle variant="compact" />
        </div>

        <BrandMark size="lg" name={env.APP_NAME} />

        <div className="max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-foreground dark:text-accent">
            {env.APP_ORG_NAME}
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight text-white">
            {env.APP_NAME}
          </h1>
          <p className="mt-3 text-lg text-nav-muted">{APP_TAGLINE}</p>
          <ul className="mt-10 space-y-3 border-t border-nav-line pt-8">
            {BRAND_HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm text-nav-muted">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-nav-muted">Internal use only</p>
      </aside>

      <main className="theme-transition flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-4 bg-nav px-5 py-4 text-nav-foreground lg:hidden">
          <div className="flex items-center gap-3">
            <BrandMark size="md" name={env.APP_NAME} />
            <div className="leading-tight">
              <h1 className="font-display text-base font-semibold text-white">{env.APP_NAME}</h1>
              <p className="text-xs text-nav-muted">{APP_TAGLINE}</p>
            </div>
          </div>
          <div className="text-nav-muted hover:text-nav-foreground">
            <PullCordThemeToggle variant="compact" />
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8 lg:px-12">{children}</div>
      </main>
    </div>
  )
}

function BrandMark({ size, name }: { size: 'md' | 'lg'; name: string }) {
  const box = size === 'lg' ? 'h-12 w-12 text-base' : 'h-10 w-10 text-sm'
  return (
    <div
      role="img"
      aria-label={`${name} logo`}
      className={`flex ${box} items-center justify-center rounded-lg bg-accent font-display font-extrabold tracking-tight text-white shadow-sm`}
    >
      EK
    </div>
  )
}
