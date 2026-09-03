'use client'

import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { type FormEvent, useActionState, useId, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  INITIAL_LOGIN_STATE,
  type LoginFieldErrors,
  loginFieldErrors,
  loginSchema,
} from '@/lib/validation/auth'
import { signInAction } from '@/server/actions/auth.actions'

/**
 * Credentials form.
 *
 * Client-side validation uses the same Zod schema as the server action, but
 * only to save a round-trip - the server re-validates everything. Error copy
 * never distinguishes "no such account" from "wrong password".
 */

interface LoginFormProps {
  callbackUrl?: string
  /** Generic notice from Auth.js redirects, e.g. a configuration error. */
  notice?: string
}

export function LoginForm({ callbackUrl, notice }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(signInAction, INITIAL_LOGIN_STATE)
  const [clientErrors, setClientErrors] = useState<LoginFieldErrors>({})
  const [showPassword, setShowPassword] = useState(false)

  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()

  const serverErrors = state.status === 'error' ? state.fieldErrors ?? {} : {}
  const fieldErrors: LoginFieldErrors = { ...serverErrors, ...clientErrors }
  const message = state.status === 'error' && !state.fieldErrors ? state.message : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget)
    const parsed = loginSchema.safeParse({
      email: data.get('email'),
      password: data.get('password'),
    })

    if (!parsed.success) {
      event.preventDefault()
      setClientErrors(loginFieldErrors(parsed.error))
      return
    }

    setClientErrors({})
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-5">
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}

      {notice ? <Alert variant="warning">{notice}</Alert> : null}
      {message ? (
        <Alert variant="error" className="animate-in">
          <span id={errorId}>{message}</span>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={emailId}>Email address</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          disabled={isPending}
          invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
          onChange={() => clientErrors.email && setClientErrors((errors) => ({ ...errors, email: undefined }))}
        />
        {fieldErrors.email ? (
          <p id={`${emailId}-error`} className="text-xs text-red-600">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={passwordId}>Password</Label>
        <div className="relative">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            disabled={isPending}
            invalid={Boolean(fieldErrors.password)}
            className="pr-11"
            aria-describedby={fieldErrors.password ? `${passwordId}-error` : undefined}
            onChange={() =>
              clientErrors.password && setClientErrors((errors) => ({ ...errors, password: undefined }))
            }
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-800"
          >
            {showPassword ? (
              <EyeOff aria-hidden className="h-4 w-4" />
            ) : (
              <Eye aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>
        {fieldErrors.password ? (
          <p id={`${passwordId}-error`} className="text-xs text-red-600">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending} aria-busy={isPending}>
        {isPending ? (
          <>
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </Button>
    </form>
  )
}
