'use client'

import { LoaderCircle } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ROLE_LABELS } from '@/lib/constants/roles'
import { USER_ROLES, type UserRoleValue } from '@/lib/validation/admin'
import { type AdminFormState, setUserRoleFormAction, setUserStatusFormAction, unlockUserFormAction } from '@/server/actions/admin.actions'

/**
 * What an administrator can do to an account from the list.
 *
 * Deliberately not everything. Changing a role or suspending an account both
 * revoke the target's sessions on the server, so these are small, explicit
 * controls rather than an inline-editable row - and each one is its own form,
 * so a mis-click cannot submit two changes at once.
 *
 * Setting a password is not here on purpose: that needs a decision about how
 * the password reaches the person, so it stays with the break-glass script.
 */

function Failure({ state }: { state: AdminFormState }) {
  if (!state || state.ok) return null
  return (
    <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-300">
      {state.message}
    </p>
  )
}

function Submit({ children, variant = 'ghost' }: { children: React.ReactNode; variant?: 'ghost' | 'secondary' | 'danger' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  )
}

/** The role select submits on change; the server decides whether it is allowed. */
export function UserRoleControl({ userId, role, disabled, disabledReason }: { userId: string; role: UserRoleValue; disabled: boolean; disabledReason?: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(setUserRoleFormAction, null)

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <label className="sr-only" htmlFor={`role-${userId}`}>
        Role
      </label>
      <Select
        id={`role-${userId}`}
        name="role"
        defaultValue={role}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className="h-9 w-40"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {USER_ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </Select>
      <Failure state={state} />
    </form>
  )
}

export function UserStatusControl({ userId, status, disabled, disabledReason }: { userId: string; status: string; disabled: boolean; disabledReason?: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(setUserStatusFormAction, null)
  const suspended = status === 'SUSPENDED' || status === 'DISABLED'

  if (disabled) {
    return (
      <span className="text-xs text-subtle" title={disabledReason}>
        {disabledReason ?? '—'}
      </span>
    )
  }

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={suspended ? 'ACTIVE' : 'SUSPENDED'} />
      <Submit variant={suspended ? 'secondary' : 'ghost'}>{suspended ? 'Reinstate' : 'Suspend'}</Submit>
      <Failure state={state} />
    </form>
  )
}

/** Only offered while the account is actually locked out. */
export function UserUnlockControl({ userId }: { userId: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(unlockUserFormAction, null)

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="userId" value={userId} />
      <Submit>Clear lockout</Submit>
      <Failure state={state} />
    </form>
  )
}
