import { Search } from 'lucide-react'
import Link from 'next/link'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EditorListParams } from '@/lib/validation/editors'
import { cn } from '@/lib/utils/cn'

/** Search as a GET form; an exact staff ID opens the editor directly. */
export function EditorsToolbar({ params, clearHref }: { params: EditorListParams; clearHref: string }) {
  return (
    <form method="get" action="/editors" role="search" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      {params.view !== 'all' ? <input type="hidden" name="view" value={params.view} /> : null}
      {params.sort !== 'fullName' ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {params.dir !== 'asc' ? <input type="hidden" name="dir" value={params.dir} /> : null}

      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search by name, staff ID, contact number or email…"
          aria-label="Search editors"
          autoComplete="off"
          className="pl-9"
        />
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
