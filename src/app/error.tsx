'use client'

import { ErrorView } from '@/components/common/error-view'

/**
 * Root error boundary.
 *
 * Catches throws from outside the app shell and from the shell's own layout -
 * which is where `ServiceUnavailableError` lands when the database cannot be
 * reached, since a layout's own boundary does not catch its own error.
 */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <ErrorView reset={reset} />
    </main>
  )
}
