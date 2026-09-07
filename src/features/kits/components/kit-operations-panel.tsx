import { CircleAlert, Compass } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { BookingStatusBadge, KitStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { KitAvailabilityBadge } from '@/features/kits/components/availability-badge'
import { formatDateTime } from '@/lib/datetime'
import type { KitBookingSummary } from '@/server/dal/kits.dal'
import type { KitAvailability, KitOperation } from '@/server/services/kits.service'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  )
}

const Empty = () => <span className="text-subtle">—</span>

/**
 * What someone who has just scanned the case needs, in one panel above
 * everything else: where the kit is, who has it, when it is due back, what is
 * wrong with it, and the one or two things worth doing next.
 *
 * The actions are links, not authority: every target page authorises the
 * caller and re-checks the lifecycle, so this panel can only ever offer a
 * shortcut to something already permitted.
 */
export function KitOperationsPanel({
  kit,
  availability,
  liveBooking,
  operations,
  timeZone,
  canReadEditor,
}: {
  kit: { id: string; kitCode: string; name: string; status: string; admBarcode: string | null }
  availability: KitAvailability
  liveBooking: KitBookingSummary | null
  operations: KitOperation[]
  timeZone: string
  canReadEditor: boolean
}) {
  const blocking = availability.reasons.filter((reason) => reason.severity === 'blocking')
  const warnings = availability.reasons.filter((reason) => reason.severity === 'warning')

  return (
    <section className="theme-transition rounded-panel border border-accent/40 bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <Compass aria-hidden className="h-4 w-4 text-accent-foreground" />
          Where this kit stands
        </h2>
        <span className="flex flex-wrap items-center gap-2">
          <KitStatusBadge status={kit.status as never} />
          <KitAvailabilityBadge availability={availability} />
        </span>
      </header>

      <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Kit">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-accent-foreground">{kit.kitCode}</span>
            <span className="font-medium">{kit.name}</span>
          </span>
        </Field>
        <Field label="Equipment">
          {availability.memberCount} {availability.memberCount === 1 ? 'item' : 'items'}
          {availability.requiredCount > 0 ? <span className="text-muted"> · {availability.requiredCount} required</span> : null}
        </Field>
        <Field label="Current booking">
          {liveBooking ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{liveBooking.bookingNumber}</span>
              <BookingStatusBadge status={liveBooking.status} />
            </span>
          ) : (
            <Empty />
          )}
        </Field>
        <Field label="With">
          {liveBooking ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{liveBooking.editorName}</span>
              {canReadEditor ? null : null}
            </span>
          ) : (
            <Empty />
          )}
        </Field>
        <Field label="Collected">{liveBooking?.collectionDate ? formatDateTime(liveBooking.collectionDate, timeZone) : <Empty />}</Field>
        <Field label="Expected return">{liveBooking ? formatDateTime(liveBooking.expectedReturnDate, timeZone) : <Empty />}</Field>
        <Field label="Engineer">{liveBooking ? liveBooking.engineerName : <Empty />}</Field>
        <Field label="Barcode">{kit.admBarcode ? <span className="font-mono text-[13px]">{kit.admBarcode}</span> : <Empty />}</Field>
      </dl>

      {blocking.length > 0 || warnings.length > 0 ? (
        <div className="border-t border-line px-5 py-3 text-sm">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
            <CircleAlert aria-hidden className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            Needs attention
          </p>
          <ul className="mt-2 space-y-1">
            {blocking.map((reason, index) => (
              <li key={`blocking-${index}`} className="flex flex-wrap items-center gap-2 text-foreground">
                <Badge tone="red">Blocking</Badge>
                {reason.reason}
              </li>
            ))}
            {warnings.map((reason, index) => (
              <li key={`warning-${index}`} className="flex flex-wrap items-center gap-2 text-muted">
                <Badge tone="amber">Noted</Badge>
                {reason.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {operations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          {operations.map((operation) => (
            <Link key={`${operation.key}:${operation.href}`} href={operation.href} className={buttonVariants({ variant: operation.primary ? 'primary' : 'secondary', size: 'sm' })} title={operation.detail}>
              {operation.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
