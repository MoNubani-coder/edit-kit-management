import { Printer, QrCode } from 'lucide-react'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import type { KitQrCode } from '@/server/services/qr.service'

/**
 * The kit's QR code, for sticking on the case.
 *
 * The code carries one thing: the URL that opens this kit. Anyone can read a
 * label on a flight case, so it says nothing about the editor, the booking or
 * the contents, and following it still needs a login. The URL is printed
 * underneath so it can be typed if a camera will not focus.
 */
export function KitQrPanel({ kit, qr }: { kit: { id: string; kitCode: string; name: string }; qr: KitQrCode }) {
  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <QrCode aria-hidden className="h-4 w-4 text-accent-foreground" />
          Case label
        </h2>
        <Link href={`/kits/${kit.id}/label`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          <Printer aria-hidden className="h-4 w-4" />
          Printable label
        </Link>
      </header>
      <div className="flex flex-wrap items-center gap-5 px-5 py-4">
        <div
          className="shrink-0 rounded-lg border border-line bg-white p-2 [&>svg]:h-32 [&>svg]:w-32"
          role="img"
          aria-label={`QR code that opens kit ${kit.kitCode}`}
          dangerouslySetInnerHTML={{ __html: qr.svg }}
        />
        <div className="min-w-0 text-sm">
          <p className="text-foreground">
            Scan with any phone camera to open this kit. Signing in is still required, so a lost case tells a stranger nothing.
          </p>
          <p className="mt-2 break-all font-mono text-xs text-muted">{qr.url}</p>
        </div>
      </div>
    </section>
  )
}
