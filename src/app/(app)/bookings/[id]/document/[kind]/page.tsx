import { FileDown } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'

import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { DocumentSheet } from '@/features/documents/components/document-sheet'
import { PrintButton } from '@/features/kits/components/print-button'
import { env } from '@/lib/env'
import { requireAuthForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import type { DocumentKind } from '@/server/documents/snapshot'
import { documentTitle, loadDocument } from '@/server/services/documents.service'

export const metadata: Metadata = { title: 'Document' }

export const dynamic = 'force-dynamic'

const KINDS = new Set<DocumentKind>(['handover', 'return'])

/**
 * The signed document on screen: the record as it was frozen, ready to print
 * or to download as a PDF.
 *
 * Authorised against the booking rather than the reports area, so an internal
 * editor can open their own signed record while never seeing anyone else's.
 * The application chrome is hidden when printing, leaving the sheet.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const actor = await requireAuthForPage()
  const { id, kind } = await params
  if (!KINDS.has(kind as DocumentKind)) notFound()

  const access = await loadDocument(prisma, actor, id, kind as DocumentKind)
  if (access.status === 'not-found') notFound()
  if (access.status === 'forbidden') forbidden()

  const title = documentTitle(kind as DocumentKind)

  if (access.status === 'not-ready') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Alert variant="info" title={`No ${kind} document yet`}>
          {kind === 'handover' ? 'This booking has no completed handover, so there is nothing signed to print.' : 'This booking has no completed return, so there is nothing signed to print.'}
        </Alert>
        <Link href={`/bookings/${id}`} className={buttonVariants({ variant: 'secondary' })}>
          Back to booking
        </Link>
      </div>
    )
  }

  // Signature ids only, so the images come from the authorised file route.
  const signatures = await prisma.signature.findMany({
    where: { inspectionId: access.inspectionId, voidedAt: null },
    select: { id: true, type: true },
    orderBy: [{ signedAt: 'asc' }],
  })

  return (
    <div className="space-y-5">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-foreground">{title}</p>
          <h1 className="mt-1 font-display text-xl font-semibold text-foreground">{access.document.bookingNumber ?? 'Document'}</h1>
          <p className="mt-1 text-sm text-muted">Frozen when the {kind} was completed. Renaming the kit or changing a serial number afterwards cannot alter it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton />
          <Link href={`/api/documents/${kind}/${id}`} prefetch={false} className={buttonVariants({ variant: 'secondary' })}>
            <FileDown aria-hidden className="h-4 w-4" />
            Download PDF
          </Link>
          <Link href={`/bookings/${id}`} className={buttonVariants({ variant: 'ghost' })}>
            Back to booking
          </Link>
        </div>
      </div>

      <DocumentSheet document={access.document} title={title} organisation={env.APP_ORG_NAME} timeZone={env.APP_TIMEZONE} signatureIds={signatures} />
    </div>
  )
}
