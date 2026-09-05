'use client'

import { useActionState } from 'react'

import { ConfirmSubmitButton } from '@/components/common/confirm-submit-button'
import { type EditorFormState, removeEditorFormAction, setEditorActiveFormAction } from '@/server/actions/editors.actions'

function Failure({ state }: { state: EditorFormState }) {
  if (!state || state.ok) return null
  return (
    <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-300">
      {state.message}
    </p>
  )
}

/** Deactivate / reactivate. Deactivation is refused while the editor holds a kit. */
export function SetActiveForm({ editorId, name, isActive, blocker }: { editorId: string; name: string; isActive: boolean; blocker: string | null }) {
  const [state, formAction] = useActionState<EditorFormState, FormData>(setEditorActiveFormAction, null)

  if (isActive && blocker) {
    return (
      <p className="self-center text-xs text-muted" title={blocker}>
        Cannot deactivate: {blocker}
      </p>
    )
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={editorId} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <ConfirmSubmitButton
        variant={isActive ? 'ghost' : 'secondary'}
        size="sm"
        className={isActive ? 'text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-400/10' : undefined}
        message={
          isActive
            ? `Deactivate ${name}? They can no longer be chosen for new bookings; past bookings stay readable.`
            : `Reactivate ${name}? They can be chosen for new bookings again.`
        }
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </ConfirmSubmitButton>
      <Failure state={state} />
    </form>
  )
}

/** Remove from the directory - soft delete, only for a profile with no history. */
export function RemoveEditorForm({ editorId, name, blocker }: { editorId: string; name: string; blocker: string | null }) {
  const [state, formAction] = useActionState<EditorFormState, FormData>(removeEditorFormAction, null)

  if (blocker) return null

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={editorId} />
      <ConfirmSubmitButton variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-400/10" message={`Remove ${name} from the editor directory? This editor has no bookings; the record is kept for the audit trail only.`}>
        Remove
      </ConfirmSubmitButton>
      <Failure state={state} />
    </form>
  )
}
