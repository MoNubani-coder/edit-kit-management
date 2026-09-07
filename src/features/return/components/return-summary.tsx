import { PackageCheck, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { returnPunctuality } from '@/lib/booking-rules'
import { formatDateTime } from '@/lib/datetime'
import { SUITCASE_STATUS_LABELS } from '@/lib/validation/kits'
import type { ReturnSummary } from '@/server/dal/return.dal'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  )
}

const PUNCTUALITY: Record<ReturnType<typeof returnPunctuality>, { label: string; tone: BadgeTone }> = {
  early: { label: 'Returned early', tone: 'blue' },
  'on-time': { label: 'Returned on time', tone: 'green' },
  late: { label: 'Returned late', tone: 'amber' },
}

const SEVERITY_TONE: Record<string, BadgeTone> = { LOW: 'neutral', MEDIUM: 'amber', HIGH: 'amber', CRITICAL: 'red' }

/**
 * The return as the booking page and the return page show it afterwards:
 * what came back, what did not, the issues that were raised, and whether the
 * kit was late - derived from the expected and actual return times, never
 * stored as a flag.
 */
export function ReturnSummaryPanel({
  summary,
  expectedReturnDate,
  actualReturnDate,
  timeZone,
  canReadIssues = false,
}: {
  summary: ReturnSummary
  expectedReturnDate: Date
  actualReturnDate: Date | null
  timeZone: string
  canReadIssues?: boolean
}) {
  const complete = summary.status === 'COMPLETED'
  const punctuality = actualReturnDate ? returnPunctuality(expectedReturnDate, actualReturnDate) : null

  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <PackageCheck aria-hidden className="h-4 w-4 text-accent-foreground" />
          Return
        </h2>
        <span className="flex flex-wrap items-center gap-2">
          {punctuality ? <Badge tone={PUNCTUALITY[punctuality].tone}>{PUNCTUALITY[punctuality].label}</Badge> : null}
          <Badge tone={complete ? 'green' : 'amber'} dot>
            {complete ? 'Completed' : 'In progress'}
          </Badge>
        </span>
      </header>

      <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Actual return">{actualReturnDate ? formatDateTime(actualReturnDate, timeZone) : <span className="text-subtle">Not yet</span>}</Field>
        <Field label="Expected return">{formatDateTime(expectedReturnDate, timeZone)}</Field>
        <Field label="Received by">{summary.completedByName ?? summary.startedByName ?? <span className="text-subtle">—</span>}</Field>
        <Field label="Case on return">{SUITCASE_STATUS_LABELS[summary.suitcaseStatus]}</Field>
        <Field label="Equipment back">
          {summary.returnedCount} of {summary.accountedCount} accounted for
        </Field>
        <Field label="Damaged">{summary.damagedCount > 0 ? `${summary.damagedCount} item${summary.damagedCount === 1 ? '' : 's'}` : <span className="text-subtle">None</span>}</Field>
        <Field label="Not returned">{summary.missingCount > 0 ? `${summary.missingCount} item${summary.missingCount === 1 ? '' : 's'}` : <span className="text-subtle">None</span>}</Field>
        <Field label="Return checks">{summary.checklistTotal === 0 ? <span className="text-subtle">No checks</span> : `${summary.checklistPassed} of ${summary.checklistTotal} passed`}</Field>
        {summary.signatures.map((signature) => (
          <Field key={signature.id} label={signature.type === 'RETURN_ENGINEER' ? 'Engineer signature' : 'Editor signature'}>
            {signature.signerName} <span className="text-xs text-muted">· {formatDateTime(signature.signedAt, timeZone)}</span>
          </Field>
        ))}
        <Field label="Started">{formatDateTime(summary.startedAt, timeZone)}</Field>
        <Field label="Document">{complete ? 'Frozen at completion' : 'Open'}</Field>
      </dl>

      {summary.generalNotes ? (
        <div className="border-t border-line px-5 py-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Return notes</p>
          <p className="mt-1 whitespace-pre-line text-foreground">{summary.generalNotes}</p>
        </div>
      ) : null}

      {summary.issues.length > 0 ? (
        <div className="border-t border-line px-5 py-3">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
            <TriangleAlert aria-hidden className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            Issues raised
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {summary.issues.map((issue) => (
              <li key={issue.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-accent-foreground">{issue.issueNumber}</span>
                {canReadIssues ? (
                  <Link href={`/issues/${issue.id}`} className="font-medium text-foreground hover:underline">
                    {issue.title}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{issue.title}</span>
                )}
                <Badge tone={SEVERITY_TONE[issue.severity] ?? 'neutral'}>{issue.severity.toLowerCase()}</Badge>
                <Badge tone="neutral">{issue.status.toLowerCase().replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
