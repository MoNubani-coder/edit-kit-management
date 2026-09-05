import { ScanBarcode, Search } from 'lucide-react'
import Link from 'next/link'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { KitListParams } from '@/lib/validation/kits'
import { cn } from '@/lib/utils/cn'

/**
 * Search as a GET form so every state has a URL. The box accepts a scan: an
 * exact kit barcode opens the kit; equipment codes, barcodes and serial
 * numbers find the kit that contains them.
 */
export function KitsToolbar({ params, clearHref }: { params: KitListParams; clearHref: string }) {
  return (
    <form method="get" action="/kits" role="search" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      {params.view !== 'all' ? <input type="hidden" name="view" value={params.view} /> : null}
      {params.sort !== 'kitCode' ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {params.dir !== 'asc' ? <input type="hidden" name="dir" value={params.dir} /> : null}

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search kit code, kit name, kit barcode, or the code / barcode / serial of equipment inside a kit…"
          aria-label="Search kits"
          autoComplete="off"
          className="pl-9 pr-9"
        />
        <span title="Scan a kit barcode to open it directly" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle">
          <ScanBarcode aria-hidden className="h-4 w-4" />
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {params.q ? (
          <Link href={clearHref} className={cn(buttonVariants({ variant: 'ghost' }), 'whitespace-nowrap')}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  )
}
