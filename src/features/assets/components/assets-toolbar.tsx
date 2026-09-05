import { ScanBarcode, Search } from 'lucide-react'
import Link from 'next/link'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { AssetListParams } from '@/lib/validation/assets'
import { cn } from '@/lib/utils/cn'

/**
 * Search and filters as a GET form, so every state has a URL that can be
 * bookmarked, shared or scanned into. The search box accepts a barcode scan:
 * an exact ADM barcode opens the equipment directly.
 */
export function AssetsToolbar({
  params,
  categories,
  clearHref,
}: {
  params: AssetListParams
  categories: ReadonlyArray<{ id: string; name: string }>
  clearHref: string
}) {
  const filtered = Boolean(params.q || params.category || params.assignment !== 'all')

  return (
    <form method="get" action="/assets" role="search" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] md:items-center">
      {params.view !== 'all' ? <input type="hidden" name="view" value={params.view} /> : null}
      {params.sort !== 'assetCode' ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {params.dir !== 'asc' ? <input type="hidden" name="dir" value={params.dir} /> : null}

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search asset code, barcode, serial, manufacturer or model…"
          aria-label="Search equipment"
          autoComplete="off"
          className="pl-9 pr-9"
        />
        <span
          title="Scan or type an ADM barcode to open the equipment directly"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle"
        >
          <ScanBarcode aria-hidden className="h-4 w-4" />
        </span>
      </div>

      <Select name="category" defaultValue={params.category ?? ''} aria-label="Filter by category">
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>

      <Select name="assignment" defaultValue={params.assignment} aria-label="Filter by kit assignment">
        <option value="all">Any assignment</option>
        <option value="in-kit">In a kit</option>
        <option value="unassigned">Not in a kit</option>
      </Select>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {filtered ? (
          <Link href={clearHref} className={cn(buttonVariants({ variant: 'ghost' }), 'whitespace-nowrap')}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  )
}
