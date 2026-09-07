import { ClipboardCheck } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import type { HandoverSummary } from '@/server/dal/handover.dal'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  )
}

/** What happened at the handover, as the booking page and the handover page show it afterwards. */
export function HandoverSummaryPanel({ summary, collectionDate, timeZone }: { summary: HandoverSummary; collectionDate: Date | null; timeZone: string }) {
  const editor = summary.signatures.find((signature) => signature.type === 'HANDOVER_EDITOR')
  const engineer = summary.signatures.find((signature) => signature.type === 'HANDOVER_ENGINEER')
  const complete = summary.status === 'COMPLETED'

  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <ClipboardCheck aria-hidden className="h-4 w-4 text-accent-foreground" />
          Handover
        </h2>
        <Badge tone={complete ? 'green' : 'amber'} dot>
          {complete ? 'Completed' : 'In progress'}
        </Badge>
      </header>
      <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Collected">{complete && collectionDate ? formatDateTime(collectionDate, timeZone) : <span className="text-subtle">Not yet</span>}</Field>
        <Field label="Handed over by">{summary.completedByName ?? <span className="text-subtle">—</span>}</Field>
        <Field label="Equipment">
          {summary.includedCount} of {summary.lineCount} {summary.lineCount === 1 ? 'item' : 'items'} handed over
        </Field>
        <Field label="Checklist">
          {summary.checklistTotal === 0 ? <span className="text-subtle">No checks</span> : `${summary.checklistPassed} of ${summary.checklistTotal} passed`}
        </Field>
        <Field label="Editor signature">
          {editor ? (
            <>
              {editor.signerName} <span className="text-xs text-muted">· {formatDateTime(editor.signedAt, timeZone)}</span>
            </>
          ) : (
            <span className="text-subtle">Not signed</span>
          )}
        </Field>
        <Field label="Engineer signature">
          {engineer ? (
            <>
              {engineer.signerName} <span className="text-xs text-muted">· {formatDateTime(engineer.signedAt, timeZone)}</span>
            </>
          ) : (
            <span className="text-subtle">Not signed</span>
          )}
        </Field>
        <Field label="Started">{formatDateTime(summary.startedAt, timeZone)}</Field>
        <Field label="Document">{complete ? 'Frozen at completion; signatures on file' : 'Open'}</Field>
      </dl>
    </section>
  )
}
