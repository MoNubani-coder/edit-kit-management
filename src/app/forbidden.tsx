import { ForbiddenView } from '@/components/common/status-page'

/** Root-level 403 boundary, for `forbidden()` raised outside the app shell. */
export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col">
      <ForbiddenView />
    </main>
  )
}
