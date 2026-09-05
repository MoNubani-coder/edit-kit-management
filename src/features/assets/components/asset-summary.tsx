import { CalendarRange } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { AssetStatusBadge, BookingStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatDateTime } from '@/lib/datetime'
import type { AssetDetail } from '@/server/dal/assets.dal'

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h2 className="font-display text-[15px] font-semibold text-foreground">{title}</h2>
      </header>
      <dl className="grid gap-4 px-5 py-4 text-sm">{children}</dl>
    </section>
  )
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className={mono ? 'mt-1 font-mono text-[13px] text-foreground' : 'mt-1 text-foreground'}>{children}</dd>
    </div>
  )
}

const Empty = () => <span className="text-subtle">—</span>

/** Identification, equipment and current-state panels at the top of the workspace. */
export function AssetSummary({
  asset,
  availableForUse,
  timeZone,
}: {
  asset: AssetDetail
  availableForUse: boolean
  timeZone: string
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Panel title="Identification">
        <Field label="Asset code" mono>
          {asset.assetCode}
        </Field>
        <Field label="ADM barcode" mono>
          {asset.admBarcode ?? <Empty />}
        </Field>
        <Field label="Serial number" mono>
          {asset.serialNumber ?? <Empty />}
        </Field>
      </Panel>

      <Panel title="Equipment">
        <Field label="Category">
          {asset.category.name}
          {!asset.category.isActive ? (
            <Badge tone="neutral" className="ml-2">
              Inactive category
            </Badge>
          ) : null}
        </Field>
        <Field label="Manufacturer">{asset.manufacturer ?? <Empty />}</Field>
        <Field label="Model">{asset.model ?? <Empty />}</Field>
        <Field label="Location">{asset.location ?? <Empty />}</Field>
      </Panel>

      <Panel title="Current state">
        <Field label="Status">
          <span className="flex flex-wrap items-center gap-2">
            <AssetStatusBadge status={asset.status} />
            {asset.activeMaintenanceCount > 0 ? <Badge tone="amber">Maintenance active</Badge> : null}
            {availableForUse ? <Badge tone="green">Ready for use</Badge> : null}
          </span>
        </Field>
        <Field label="Current kit">
          {asset.currentKit ? (
            <Link href="/kits" className="text-accent-foreground hover:underline">
              <span className="font-medium">{asset.currentKit.kitCode}</span> · {asset.currentKit.name}
              {asset.currentKit.slotLabel ? <span className="text-muted"> · {asset.currentKit.slotLabel}</span> : null}
            </Link>
          ) : (
            <span className="text-subtle">Not assigned to a kit</span>
          )}
        </Field>
        <Field label="Active booking">
          {asset.activeBooking ? (
            <span className="flex flex-wrap items-center gap-2">
              <CalendarRange aria-hidden className="h-4 w-4 text-subtle" />
              <Link href="/bookings" className="font-mono text-xs font-semibold text-accent-foreground hover:underline">
                {asset.activeBooking.bookingNumber}
              </Link>
              <BookingStatusBadge status={asset.activeBooking.status} />
              <span className="text-muted">
                {asset.activeBooking.editorName} · due {formatDate(asset.activeBooking.expectedReturnDate, timeZone)}
              </span>
            </span>
          ) : (
            <span className="text-subtle">None</span>
          )}
        </Field>
        <Field label="Last updated">{formatDateTime(asset.updatedAt, timeZone)}</Field>
      </Panel>
    </div>
  )
}
