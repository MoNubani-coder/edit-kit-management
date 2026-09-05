import Link from 'next/link'
import type { ReactNode } from 'react'

import { buttonVariants } from '@/components/ui/button'

/** Shared layout for 401 / 403 / 404 pages. */
export function StatusPage({
  code,
  title,
  children,
  action,
}: {
  code: number
  title: string
  children: ReactNode
  action?: { href: string; label: string }
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16 text-center">
      <p className="font-display text-6xl font-semibold tracking-tight text-line-strong">{code}</p>
      <h1 className="mt-4 font-display text-xl font-semibold text-foreground">{title}</h1>
      <div className="mt-2 text-sm text-muted">{children}</div>
      {action ? (
        <div className="mt-8">
          <Link href={action.href} className={buttonVariants({ variant: 'secondary' })}>
            {action.label}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export function ForbiddenView() {
  return (
    <StatusPage code={403} title="Access denied" action={{ href: '/dashboard', label: 'Back to dashboard' }}>
      <p>Your account does not have permission to view this page.</p>
      <p className="mt-1">If you believe you need access, ask an administrator to review your role.</p>
    </StatusPage>
  )
}
