import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { ChecklistForm } from '@/features/handover/components/checklist-form'
import { EquipmentForm } from '@/features/handover/components/equipment-form'
import { CompleteHandoverForm, StartHandoverForm } from '@/features/handover/components/handover-forms'
import { HandoverSummaryPanel } from '@/features/handover/components/handover-summary'
import { IdentityPanels } from '@/features/handover/components/identity-panels'
import { SignaturePad } from '@/features/handover/components/signature-pad'
import { StepCard, type StepState } from '@/features/handover/components/step-card'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import { prisma } from '@/server/db/prisma'
import { loadHandoverSummary, loadHandoverWorkspace } from '@/server/services/handover.service'

export const metadata: Metadata = { title: 'Handover' }

export const dynamic = 'force-dynamic'

/**
 * The handover workspace: identities first, then the numbered stages -
 * equipment, checklist and software, signatures, completion. Everything the
 * page shows about eligibility and readiness comes from the service; the
 * forms only post ids and answers.
 */
export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermissionForPage(['handover.perform', 'handover.complete'])
  const { id } = await params
  const workspace = await loadHandoverWorkspace(prisma, actor, id)
  if (!workspace) notFound()

  const { booking, inspection, bookingBlockers, verdict, canPerform, canComplete, completed } = workspace
  const timeZone = env.APP_TIMEZONE
  const summary = completed ? await loadHandoverSummary(prisma, id) : null

  const equipmentState: StepState | undefined = inspection
    ? verdict?.blockers.some((blocker) => blocker.code === 'equipment')
      ? 'blocked'
      : inspection.status !== 'IN_PROGRESS' || inspection.lines.some((line) => line.status !== 'INCLUDED' || line.notes)
        ? 'done'
        : 'todo'
    : undefined
  const checklistState: StepState | undefined = inspection
    ? verdict?.blockers.some((blocker) => blocker.code === 'checklist' || blocker.code === 'software')
      ? inspection.checklist.some((item) => item.result)
        ? 'blocked'
        : 'todo'
      : 'done'
    : undefined
  const signatureState: StepState | undefined = inspection ? (inspection.signatures.length === 2 ? 'done' : 'todo') : undefined

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Bookings / ${booking.bookingNumber} / Handover`}
        title={`Handover · ${booking.kit.kitCode}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-foreground">{booking.bookingNumber}</span>
            <BookingStatusBadge status={booking.status} />
            <span className="font-medium text-foreground">{booking.editor.fullName}</span>
            <Badge tone={booking.editor.isExternal ? 'neutral' : 'blue'}>{booking.editor.isExternal ? 'External' : 'Internal'}</Badge>
            <span className="text-subtle">·</span>
            <span>{booking.kit.name}</span>
          </span>
        }
        actions={
          <Link href={`/bookings/${booking.id}`} className={buttonVariants({ variant: 'secondary' })}>
            Back to booking
          </Link>
        }
      />

      <div className="space-y-6">
        <IdentityPanels booking={booking} timeZone={timeZone} canReadEditor={can(actor, 'editor.read')} canReadKit={can(actor, 'kit.read')} />

        {completed && summary ? (
          <>
            <Alert variant={booking.status === 'CHECKED_OUT' || booking.status === 'OVERDUE' ? 'info' : 'warning'} title={booking.status === 'READY_FOR_HANDOVER' ? 'Handover recorded' : `This booking is ${booking.status.toLowerCase().replace('_', ' ')}`}>
              {inspection?.status === 'COMPLETED'
                ? 'The handover has been completed and the document is frozen. Nothing here can be changed.'
                : 'Only a booking that is ready for handover can be handed over.'}
            </Alert>
            <HandoverSummaryPanel summary={summary} collectionDate={booking.collectionDate} timeZone={timeZone} />
          </>
        ) : null}

        {!completed && bookingBlockers.length > 0 ? (
          <Alert variant="warning" title="The handover cannot proceed">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {bookingBlockers.map((blocker, index) => (
                <li key={`${blocker.code}:${index}`}>{blocker.reason}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {!completed && !inspection ? (
          <StepCard step={1} id="start" title="Start the handover" description="Snapshots the kit's equipment, accessories, software list and the checklist as they stand right now. The template can change afterwards without touching this handover." state="todo">
            {canPerform && bookingBlockers.length === 0 ? (
              <StartHandoverForm bookingId={booking.id} />
            ) : (
              <p className="text-sm text-muted">{canPerform ? 'Resolve the points above first.' : 'You can view this booking but not perform its handover.'}</p>
            )}
          </StepCard>
        ) : null}

        {!completed && inspection ? (
          <>
            <StepCard step={1} id="equipment" title="Equipment" description={`${inspection.lines.length} ${inspection.lines.length === 1 ? 'item' : 'items'} snapshotted at ${inspection.startedByName ? `start by ${inspection.startedByName}` : 'start'}. Record the condition of each item and its accessories as they go into the case.`} state={equipmentState}>
              <EquipmentForm bookingId={booking.id} lines={inspection.lines} suitcaseStatus={inspection.suitcaseStatus} generalNotes={inspection.generalNotes} disabled={!canPerform} />
            </StepCard>

            <StepCard step={2} id="checklist" title="Checklist and software" description="Required checks must pass or be marked not applicable; required applications must be installed." state={checklistState}>
              <ChecklistForm bookingId={booking.id} checklist={inspection.checklist} software={inspection.software} templateName={null} disabled={!canPerform} />
            </StepCard>

            <StepCard step={3} id="signatures" title="Signatures" description="Both parties sign on this device. The editor signature is attributed to the editor named on the booking; the engineer signature to the signed-in engineer." state={signatureState}>
              <div className="grid gap-4 lg:grid-cols-2">
                <SignaturePad bookingId={booking.id} role="EDITOR" signerName={booking.editor.fullName} existing={inspection.signatures.find((signature) => signature.type === 'HANDOVER_EDITOR') ?? null} disabled={!canPerform} timeZone={timeZone} />
                <SignaturePad bookingId={booking.id} role="ENGINEER" signerName={actor.name} existing={inspection.signatures.find((signature) => signature.type === 'HANDOVER_ENGINEER') ?? null} disabled={!canPerform} timeZone={timeZone} />
              </div>
            </StepCard>

            <StepCard step={4} id="complete" title="Review and complete" description="The server re-checks the booking, the editor, the kit's readiness, every recorded answer and both signatures inside one transaction before anything changes." state={canComplete ? 'done' : 'blocked'}>
              {verdict && verdict.blockers.length > 0 ? (
                <Alert variant="warning" title={`${verdict.blockers.length} ${verdict.blockers.length === 1 ? 'point stands' : 'points stand'} in the way`} className="mb-4">
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {verdict.blockers.map((blocker, index) => (
                      <li key={`${blocker.code}:${index}`}>{blocker.reason}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {verdict && verdict.warnings.length > 0 ? (
                <Alert variant="info" title="Noted, not blocking" className="mb-4">
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {verdict.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {can(actor, 'handover.complete') ? (
                <CompleteHandoverForm bookingId={booking.id} bookingNumber={booking.bookingNumber} editorName={booking.editor.fullName} kitCode={booking.kit.kitCode} ready={canComplete} />
              ) : (
                <p className="text-sm text-muted">Completing the handover needs the handover.complete permission.</p>
              )}
            </StepCard>
          </>
        ) : null}
      </div>
    </>
  )
}
