'use client'

import { LoaderCircle } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'
import { type CategoryFormState, setCategoryActiveFormAction } from '@/server/actions/categories.actions'

function Submit({ isActive }: { isActive: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
      {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {isActive ? 'Deactivate' : 'Activate'}
    </Button>
  )
}

/** Activate / deactivate a category. Never deletes: assets keep their category. */
export function CategoryActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(setCategoryActiveFormAction, null)

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <Submit isActive={isActive} />
      {state && !state.ok ? (
        <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-300">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
