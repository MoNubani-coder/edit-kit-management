import { ScanBarcode, Search, X } from 'lucide-react'
import Link from 'next/link'

import { AssetStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AssetCandidateRow } from '@/server/services/kits.service'

import { AddMemberForm } from './member-forms'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

/**
 * "Add equipment": a GET search (so a keyboard barcode scanner's Enter submits
 * it), results with a verdict per row - add it, or the reason it cannot join.
 * An exact barcode or code match is marked as a scan and placed first.
 */
export function AssetPicker({ kitId, term, candidates, closeHref }: { kitId: string; term: string; candidates: AssetCandidateRow[]; closeHref: string }) {
  const searched = term.trim().length > 0
  const eligible = candidates.filter((candidate) => !candidate.blocker).length

  return (
    <section className="theme-transition rounded-panel border border-accent/40 bg-panel">
      <header className="flex items-start justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
        <div>
          <h3 className="font-display text-[15px] font-semibold text-foreground">Add equipment</h3>
          <p className="mt-0.5 text-xs text-muted">Scan an ADM barcode, or search by asset code, serial number, manufacturer or model. Only available equipment that is not in another kit can be added.</p>
        </div>
        <Link href={closeHref} aria-label="Close" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <X aria-hidden className="h-4 w-4" />
        </Link>
      </header>

      <form method="get" action={`/kits/${kitId}`} role="search" className="flex flex-wrap items-center gap-2 px-5 py-4">
        <input type="hidden" name="tab" value="equipment" />
        <input type="hidden" name="add" value="1" />
        <div className="relative min-w-[16rem] flex-1">
          <ScanBarcode aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input type="search" name="pick" defaultValue={term} autoFocus autoComplete="off" placeholder="Scan barcode or type to search…" aria-label="Search equipment to add" className="pl-9" />
        </div>
        <Button type="submit" variant="secondary">
          <Search aria-hidden className="h-4 w-4" />
          Search
        </Button>
      </form>

      {!searched ? null : candidates.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-sm text-muted">
          No equipment matches <span className="font-mono text-foreground">{term}</span>. Check the barcode, or{' '}
          <Link href="/assets/new" className="text-accent-foreground hover:underline">
            add it to the inventory
          </Link>{' '}
          first.
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <p className="px-5 pt-3 text-xs text-muted">
            {candidates.length} {candidates.length === 1 ? 'match' : 'matches'} · {eligible} can be added
          </p>
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>Asset code</th>
                <th scope="col" className={TH}>Equipment</th>
                <th scope="col" className={`${TH} hidden lg:table-cell`}>Serial · barcode</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={`${TH} text-right`}>Add to kit</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id} className={candidate.scanned ? 'border-t border-line bg-accent-soft/60' : 'border-t border-line transition-colors hover:bg-panel-header'}>
                  <td className={TD}>
                    <Link href={`/assets/${candidate.id}`} className="font-mono text-xs font-semibold text-accent-foreground hover:underline">
                      {candidate.assetCode}
                    </Link>
                    {candidate.scanned ? (
                      <Badge tone="blue" className="ml-2">
                        Scanned
                      </Badge>
                    ) : null}
                  </td>
                  <td className={`${TD} max-w-[18rem]`}>
                    <p className="truncate font-medium text-foreground">{candidate.name}</p>
                    <p className="truncate text-xs text-muted">
                      {candidate.categoryName}
                      {candidate.manufacturer || candidate.model ? ` · ${[candidate.manufacturer, candidate.model].filter(Boolean).join(' ')}` : ''}
                    </p>
                  </td>
                  <td className={`${TD} hidden font-mono text-xs text-foreground lg:table-cell`}>
                    {candidate.serialNumber ?? '—'}
                    <span className="block text-subtle">{candidate.admBarcode ?? '—'}</span>
                  </td>
                  <td className={TD}>
                    <span className="flex flex-col items-start gap-1">
                      <AssetStatusBadge status={candidate.status} />
                      {candidate.currentKit ? <span className="text-xs text-muted">In {candidate.currentKit.kitCode}</span> : null}
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    {candidate.blocker ? (
                      <p className="max-w-xs text-xs text-muted sm:ml-auto">{candidate.blocker}</p>
                    ) : (
                      <AddMemberForm kitId={kitId} assetId={candidate.id} assetCode={candidate.assetCode} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
