import Link from 'next/link'

import { Alert } from '@/components/ui/alert'
import type { KitAvailability } from '@/server/services/kits.service'

/**
 * The availability verdict as a sentence plus the list of what stands in the
 * way, each pointing at the equipment concerned. Quiet when the kit is ready
 * and nothing needs a look.
 */
export function AvailabilityNotice({ availability, className }: { availability: KitAvailability; className?: string }) {
  if (availability.reasons.length === 0) return null

  const blocking = availability.reasons.filter((reason) => reason.severity === 'blocking')
  const warnings = availability.reasons.filter((reason) => reason.severity === 'warning')

  const title = availability.available
    ? `Ready to go out · ${warnings.length} optional ${warnings.length === 1 ? 'item needs' : 'items need'} attention`
    : availability.state === 'out'
      ? 'Kit is out with an editor'
      : availability.state === 'reserved'
        ? 'Kit is reserved'
        : `Kit unavailable · ${blocking.length} ${blocking.length === 1 ? 'item needs' : 'items need'} attention`

  const variant = availability.state === 'out' || availability.state === 'reserved' ? 'info' : 'warning'

  return (
    <Alert variant={variant} title={title} className={className}>
      <ul className="mt-1 space-y-0.5">
        {[...blocking, ...warnings].map((reason, index) => (
          <li key={`${reason.code}:${reason.assetId ?? 'kit'}:${index}`} className="flex flex-wrap items-baseline gap-x-2">
            {reason.assetId ? (
              <Link href={`/assets/${reason.assetId}`} className="font-mono text-xs font-semibold hover:underline">
                {reason.assetCode}
              </Link>
            ) : null}
            <span>{reason.assetCode ? reason.reason.replace(`${reason.assetCode} `, '') : reason.reason}</span>
            {reason.slotLabel ? <span className="text-xs opacity-80">({reason.slotLabel})</span> : null}
            {reason.severity === 'warning' ? <span className="text-xs opacity-80">optional</span> : null}
          </li>
        ))}
      </ul>
    </Alert>
  )
}
