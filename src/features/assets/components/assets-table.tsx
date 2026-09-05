import { ArrowDown, ArrowUp, ArrowUpDown, PackageSearch } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { AssetStatusBadge } from '@/components/common/status-badge'
import { formatDateTime } from '@/lib/datetime'
import type { AssetListParams, AssetSortKey } from '@/lib/validation/assets'
import { cn } from '@/lib/utils/cn'
import type { AssetListResult } from '@/server/dal/assets.dal'

import { assetsHref } from '../hrefs'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

function SortHeader({
  label,
  sortKey,
  params,
  className,
}: {
  label: string
  sortKey: AssetSortKey
  params: AssetListParams
  className?: string
}) {
  const active = params.sort === sortKey
  const nextDir = active && params.dir === 'asc' ? 'desc' : 'asc'
  const Icon = active ? (params.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <th scope="col" className={cn(TH, className)} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={assetsHref(params, { sort: sortKey, dir: nextDir })}
        className={cn(
          'inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active && 'text-accent-foreground',
        )}
      >
        {label}
        <Icon aria-hidden className="h-3 w-3" />
      </Link>
    </th>
  )
}

export function AssetsTable({
  result,
  params,
  timeZone,
  canManage,
}: {
  result: AssetListResult
  params: AssetListParams
  timeZone: string
  canManage: boolean
}) {
  const filtered = Boolean(params.q || params.category || params.assignment !== 'all' || params.view !== 'all')

  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      {result.rows.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={filtered ? 'No equipment matches' : 'No equipment recorded yet'}
          description={
            filtered
              ? 'Try another search term or clear the filters.'
              : canManage
                ? 'Add the first piece of equipment to start the inventory.'
                : 'Equipment will appear here once it has been recorded.'
          }
          action={filtered ? { href: '/assets', label: 'Clear filters' } : canManage ? { href: '/assets/new', label: 'Add equipment' } : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <SortHeader label="Asset code" sortKey="assetCode" params={params} />
                <SortHeader label="Equipment" sortKey="name" params={params} />
                <SortHeader label="Category" sortKey="category" params={params} />
                <SortHeader label="Manufacturer" sortKey="manufacturer" params={params} className="hidden lg:table-cell" />
                <SortHeader label="Model" sortKey="model" params={params} className="hidden lg:table-cell" />
                <th scope="col" className={cn(TH, 'hidden xl:table-cell')}>Serial number</th>
                <th scope="col" className={cn(TH, 'hidden xl:table-cell')}>ADM barcode</th>
                <th scope="col" className={TH}>Current kit</th>
                <SortHeader label="Status" sortKey="status" params={params} />
                <SortHeader label="Last updated" sortKey="updatedAt" params={params} className="hidden md:table-cell" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                  <td className={TD}>
                    <Link
                      href={`/assets/${row.id}`}
                      className="font-mono text-xs font-semibold text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {row.assetCode}
                    </Link>
                  </td>
                  <td className={`${TD} max-w-[16rem]`}>
                    <Link href={`/assets/${row.id}`} className="block truncate font-medium text-foreground hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className={`${TD} text-foreground`}>{row.category.name}</td>
                  <td className={`${TD} hidden text-foreground lg:table-cell`}>{row.manufacturer ?? <span className="text-subtle">—</span>}</td>
                  <td className={`${TD} hidden text-foreground lg:table-cell`}>{row.model ?? <span className="text-subtle">—</span>}</td>
                  <td className={`${TD} hidden font-mono text-xs text-foreground xl:table-cell`}>{row.serialNumber ?? <span className="text-subtle">—</span>}</td>
                  <td className={`${TD} hidden font-mono text-xs text-foreground xl:table-cell`}>{row.admBarcode ?? <span className="text-subtle">—</span>}</td>
                  <td className={`${TD} text-foreground`}>
                    {row.currentKit ? (
                      <span>
                        <span className="font-medium">{row.currentKit.kitCode}</span>
                        <span className="hidden text-muted 2xl:inline"> · {row.currentKit.name}</span>
                      </span>
                    ) : (
                      <span className="text-subtle">Unassigned</span>
                    )}
                  </td>
                  <td className={TD}>
                    <AssetStatusBadge status={row.status} />
                  </td>
                  <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted md:table-cell`}>{formatDateTime(row.updatedAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        hrefFor={(page) => assetsHref(params, { page })}
      />
    </div>
  )
}
