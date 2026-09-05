import { Cable, Plus } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { AssetStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { AssetAccessoryRow } from '@/server/dal/assets.dal'

import { AccessoryForm, type AccessoryFormValues } from './accessory-form'
import { RemoveAccessoryForm } from './action-forms'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

/**
 * Accessories that travel with the equipment. `editing` is `'new'` or an
 * accessory id taken from the URL, so the form state survives a refresh and
 * needs no client-side mode switching.
 */
export function AccessoriesPanel({
  assetId,
  accessories,
  accessoryTypes,
  canManage,
  editing,
  baseHref,
}: {
  assetId: string
  accessories: AssetAccessoryRow[]
  accessoryTypes: ReadonlyArray<{ id: string; name: string }>
  canManage: boolean
  editing: string | null
  baseHref: string
}) {
  const editingRow = editing && editing !== 'new' ? accessories.find((row) => row.id === editing) ?? null : null
  const formValues: AccessoryFormValues | null =
    editing === 'new'
      ? { accessoryTypeId: '', label: '', quantity: 1, serialNumber: '', admBarcode: '', isRequired: true, notes: '' }
      : editingRow
        ? {
            accessoryId: editingRow.id,
            accessoryTypeId: editingRow.accessoryType.id,
            label: editingRow.label ?? '',
            quantity: editingRow.quantity,
            serialNumber: editingRow.serialNumber ?? '',
            admBarcode: editingRow.admBarcode ?? '',
            isRequired: editingRow.isRequired,
            notes: editingRow.notes ?? '',
          }
        : null

  return (
    <div className="space-y-4">
      {canManage && formValues ? (
        <AccessoryForm assetId={assetId} values={formValues} accessoryTypes={accessoryTypes} cancelHref={baseHref} />
      ) : null}

      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
          <div>
            <h3 className="font-display text-[15px] font-semibold text-foreground">Accessories</h3>
            <p className="mt-0.5 text-xs text-muted">Recorded against the equipment and checked at every handover and return.</p>
          </div>
          {canManage && editing !== 'new' ? (
            <Link href={`${baseHref}&accessory=new`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <Plus aria-hidden className="h-4 w-4" />
              Add accessory
            </Link>
          ) : null}
        </header>

        {accessories.length === 0 ? (
          <EmptyState
            compact
            icon={Cable}
            title="No accessories recorded"
            description="Power adapters, cables and pouches that travel with this equipment go here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={TH}>Type</th>
                  <th scope="col" className={TH}>Label</th>
                  <th scope="col" className={TH}>Qty</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>Serial</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>ADM barcode</th>
                  <th scope="col" className={TH}>Required</th>
                  <th scope="col" className={TH}>Status</th>
                  {canManage ? <th scope="col" className={`${TH} text-right`}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {accessories.map((row) => (
                  <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                    <td className={`${TD} font-medium text-foreground`}>{row.accessoryType.name}</td>
                    <td className={`${TD} text-foreground`}>{row.label ?? <span className="text-subtle">—</span>}</td>
                    <td className={`${TD} tabular-nums text-foreground`}>{row.quantity}</td>
                    <td className={`${TD} hidden font-mono text-xs text-foreground lg:table-cell`}>{row.serialNumber ?? <span className="text-subtle">—</span>}</td>
                    <td className={`${TD} hidden font-mono text-xs text-foreground lg:table-cell`}>{row.admBarcode ?? <span className="text-subtle">—</span>}</td>
                    <td className={TD}>{row.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</td>
                    <td className={TD}>
                      <AssetStatusBadge status={row.status} />
                    </td>
                    {canManage ? (
                      <td className={`${TD} text-right`}>
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`${baseHref}&accessory=${row.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                            Edit
                          </Link>
                          <RemoveAccessoryForm accessoryId={row.id} label={row.label ? `${row.accessoryType.name} (${row.label})` : row.accessoryType.name} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
