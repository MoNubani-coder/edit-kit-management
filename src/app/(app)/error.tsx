'use client'

import { ErrorView } from '@/components/common/error-view'

/** Rendered inside the shell when a page throws, keeping the top navigation. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView reset={reset} />
}
