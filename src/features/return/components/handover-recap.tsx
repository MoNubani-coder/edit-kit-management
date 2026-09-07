import { History } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import type { HandoverRecord } from '@/server/dal/return.dal'

const CONDITION_LABEL: Record<string, string> = {
  INCLUDED: 'Handed over',
  MISSING: 'Missing',
  DAMAGED: 'Damaged',
  NOT_APPLICABLE: 'Not handed over',
}

/**
 * What left, as the handover recorded it. This is the document the return is
 * checked against, so it is shown before anything is verified - including
 * items an administrator has since taken off the kit.
 */
export function HandoverRecap({ handover, timeZone, collectionDate }: { handover: HandoverRecord; timeZone: string; collectionDate: Date | null }) {
  const handedOver = handover.lines.filter((line) => line.wasHandedOver)
  const accessories = handedOver.reduce((total, line) => total + line.accessories.filter((accessory) => accessory.handoverStatus === 'INCLUDED').length, 0)
  const editor = handover.signatures.find((signature) => signature.type === 'HANDOVER_EDITOR')

  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <History aria-hidden className="h-4 w-4 text-accent-foreground" />
          What went out
        </h2>
        <span className="text-xs text-muted">
          {collectionDate ? `Collected ${formatDateTime(collectionDate, timeZone)}` : 'Collection time not recorded'}
          {handover.completedByName ? ` · handed over by ${handover.completedByName}` : ''}
          {editor ? ` · signed for by ${editor.signerName}` : ''}
        </span>
      </header>
      <div className="px-5 py-4">
        <p className="text-sm text-muted">
          <span className="font-semibold text-foreground">
            {handedOver.length} {handedOver.length === 1 ? 'item' : 'items'}
          </span>{' '}
          and {accessories} {accessories === 1 ? 'accessory' : 'accessories'} left with this booking. The return is checked against this list, not against the kit as it stands today.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {handover.lines.map((line) => (
            <li key={line.assetId}>
              <span
                className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${
                  line.wasHandedOver ? 'border-line-strong bg-panel text-foreground' : 'border-line bg-panel-header text-muted'
                }`}
              >
                <span className="font-mono font-semibold text-accent-foreground">{line.assetCodeSnapshot}</span>
                <span className="max-w-[14rem] truncate">{line.nameSnapshot}</span>
                {line.wasHandedOver ? null : <Badge tone="neutral">{CONDITION_LABEL[line.handoverStatus]}</Badge>}
              </span>
            </li>
          ))}
        </ul>
        {handover.generalNotes ? <p className="mt-3 text-xs text-muted">Handover notes: {handover.generalNotes}</p> : null}
      </div>
    </section>
  )
}
