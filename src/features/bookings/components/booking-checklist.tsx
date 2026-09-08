import { ClipboardCheck } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import type { BookingWorkspace } from '@/server/services/bookings.service'

import { PrepareChecklistForm } from './prepare-checklist-form'

/**
 * The booking's own checklist, prepared before the handover.
 *
 * The items were copied from the kit's template when the booking was made, so
 * a later template edit cannot change them. Handover-phase checks are answered
 * here; every required one must pass, or be marked not applicable with a note,
 * before the booking can be set aside for handover. Return-phase checks are
 * listed for reference and answered when the kit comes back.
 */
export function BookingChecklist({ workspace, timeZone }: { workspace: BookingWorkspace; timeZone: string }) {
  const { booking, checklist, canPrepareChecklist } = workspace
  const handover = checklist.items.filter((item) => item.phase === 'HANDOVER' || item.phase === 'BOTH')
  const returnOnly = checklist.items.filter((item) => item.phase === 'RETURN')

  if (checklist.items.length === 0) {
    return (
      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <EmptyState
          icon={ClipboardCheck}
          title="No checklist on this booking"
          description="The kit had no checklist template and no system default existed when this booking was made. The handover can proceed without checks."
        />
      </div>
    )
  }

  const locked = !canPrepareChecklist

  return (
    <div className="space-y-4">
      {checklist.complete ? (
        <Alert variant="info" title="Checklist complete">
          Every required handover check has passed or been marked not applicable
          {booking.checklistPreparedAt ? ` · finished ${formatDateTime(booking.checklistPreparedAt, timeZone)}${booking.checklistPreparedBy ? ` by ${booking.checklistPreparedBy.name}` : ''}` : ''}.
          {booking.status === 'RESERVED' ? ' The booking can now be set aside for handover from the Overview tab.' : ''}
        </Alert>
      ) : (
        <Alert variant="warning" title={`${checklist.outstanding.length} of ${checklist.required} required ${checklist.outstanding.length === 1 ? 'check' : 'checks'} outstanding`}>
          The booking cannot be set aside for handover until every required check passes or is marked not applicable. A failed check blocks it until the problem is fixed.
        </Alert>
      )}

      {locked && !checklist.complete && (booking.status === 'DRAFT' || booking.status === 'RESERVED' || booking.status === 'READY_FOR_HANDOVER') ? (
        <p className="text-sm text-muted">{workspace.handover ? 'The handover has started; review the checklist on the handover page.' : 'You can view this checklist but not answer it.'}</p>
      ) : null}

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">
            Handover checks <span className="font-normal text-muted">· {booking.checklistTemplate?.name ?? 'System default'}</span>
          </h2>
          <span className="text-xs text-muted">
            {checklist.answered} of {handover.length} answered · {checklist.passed} passed{checklist.failed > 0 ? ` · ${checklist.failed} failed` : ''}
          </span>
        </header>
        <div className="p-5">
          <PrepareChecklistForm bookingId={booking.id} items={handover} disabled={locked} timeZone={timeZone} />
        </div>
      </section>

      {returnOnly.length > 0 ? (
        <section className="theme-transition rounded-panel border border-line bg-panel">
          <header className="border-b border-line bg-panel-header px-5 py-3">
            <h2 className="font-display text-[15px] font-semibold text-foreground">
              Return checks <span className="font-normal text-muted">· answered when the kit comes back</span>
            </h2>
          </header>
          <ol className="divide-y divide-line px-5">
            {returnOnly.map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 py-3 text-sm text-foreground">
                <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, '0')}</span>
                {item.label}
                {item.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}
