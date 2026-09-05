import { Badge } from '@/components/ui/badge'

/** Internal / External - the one fact that decides whether an account may be linked. */
export function EditorTypeBadge({ isExternal }: { isExternal: boolean }) {
  return isExternal ? <Badge tone="neutral">External</Badge> : <Badge tone="blue">Internal</Badge>
}

/** Active editors can receive bookings; inactive ones keep their history only. */
export function EditorActiveBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge tone="green" dot>
      Active
    </Badge>
  ) : (
    <Badge tone="neutral" dot>
      Inactive
    </Badge>
  )
}
