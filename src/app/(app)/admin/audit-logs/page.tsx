import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { AuditLogFilters } from '@/features/admin/components/audit-log-filters'
import { AuditLogTable } from '@/features/admin/components/audit-log-table'
import { formatDate } from '@/lib/datetime'
import { parseAuditListParams } from '@/lib/validation/audit'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { loadAuditLogPage } from '@/server/services/audit-logs.service'

export const metadata: Metadata = { title: 'Audit Logs' }

export const dynamic = 'force-dynamic'

/**
 * The audit log: who did what, to what, and when.
 *
 * Read-only, and not merely by convention - the database refuses every UPDATE
 * and DELETE on this table, so an entry cannot be corrected or removed by
 * anybody, including whoever is reading this page. That is the point of it.
 *
 * Every filter, sort and page is a URL, so "show me the sign-in failures last
 * Tuesday" is a link somebody can be sent. The columns are the ones a person
 * asks about: the time, the actor with the role they held, the action in
 * words, what it was about with the reference resolved to the number people
 * quote, the summary sentence, and the request it arrived on. The before-and-
 * after JSON a row also carries is never read into this page (AD-27).
 */
export default async function AdminAuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePermissionForPage('admin.audit.read')
  const params = parseAuditListParams(await searchParams)
  const { result, actors, span, timeZone } = await loadAuditLogPage(params)

  const filtered = Boolean(params.q || params.action || params.actorId || params.entityType || params.from || params.to || params.group !== 'all')

  return (
    <>
      <PageHeader
        eyebrow="Administration / Audit Logs"
        title="Audit Logs"
        description={
          span.total === 0
            ? 'Append-only record of sign-ins, state changes and administrative overrides.'
            : `${span.total.toLocaleString()} ${span.total === 1 ? 'entry' : 'entries'}${span.earliest ? `, from ${formatDate(span.earliest, timeZone)}` : ''}${span.latest ? ` to ${formatDate(span.latest, timeZone)}` : ''}. Append-only: entries are never edited or removed.`
        }
        tabs={<AdminTabs actor={actor} active="/admin/audit-logs" />}
      />

      <div className="space-y-4">
        <AuditLogFilters params={params} actors={actors} filtered={filtered} />
        <AuditLogTable result={result} params={params} timeZone={timeZone} filtered={filtered} />
      </div>
    </>
  )
}
