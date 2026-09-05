import { StatusPage } from '@/components/common/status-page'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <StatusPage code={404} title="Page not found" action={{ href: '/dashboard', label: 'Back to dashboard' }}>
        <p>The page you asked for does not exist or has moved.</p>
      </StatusPage>
    </main>
  )
}
