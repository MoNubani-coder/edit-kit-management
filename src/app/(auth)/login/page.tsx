import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { LoginForm } from '@/features/auth/components/login-form'
import { HOME_PATH, isSafeRedirectPath } from '@/server/auth/route-policy'
import { resolveSession } from '@/server/auth/session'

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
  // This page decides who is signed in, because it is the first place in the
  // request that can ask the database. The request gate only decodes the
  // cookie, so it serves /login to everyone: a token the gate accepts but the
  // database rejects arrives here and is given the form, which is what keeps
  // the old /login <-> /dashboard loop impossible.
  //
  // An unresolved session (database unreachable) is not treated as signed in
  // and not treated as a hard failure either: the form renders with a notice,
  // so the page stays reachable during an outage.
  const session = await resolveSession()
  if (session.status === 'signed-in') redirect(HOME_PATH)

  const params = await searchParams
  const callbackUrl = first(params.callbackUrl)
  const notice =
    session.status === 'unavailable'
      ? 'Sign-in is temporarily unavailable. Please try again in a moment.'
      : noticeFor(first(params.error))

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
          notice={notice}
        />
      </div>

      <p className="mt-6 text-center text-xs text-subtle">Internal use only · Access is logged</p>
    </div>
  )
}
