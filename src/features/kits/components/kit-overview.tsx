import { CalendarRange } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { BookingStatusBadge, KitStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { SUITCASE_STATUS_LABELS } from '@/lib/validation/kits'
import type { KitDetail } from '@/server/dal/kits.dal'
import type { KitAvailability } from '@/server/services/kits.service'

import { kitHref } from '../hrefs'
import { KitAvailabilityBadge } from './availability-badge'
import { AvailabilityNotice } from './availability-notice'

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`theme-transition rounded-panel border border-line bg-panel ${className ?? ''}`}>
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

interface CategorySummary {
  id: string
  name: string
  sortOrder: number
  total: number
  attention: number
}

function summariseByCategory(kit: KitDetail, availability: KitAvailability): CategorySummary[] {
  const flagged = new Set(availability.reasons.map((reason) => reason.assetId).filter((id): id is string => Boolean(id)))
  const groups = new Map<string, CategorySummary>()
  for (const member of kit.members) {
    const group = groups.get(member.category.id) ?? { id: member.category.id, name: member.category.name, sortOrder: member.category.sortOrder, total: 0, attention: 0 }
    group.total += 1
    if (flagged.has(member.assetId)) group.attention += 1
    groups.set(member.category.id, group)
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/** The Overview tab: identity, current state, configuration, and equipment by category. */
export function KitOverview({ kit, availability, timeZone }: { kit: KitDetail; availability: KitAvailability; timeZone: string }) {
  const booking = kit.liveBooking
  const categories = summariseByCategory(kit, availability)
  const optionalCount = availability.memberCount - availability.requiredCount

  return (
    <div className="space-y-6">
      <AvailabilityNotice availability={availability} />

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Identity">
          <Field label="Kit code" mono>
            {kit.kitCode}
          </Field>
          <Field label="ADM barcode" mono>
            {kit.admBarcode ?? <Empty />}
          </Field>
          <Field label="Location">{kit.location ?? <Empty />}</Field>
          <Field label="Case">{SUITCASE_STATUS_LABELS[kit.suitcaseStatus]}</Field>
          {kit.description ? <Field label="Description">{kit.description}</Field> : null}
        </Panel>

        <Panel title="Current state">
          <Field label="Status">
            <span className="flex flex-wrap items-center gap-2">
              <KitStatusBadge status={kit.status} />
              <KitAvailabilityBadge availability={availability} />
            </span>
          </Field>
          <Field label="Current booking">
            {booking ? (
              <span className="flex flex-wrap items-center gap-2">
                <CalendarRange aria-hidden className="h-4 w-4 text-subtle" />
                <Link href="/bookings" className="font-mono text-xs font-semibold text-accent-foreground hover:underline">
                  {booking.bookingNumber}
                </Link>
                <BookingStatusBadge status={booking.status} />
              </span>
            ) : (
              <span className="text-subtle">None</span>
            )}
          </Field>
          <Field label="Editor">{booking ? booking.editorName : <Empty />}</Field>
          <Field label={booking?.collectionDate ? 'Collected · expected return' : 'Booking period'}>
            {booking ? (
              booking.collectionDate ? (
                <>
                  {formatDate(booking.collectionDate, timeZone)} <span className="text-subtle">→</span> {formatDate(booking.expectedReturnDate, timeZone)}
                </>
              ) : (
                <>
                  {formatDate(booking.bookingStart, timeZone)} <span className="text-subtle">→</span> {formatDate(booking.bookingEnd, timeZone)}
                </>
              )
            ) : (
              <Empty />
            )}
          </Field>
          <Field label="Last updated">{formatDateTime(kit.updatedAt, timeZone)}</Field>
        </Panel>

        <Panel title="Configuration">
          <Field label="Equipment">
            <Link href={kitHref(kit.id, 'equipment')} className="text-accent-foreground hover:underline">
              {availability.memberCount} {availability.memberCount === 1 ? 'item' : 'items'}
            </Link>
            <span className="text-muted">
              {' '}
              · {availability.requiredCount} required{optionalCount > 0 ? `, ${optionalCount} optional` : ''}
            </span>
          </Field>
          <Field label="Software">
            <Link href={kitHref(kit.id, 'software')} className="text-accent-foreground hover:underline">
              {kit.software.length} {kit.software.length === 1 ? 'application' : 'applications'}
            </Link>
            {kit.software.length > 0 ? (
              <span className="block text-xs text-muted">{kit.software.map((row) => row.software.name).join(', ')}</span>
            ) : null}
          </Field>
          <Field label="Handover checklist">
            <Link href={kitHref(kit.id, 'checklist')} className="text-accent-foreground hover:underline">
              {kit.checklistTemplate ? kit.checklistTemplate.name : 'System default'}
            </Link>
            {kit.checklistTemplate ? <span className="block text-xs text-muted">{kit.checklistTemplate.itemCount} checks · v{kit.checklistTemplate.version}</span> : null}
          </Field>
          <Field label="Bookings">
            {kit.bookingCount} {kit.bookingCount === 1 ? 'booking' : 'bookings'} on record
            {kit.openIssueCount !== null && kit.openIssueCount > 0 ? (
              <Badge tone="amber" className="ml-2">
                {kit.openIssueCount} open {kit.openIssueCount === 1 ? 'issue' : 'issues'}
              </Badge>
            ) : null}
          </Field>
        </Panel>
      </div>

      <section className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-foreground">Equipment by category</h2>
            <p className="mt-0.5 text-xs text-muted">What travels in the case, grouped the way the handover form lists it.</p>
          </div>
          <Link href={kitHref(kit.id, 'equipment')} className="text-sm font-medium text-accent-foreground hover:underline">
            Open equipment
          </Link>
        </header>
        {categories.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No equipment in this kit yet.</p>
        ) : (
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 bg-panel px-5 py-3.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{category.name}</span>
                <span className="flex items-center gap-2">
                  {category.attention > 0 ? (
                    <Badge tone="amber">
                      {category.attention} {category.attention === 1 ? 'needs' : 'need'} attention
                    </Badge>
                  ) : null}
                  <span className="font-display text-lg font-semibold tabular-nums text-foreground">{category.total}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {kit.notes ? (
        <section className="theme-transition rounded-panel border border-line bg-panel">
          <header className="border-b border-line bg-panel-header px-5 py-3">
            <h2 className="font-display text-[15px] font-semibold text-foreground">Notes</h2>
          </header>
          <p className="whitespace-pre-line px-5 py-4 text-sm text-foreground">{kit.notes}</p>
        </section>
      ) : null}
    </div>
  )
}
