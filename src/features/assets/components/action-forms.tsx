'use client'

import { useActionState } from 'react'

import { ConfirmSubmitButton } from '@/components/common/confirm-submit-button'
import { removeAccessoryFormAction } from '@/server/actions/accessories.actions'
import { removeAssetFormAction } from '@/server/actions/assets.actions'
import type { ActionResult } from '@/server/auth/action'

type State = ActionResult<void> | null

function Failure({ state }: { state: State }) {
  if (!state || state.ok) return null
  return (
    <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-300">
      {state.message}
    </p>
  )
}

/** "Remove from inventory" - soft delete, refused by the server when unsafe. */
export function RemoveAssetForm({ assetId, assetCode, blocker }: { assetId: string; assetCode: string; blocker: string | null }) {
  const [state, formAction] = useActionState<State, FormData>(removeAssetFormAction, null)

  if (blocker) {
    return (
      <p className="text-xs text-muted" title={blocker}>
        Cannot remove: {blocker}
      </p>
    )
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={assetId} />
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-400/10"
        message={`Remove ${assetCode} from the inventory? Its history is kept, but it disappears from lists and kits.`}
      >
        Remove from inventory
      </ConfirmSubmitButton>
      <Failure state={state} />
    </form>
  )
}

export function RemoveAccessoryForm({ accessoryId, label }: { accessoryId: string; label: string }) {
  const [state, formAction] = useActionState<State, FormData>(removeAccessoryFormAction, null)

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="accessoryId" value={accessoryId} />
      <ConfirmSubmitButton variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-400/10" message={`Remove ${label}? Past handover records keep their reference.`}>
        Remove
      </ConfirmSubmitButton>
      <Failure state={state} />
    </form>
  )
}
