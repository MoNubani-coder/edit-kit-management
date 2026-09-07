import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { IdentityPanels } from '@/features/handover/components/identity-panels'
import { SignaturePad } from '@/features/handover/components/signature-pad'
import { StepCard, type StepState } from '@/features/handover/components/step-card'
import { PhotoEvidence } from '@/features/photos/components/photo-evidence'
import { EquipmentReturnForm } from '@/features/return/components/equipment-return-form'
import { HandoverRecap } from '@/features/return/components/handover-recap'
import { ReturnChecklistForm } from '@/features/return/components/return-checklist-form'
import { CompleteReturnForm, StartReturnForm } from '@/features/return/components/return-forms'
import { ReturnSummaryPanel } from '@/features/return/components/return-summary'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import { captureReturnSignatureFormAction } from '@/server/actions/return.actions'
import { prisma } from '@/server/db/prisma'
import { uploadReturnPhotoAction } from '@/server/actions/photos.actions'
import { loadInspectionPhotos } from '@/server/services/photos.service'
import { loadReturnSummary, loadReturnWorkspace } from '@/server/services/return.service'

export const metadata: Metadata = { title: 'Return inspection' }

export const dynamic = 'force-dynamic'

/**
 * The return workspace: identities, then what went out, then the numbered
 * stages - equipment back, return checks, the engineer's signature, and
 * completion. Everything about eligibility comes from the service; the forms
 * post ids and answers only.
 */
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermissionForPage(['return.perform', 'return.complete'])
  const { id } = await params
  const workspace = await loadReturnWorkspace(prisma, actor, id)
  if (!workspace) notFound()

  const { booking, handover, inspection, bookingBlockers, verdict, canPerform, canComplete, completed } = workspace
  const timeZone = env.APP_TIMEZONE
  const summary = completed || inspection ? await loadReturnSummary(prisma, id) : null
  const photos = inspection ? await loadInspectionPhotos(prisma, inspection.id) : []

  const problemCount = inspection
    ? inspection.lines.filter((line) => line.status === 'MISSING' || line.status === 'DAMAGED').length +
      inspection.lines.flatMap((line) => line.accessories).filter((accessory) => accessory.status === 'MISSING' || accessory.status === 'DAMAGED').length
    : 0

  const equipmentState: StepState | undefined = inspection
    ? verdict?.blockers.some((blocker) => blocker.code === 'equipment')
      ? inspection.lines.some((line) => line.status !== 'NOT_APPLICABLE')
        ? 'blocked'
        : 'todo'
      : 'done'
    : undefined
  const checklistState: StepState | undefined = inspection
    ? verdict?.blockers.some((blocker) => blocker.code === 'checklist')
      ? inspection.checklist.some((item) => item.result)
        ? 'blocked'
        : 'todo'
      : 'done'
    : undefined
  const signatureState: StepState | undefined = inspection
    ? inspection.signatures.some((signature) => signature.type === 'RETURN_ENGINEER')
      ? 'done'
      : 'todo'
    : undefined

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Bookings / ${booking.bookingNumber} / Return`}
        title={`Return · ${booking.kit.kitCode}`}
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
            <Alert variant="info" title="Return recorded">
              The return has been completed and the document is frozen. Nothing here can be changed.
            </Alert>
            <ReturnSummaryPanel
              summary={summary}
              expectedReturnDate={booking.expectedReturnDate}
              actualReturnDate={booking.actualReturnDate}
              timeZone={timeZone}
              canReadIssues={can(actor, 'issue.read')}
            />
          </>
        ) : null}

        {!completed && bookingBlockers.length > 0 ? (
          <Alert variant="warning" title="The return cannot proceed">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {bookingBlockers.map((blocker, index) => (
                <li key={`${blocker.code}:${index}`}>{blocker.reason}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {handover && !completed ? <HandoverRecap handover={handover} timeZone={timeZone} collectionDate={booking.collectionDate} /> : null}

        {!completed && !inspection ? (
          <StepCard
            step={1}
            id="start"
            title="Start the return inspection"
            description="Copies the handover document into a return document: every item that actually went out, with its accessories, waiting to be accounted for. The booking moves to return inspection."
            state="todo"
          >
            {canPerform && bookingBlockers.length === 0 ? (
              <StartReturnForm bookingId={booking.id} />
            ) : (
              <p className="text-sm text-muted">{canPerform ? 'Resolve the points above first.' : 'You can view this booking but not perform its return.'}</p>
            )}
          </StepCard>
        ) : null}

        {!completed && inspection ? (
          <>
            <StepCard
              step={1}
              id="equipment"
              title="Equipment back"
              description={`${inspection.lines.filter((line) => line.wasHandedOver).length} handed-over ${
                inspection.lines.filter((line) => line.wasHandedOver).length === 1 ? 'item' : 'items'
              } to account for. Every one needs an answer before the booking can close.`}
              state={equipmentState}
            >
              <EquipmentReturnForm bookingId={booking.id} lines={inspection.lines} suitcaseStatus={inspection.suitcaseStatus} generalNotes={inspection.generalNotes} disabled={!canPerform} />
              <div className="mt-5">
                <PhotoEvidence
                  bookingId={booking.id}
                  photos={photos}
                  action={uploadReturnPhotoAction}
                  disabled={!canPerform}
                  timeZone={timeZone}
                  label="Photo evidence"
                  hint="Optional, and worth it for damage or a missing item: photograph what you found. The handover's own photos are untouched by anything recorded here."
                />
              </div>
            </StepCard>

            <StepCard step={2} id="checklist" title="Return checks" description="The booking's own return-phase checks, as they stood when the handover was taken." state={checklistState}>
              <ReturnChecklistForm bookingId={booking.id} checklist={inspection.checklist} disabled={!canPerform} />
            </StepCard>

            <StepCard
              step={3}
              id="signature"
              title="Confirmation"
              description="The engineer receiving the kit signs on this device. The editor may sign too, but a kit dropped off without them can still be received."
              state={signatureState}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <SignaturePad
                  bookingId={booking.id}
                  role="ENGINEER"
                  signerName={actor.name}
                  existing={inspection.signatures.find((signature) => signature.type === 'RETURN_ENGINEER') ?? null}
                  disabled={!canPerform}
                  timeZone={timeZone}
                  action={captureReturnSignatureFormAction}
                  title="Engineer receiving the kit"
                  caption=" · the signed-in engineer"
                />
                <SignaturePad
                  bookingId={booking.id}
                  role="EDITOR"
                  signerName={booking.editor.fullName}
                  existing={inspection.signatures.find((signature) => signature.type === 'RETURN_EDITOR') ?? null}
                  disabled={!canPerform}
                  timeZone={timeZone}
                  action={captureReturnSignatureFormAction}
                  title="Editor returning the kit"
                  caption=" · the editor named on the booking"
                  optional
                />
              </div>
            </StepCard>

            <StepCard
              step={4}
              id="complete"
              title="Review and complete"
              description="The server re-checks the booking, the handover it is measured against, every answer and the engineer's signature inside one transaction before anything changes."
              state={canComplete ? 'done' : 'blocked'}
            >
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
                <Alert variant="info" title="Recorded, not blocking" className="mb-4">
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {verdict.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {can(actor, 'return.complete') ? (
                <CompleteReturnForm bookingId={booking.id} bookingNumber={booking.bookingNumber} kitCode={booking.kit.kitCode} problemCount={problemCount} ready={canComplete} />
              ) : (
                <p className="text-sm text-muted">Completing the return needs the return.complete permission.</p>
              )}
            </StepCard>
          </>
        ) : null}
      </div>
    </>
  )
}
