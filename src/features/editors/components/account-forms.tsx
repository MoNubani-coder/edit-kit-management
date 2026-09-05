'use client'

import { Link2, LoaderCircle } from 'lucide-react'
import { useActionState, useId } from 'react'

import { ConfirmSubmitButton } from '@/components/common/confirm-submit-button'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'
import { type EditorFormState, linkEditorUserFormAction, unlinkEditorUserFormAction } from '@/server/actions/editors.actions'
import type { LinkableUser } from '@/server/dal/editors.dal'

/** Link an internal editor to an existing account. Never creates accounts. */
export function LinkUserForm({ editorId, users }: { editorId: string; users: LinkableUser[] }) {
  const [state, formAction, pending] = useActionState<EditorFormState, FormData>(linkEditorUserFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="space-y-3">
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={editorId} />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <FormField label="Link to user account" htmlFor={`${id}-user`} error={errors.userId} hint="Only live, not-disabled accounts that are not already linked to another editor.">
          <Select id={`${id}-user`} name="userId" defaultValue="" required disabled={users.length === 0} invalid={Boolean(errors.userId)}>
            <option value="">{users.length === 0 ? 'No account available to link' : 'Choose an account…'}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.email} · {user.role.toLowerCase()}
              </option>
            ))}
          </Select>
        </FormField>
        <Button type="submit" size="sm" className="h-10" disabled={pending || users.length === 0} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Link2 aria-hidden className="h-4 w-4" />}
          Link account
        </Button>
      </div>
    </form>
  )
}

export function UnlinkUserForm({ editorId, userName }: { editorId: string; userName: string }) {
  const [state, formAction] = useActionState<EditorFormState, FormData>(unlinkEditorUserFormAction, null)

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="id" value={editorId} />
      <ConfirmSubmitButton variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-400/10" message={`Unlink ${userName} from this editor? The account keeps existing; it just stops seeing these bookings as its own.`}>
        Unlink
      </ConfirmSubmitButton>
      {state && !state.ok ? (
        <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-300">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
