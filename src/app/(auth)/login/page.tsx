import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { LoginForm } from '@/features/auth/components/login-form'
import { env } from '@/lib/env'
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
    <div className="w-full max-w-md">
      <div className="mb-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
          EK
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{env.APP_NAME}</h1>
        <p className="mt-1 text-sm text-slate-600">{env.APP_ORG_NAME}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-base font-semibold text-slate-900">Sign in</h2>
        <p className="mb-6 mt-1 text-sm text-slate-600">Use your internal account to continue.</p>

        <LoginForm
          callbackUrl={isSafeRedirectPath(callbackUrl) ? callbackUrl : undefined}
          notice={noticeFor(first(params.error))}
        />
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        Internal system. Access is logged. Contact Engineering for account requests.
      </p>
    </div>
  )
}
