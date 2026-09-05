'use client'

import { LoaderCircle } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

import { Button, type ButtonProps } from '@/components/ui/button'

/**
 * Submit button that asks for confirmation first. Lives inside a <form> bound
 * to a Server Action, so the destructive request is still a POST that the
 * server authorises - the dialog is a courtesy, not a control.
 */
export function ConfirmSubmitButton({
  message,
  children,
  variant = 'danger',
  size = 'sm',
  className,
}: {
  message: string
  children: ReactNode
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
}) {
  const { pending } = useFormStatus()

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(message)) event.preventDefault()
  }

  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending} onClick={onClick}>
      {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  )
}
