'use client'

import { LoaderCircle, LogOut } from 'lucide-react'
import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'
import { signOutAction } from '@/server/actions/auth.actions'

/**
 * Sign-out is a POST through a Server Action, never a GET link: a link could
 * be triggered by an image tag on a hostile page. Next.js verifies the Origin
 * of every action request, so this also carries CSRF protection for free.
 */

function SubmitButton({ compact }: { compact: boolean }) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      variant="ghost"
      size={compact ? 'icon' : 'sm'}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
    >
      {pending ? (
        <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
      ) : (
        <LogOut aria-hidden className="h-4 w-4" />
      )}
      {compact ? null : <span>Sign out</span>}
    </Button>
  )
}

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={signOutAction}>
      <SubmitButton compact={compact} />
    </form>
  )
}
