import { ScrollText } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import { ROLE_LABELS } from '@/lib/constants/roles'
import { cn } from '@/lib/utils/cn'
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  type AuditActionValue,
  type AuditEntityType,
  auditLogHref,
  type AuditListParams,
  type AuditSortKey,
} from '@/lib/validation/audit'
import type { AuditLogResult } from '@/server/dal/audit.dal'

/**
 * The log, newest first.
 *
 * Every column is a value the service wrote for a person to read: the summary
 * sentence, the resolved reference, who did it and from where. The JSON a row
 * also carries - the before and after of a change - is never read into this
 * page, so nothing any call site puts there can end up on screen.
 *
 * Read-only by construction: there is no action, no form and no control that
 * writes. The database refuses an update or a delete regardless.
 */

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-top'
const Empty = () => <span className="text-subtle">—</span>

/** Sign-in failures and removals are the rows an administrator is looking for. */
const TONES: Partial<Record<AuditActionValue, BadgeTone>> = {
  LOGIN_FAILED: 'red',
  DELETE: 'red',
  SIGNATURE_VOIDED: 'red',
  INSPECTION_VOIDED: 'red',
  BOOKING_CANCELLED: 'red',
  ADMIN_OVERRIDE: 'amber',
  ROLE_CHANGED: 'amber',
  PASSWORD_CHANGED: 'amber',
  SETTING_CHANGED: 'amber',
  ISSUE_CREATED: 'amber',
  HANDOVER_COMPLETED: 'green',
  RETURN_COMPLETED: 'green',
  ISSUE_RESOLVED: 'green',
  LOGIN_SUCCESS: 'blue',
}

const actionLabel = (action: string) => AUDIT_ACTION_LABELS[action as AuditActionValue] ?? action.toLowerCase().replace(/_/g, ' ')
const entityLabel = (entityType: string) => AUDIT_ENTITY_LABELS[entityType as AuditEntityType] ?? entityType

/**
 * The client's own description of itself, shortened to the part that answers
 * "what were they using". Never the whole string, which is noise.
 */
function shortClient(userAgent: string | null): string | null {
  if (!userAgent) return null
  const platform = /iPhone|iPad|Android|Macintosh|Windows|Linux/i.exec(userAgent)?.[0] ?? null
  const browser = /Edg|Chrome|Firefox|Safari/i.exec(userAgent)?.[0] ?? null
  const parts = [browser === 'Edg' ? 'Edge' : browser, platform].filter(Boolean)
  return parts.length > 0 ? parts.join(' on ') : null
}

function SortHeader({ label, sortKey, params, className }: { label: string; sortKey: AuditSortKey; params: AuditListParams; className?: string }) {
  const active = params.sort === sortKey
  const next = active && params.dir === 'desc' ? 'asc' : 'desc'
  return (
    <th scope="col" className={cn(TH, className)} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link href={auditLogHref(params, { sort: sortKey, dir: next, page: 1 })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active ? <span aria-hidden>{params.dir === 'asc' ? '↑' : '↓'}</span> : null}
      </Link>
    </th>
  )
}

export function AuditLogTable({ result, params, timeZone, filtered }: { result: AuditLogResult; params: AuditListParams; timeZone: string; filtered: boolean }) {
  if (result.rows.length === 0) {
    return (
      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <EmptyState
          icon={ScrollText}
          title={filtered ? 'Nothing matches' : 'The log is empty'}
          description={
            filtered
              ? 'Try a wider date range, another area, or clear the filters. Entries are never removed, so anything that happened is still here.'
              : 'Sign-ins, bookings, handovers and administrative changes are recorded here as they happen.'
          }
        />
      </div>
    )
  }

  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="border-b border-line bg-panel-header">
            <tr>
              <SortHeader label="When" sortKey="createdAt" params={params} className="w-44" />
              <SortHeader label="Who" sortKey="actorName" params={params} className="w-52" />
              <SortHeader label="Action" sortKey="action" params={params} className="w-56" />
              <SortHeader label="About" sortKey="entityType" params={params} className="w-28" />
              <th scope="col" className={TH}>
                Reference
              </th>
              <th scope="col" className={TH}>
                What happened
              </th>
              <th scope="col" className={cn(TH, 'w-44')}>
                Request
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {result.rows.map((row) => {
              const client = shortClient(row.userAgent)
              return (
                <tr key={row.id} className="transition-colors hover:bg-panel-header/60">
                  <td className={cn(TD, 'whitespace-nowrap tabular-nums text-muted')}>{formatDateTime(row.createdAt, timeZone)}</td>
                  <td className={TD}>
                    <span className="font-medium text-foreground">{row.actorName}</span>
                    {row.actorRole ? <span className="mt-0.5 block text-xs text-subtle">{ROLE_LABELS[row.actorRole]}</span> : null}
                  </td>
                  <td className={TD}>
                    <Badge tone={TONES[row.action as AuditActionValue] ?? 'neutral'}>{actionLabel(row.action)}</Badge>
                  </td>
                  <td className={cn(TD, 'text-muted')}>{entityLabel(row.entityType)}</td>
                  <td className={TD}>
                    {row.reference ? (
                      row.href ? (
                        <Link href={row.href} className="font-medium text-accent-foreground underline-offset-2 hover:underline">
                          {row.reference}
                        </Link>
                      ) : (
                        <span className="text-foreground">{row.reference}</span>
                      )
                    ) : (
                      <Empty />
                    )}
                  </td>
                  <td className={cn(TD, 'text-foreground')}>{row.summary ?? <Empty />}</td>
                  <td className={cn(TD, 'text-xs text-muted')}>
                    {row.ipAddress ? <span className="block font-mono">{row.ipAddress}</span> : null}
                    {client ? <span className="block">{client}</span> : null}
                    {!row.ipAddress && !client ? <Empty /> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={(page) => auditLogHref(params, { page })} />
    </div>
  )
}
