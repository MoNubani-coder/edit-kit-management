import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { buttonVariants } from '@/components/ui/button'
import { PrintButton } from '@/features/kits/components/print-button'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { getKitDetail } from '@/server/dal/kits.dal'
import { prisma } from '@/server/db/prisma'
import { kitQrCode } from '@/server/services/qr.service'

export const metadata: Metadata = { title: 'Kit label' }

export const dynamic = 'force-dynamic'

/**
 * The printable case label: the QR, the kit code, the name and the barcode.
 *
 * Deliberately not a label designer. One card, sized for a sticker, with the
 * application chrome hidden when printing so what comes out of the printer is
 * the card and nothing else.
 */
export default async function KitLabelPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionForPage('kit.read')
  const { id } = await params

  const kit = await getKitDetail(prisma, id, { includeIssues: false })
  if (!kit || kit.deletedAt) notFound()

  const qr = await kitQrCode(kit.id, { scale: 480 })

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-foreground">Case label</p>
          <h1 className="mt-1 font-display text-xl font-semibold text-foreground">{kit.kitCode}</h1>
          <p className="mt-1 text-sm text-muted">Print, cut and fix to the case. The code opens this kit for anyone signed in.</p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link href={`/kits/${kit.id}`} className={buttonVariants({ variant: 'secondary' })}>
            Back to kit
          </Link>
        </div>
      </div>

      {/* The label itself: white ground and dark ink whatever the theme, because
          it is going to paper. */}
      <div className="mx-auto w-full max-w-md rounded-xl border-2 border-slate-900 bg-white p-6 text-slate-900 print:max-w-none print:rounded-none print:border">
        <div className="flex items-center gap-5">
          <div className="shrink-0 [&>svg]:h-40 [&>svg]:w-40" role="img" aria-label={`QR code that opens kit ${kit.kitCode}`} dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <div className="min-w-0">
            <p className="font-mono text-2xl font-bold leading-none">{kit.kitCode}</p>
            <p className="mt-2 text-base font-semibold leading-tight">{kit.name}</p>
            {kit.admBarcode ? <p className="mt-2 font-mono text-xs text-slate-600">ADM {kit.admBarcode}</p> : null}
            <p className="mt-3 text-[11px] leading-snug text-slate-600">Scan to open this kit in the Edit Kit Management System. Sign-in required.</p>
          </div>
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-md break-all text-center font-mono text-[11px] text-muted print:hidden">{qr.url}</p>
    </div>
  )
}
