import type { ReactNode } from 'react'

import { AppShell } from '@/components/layout/app-shell'
import { navigationFor } from '@/lib/constants/navigation'
import { env } from '@/lib/env'
import { requireAuthForPage } from '@/server/auth/page-guards'

/**
 * Authenticated shell. Resolves the actor from the database, filters the
 * navigation by permission, and hands plain data to the client shell.
 *
 * This layout is a convenience boundary, not the security boundary: layouts do
 * not re-run on every navigation, so each page performs its own check.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireAuthForPage()

  return (
    <AppShell
      appName={env.APP_NAME}
      user={{ name: actor.name, email: actor.email, role: actor.role }}
      sections={navigationFor(actor)}
    >
      {children}
    </AppShell>
  )
}
