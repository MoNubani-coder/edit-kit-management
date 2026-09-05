'use client'

import { useActionState } from 'react'

import { ConfirmSubmitButton } from '@/components/common/confirm-submit-button'
import { type KitFormState, removeKitFormAction } from '@/server/actions/kits.actions'

/** "Remove kit" - soft delete, refused by the server while equipment or a booking depends on it. */
export function RemoveKitForm({ kitId, kitCode, blocker }: { kitId: string; kitCode: string; blocker: string | null }) {
  const [state, formAction] = useActionState<KitFormState, FormData>(removeKitFormAction, null)

  if (blocker) {
    return (
      <p className="self-center text-xs text-muted" title={blocker}>
        Cannot remove: {blocker}
      </p>
    )
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={kitId} />
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-400/10"
        message={`Remove kit ${kitCode} from the inventory? Its history is kept, but it disappears from lists and can no longer be booked.`}
      >
        Remove kit
      </ConfirmSubmitButton>
      {state && !state.ok ? (
        <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-300">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
