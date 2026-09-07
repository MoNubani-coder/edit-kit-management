'use client'

import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { HOME_PATH } from '@/server/auth/route-policy'

/**
 * The bounded failure state, shared by the root and app-shell error
 * boundaries.
 *
 * Reached when a page or layout throws - most often because the database is
 * unreachable, which is also when the session cannot be resolved. The visitor
 * keeps their session, sees one page with a retry, and is never redirected:
 * bouncing to /login here is what allowed the old /login <-> /dashboard loop.
 *
 * Nothing from the error object is rendered. Next.js redacts server error
 * messages in production anyway, and internals are not the visitor's business.
 */
export function ErrorView({ reset }: { reset?: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16 text-center">
      <p className="font-display text-6xl font-semibold tracking-tight text-line-strong">503</p>
      <h1 className="mt-4 font-display text-xl font-semibold text-foreground">Temporarily unavailable</h1>
      <div className="mt-2 text-sm text-muted">
        <p>This page could not be loaded. The problem is usually brief and you are still signed in.</p>
        <p className="mt-1">Try again in a moment. If it continues, tell the systems team.</p>
      </div>
      <div className="mt-8 flex items-center justify-center gap-3">
        {reset ? (
          <button type="button" onClick={reset} className={buttonVariants({ variant: 'primary' })}>
            Try again
          </button>
        ) : null}
        <Link href={HOME_PATH} className={buttonVariants({ variant: 'secondary' })}>
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
