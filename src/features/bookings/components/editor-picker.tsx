import { Check, Search, UserRound } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EditorChoice } from '@/server/services/bookings.service'

const TD = 'px-4 py-3 align-middle'

/**
 * Section 1 of the booking form: who receives the kit. A GET search over
 * active editors (name, staff ID, contact number); each result is either
 * selectable or explains why not. The selection lives in the URL.
 */
export function EditorPicker({
  base,
  hidden,
  term,
  results,
  selected,
  changeHref,
  selectHref,
  canChange = true,
}: {
  /** Form action path (the page itself). */
  base: string
  /** URL state to preserve while searching. */
  hidden: Record<string, string | undefined>
  term: string
  results: EditorChoice[]
  selected: EditorChoice | null
  changeHref: string
  selectHref: (editorId: string) => string
  canChange?: boolean
}) {
  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft font-mono text-xs text-accent-foreground">1</span>
            Editor
          </h2>
          <p className="mt-0.5 text-xs text-muted">Only active editors can be booked. Internal editors need a staff ID; external editors need neither a staff ID nor an account.</p>
        </div>
        {selected && canChange ? (
          <Link href={changeHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Change
          </Link>
        ) : null}
      </header>

      {selected ? (
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-foreground">
            <UserRound aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
              {selected.fullName}
              <Badge tone={selected.isExternal ? 'neutral' : 'blue'}>{selected.isExternal ? 'External' : 'Internal'}</Badge>
              {selected.staffId ? <span className="font-mono text-xs text-accent-foreground">{selected.staffId}</span> : <span className="text-xs text-muted">No staff ID</span>}
            </p>
            <p className="text-xs text-muted">
              {[selected.contactNumber, selected.isExternal ? selected.company : selected.department].filter(Boolean).join(' · ') || 'No contact details recorded'}
            </p>
            {selected.blocker ? <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{selected.blocker}</p> : null}
          </div>
          {!selected.blocker ? <Check aria-hidden className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : null}
        </div>
      ) : (
        <div className="px-5 py-4">
          <form method="get" action={base} role="search" className="flex flex-wrap items-center gap-2">
            {Object.entries(hidden).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
            <div className="relative min-w-[16rem] flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input type="search" name="eq" defaultValue={term} autoFocus autoComplete="off" placeholder="Search by name, staff ID or contact number…" aria-label="Search editors" className="pl-9" />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {term && results.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              No active editor matches <span className="font-mono text-foreground">{term}</span>.{' '}
              <Link href="/editors/new" className="text-accent-foreground hover:underline">
                Add the editor
              </Link>{' '}
              first, then come back.
            </p>
          ) : null}

          {results.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="min-w-full text-sm">
                <tbody>
                  {results.map((editor) => (
                    <tr key={editor.id} className="border-t border-line first:border-t-0 transition-colors hover:bg-panel-header">
                      <td className={TD}>
                        <p className="font-medium text-foreground">{editor.fullName}</p>
                        <p className="text-xs text-muted">{[editor.contactNumber, editor.isExternal ? editor.company : editor.department].filter(Boolean).join(' · ') || '—'}</p>
                      </td>
                      <td className={TD}>
                        <Badge tone={editor.isExternal ? 'neutral' : 'blue'}>{editor.isExternal ? 'External' : 'Internal'}</Badge>
                      </td>
                      <td className={`${TD} font-mono text-xs text-accent-foreground`}>{editor.staffId ?? <span className="text-subtle">—</span>}</td>
                      <td className={`${TD} text-right`}>
                        {editor.blocker ? (
                          <span className="text-xs text-muted">{editor.blocker}</span>
                        ) : (
                          <Link href={selectHref(editor.id)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                            Select
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
