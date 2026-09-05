import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { LoginForm } from '@/features/auth/components/login-form'
import { HOME_PATH, isSafeRedirectPath } from '@/server/auth/route-policy'
import { getCurrentUser } from '@/server/auth/session'

export const metadata: Metadata = { title: 'Sign in' }

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Auth.js redirects here with `?error=...` for failures outside the
 * credentials flow. The code is never shown; a generic notice is.
 */
function noticeFor(error: string | undefined): string | undefined {
  if (!error) return undefined
  return 'Sign-in could not be completed. Please try again.'
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // The proxy already sends signed-in users home; this covers direct renders.
  const actor = await getCurrentUser()
  if (actor) redirect(HOME_PATH)

  const params = await searchParams
  const callbackUrl = first(params.callbackUrl)

  return (
    <div className="w-full max-w-[26rem]">
      <div className="theme-transition rounded-panel border border-line bg-panel p-7 shadow-sm sm:p-9">
        <div className="mb-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-foreground">Welcome back</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use your internal account to continue.</p>
        </div>

        <LoginForm
          callbackUrl={isSafeRedirectPath(callbackUrl) ? callbackUrl : undefined}
          notice={noticeFor(first(params.error))}
        />
      </div>

      <p className="mt-6 text-center text-xs text-subtle">Internal use only · Access is logged</p>
    </div>
  )
}
