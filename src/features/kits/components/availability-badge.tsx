import { Badge, type BadgeTone } from '@/components/ui/badge'
import { KIT_AVAILABILITY_LABEL, type KitAvailability, type KitAvailabilityState } from '@/server/services/kits.service'

const TONES: Record<KitAvailabilityState, BadgeTone> = {
  ready: 'green',
  reserved: 'blue',
  out: 'blue',
  unavailable: 'amber',
}

/** The one-word answer to "can this kit go out": Ready, Reserved, Out, or Not ready with a count. */
export function KitAvailabilityBadge({ availability, className }: { availability: KitAvailability; className?: string }) {
  const label = KIT_AVAILABILITY_LABEL[availability.state]
  const suffix =
    availability.state === 'unavailable' && availability.blockingCount > 0
      ? ` · ${availability.blockingCount}`
      : availability.state === 'ready' && availability.warningCount > 0
        ? ` · ${availability.warningCount} optional`
        : ''
  return (
    <Badge tone={TONES[availability.state]} dot className={className}>
      {label}
      {suffix}
    </Badge>
  )
}
