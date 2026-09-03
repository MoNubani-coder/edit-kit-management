import { StatusPage } from '@/components/common/status-page'

/** 401 boundary, rendered when `unauthorized()` is raised during rendering. */
export default function Unauthorized() {
  return (
    <main className="flex min-h-screen flex-col">
      <StatusPage code={401} title="Sign in required" action={{ href: '/login', label: 'Go to sign in' }}>
        <p>Your session has ended or you are not signed in.</p>
      </StatusPage>
    </main>
  )
}
