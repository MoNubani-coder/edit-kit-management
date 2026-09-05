'use client'

import { LoaderCircle, LogOut } from 'lucide-react'
import { useFormStatus } from 'react-dom'

import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { signOutAction } from '@/server/actions/auth.actions'

/**
 * Sign-out is a POST through a Server Action, never a GET link: a link could
 * be triggered by an image tag on a hostile page. Next.js verifies the Origin
 * of every action request, so this also carries CSRF protection for free.
 */

function SubmitButton({
  compact,
  variant,
  className,
}: {
  compact: boolean
  variant: ButtonProps['variant']
  className?: string
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      variant={variant}
      size={compact ? 'icon' : 'sm'}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
      className={cn(!compact && 'w-full justify-start', className)}
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

export function SignOutButton({
  compact = false,
  variant = 'ghost',
  className,
}: {
  compact?: boolean
  variant?: ButtonProps['variant']
  className?: string
}) {
  return (
    <form action={signOutAction}>
      <SubmitButton compact={compact} variant={variant} className={className} />
    </form>
  )
}
