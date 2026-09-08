import { Boxes, ChevronDown, Plus } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { AssetStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { KitDetail, KitMemberRow } from '@/server/dal/kits.dal'
import type { AssetCandidateRow, KitAvailability } from '@/server/services/kits.service'

import { kitHref } from '../hrefs'
import { AssetPicker } from './asset-picker'
import { AvailabilityNotice } from './availability-notice'
import { MemberEditForm, RemoveMemberForm } from './member-forms'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-top'

const Empty = () => <span className="text-subtle">—</span>

interface CategoryGroup {
  id: string
  name: string
  sortOrder: number
  members: KitMemberRow[]
}

function groupByCategory(members: KitMemberRow[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>()
  for (const member of members) {
    const group = groups.get(member.category.id) ?? { id: member.category.id, name: member.category.name, sortOrder: member.category.sortOrder, members: [] }
    group.members.push(member)
    groups.set(member.category.id, group)
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

function Accessories({ member }: { member: KitMemberRow }) {
  if (member.accessories.length === 0) return <span className="text-xs text-subtle">None</span>
  return (
    <details className="group text-xs">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-accent-foreground hover:underline [&::-webkit-details-marker]:hidden">
        {member.accessories.length} {member.accessories.length === 1 ? 'accessory' : 'accessories'}
        <ChevronDown aria-hidden className="h-3 w-3 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-1 border-l border-line pl-3">
        {member.accessories.map((accessory) => (
          <li key={accessory.id} className="flex flex-wrap items-center gap-x-2 text-foreground">
            <span>
              {accessory.label ?? accessory.typeName}
              {accessory.quantity > 1 ? <span className="text-muted"> ×{accessory.quantity}</span> : null}
            </span>
            {accessory.label ? <span className="text-subtle">{accessory.typeName}</span> : null}
            {!accessory.isRequired ? <span className="text-subtle">optional</span> : null}
            {accessory.status !== 'AVAILABLE' ? <AssetStatusBadge status={accessory.status} /> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * The Equipment tab: members grouped by category, each with its accessories
 * one click away; the picker to add more; inline slot editing; removal. The
 * `add`, `pick` and `member` query parameters drive which forms are open, so
 * the state survives a refresh and needs no client store.
 */
export function EquipmentPanel({
  kit,
  availability,
  canManage,
  membersBlocker,
  memberRemovalBlockers,
  editing,
  picker,
}: {
  kit: KitDetail
  availability: KitAvailability
  canManage: boolean
  /** Why nothing can be added right now; null when the picker may open. */
  membersBlocker: string | null
  /** Per-member removal blocker (kitAssetId -> reason). */
  memberRemovalBlockers: Record<string, string | null>
  /** kitAssetId being edited, from `?member=`. */
  editing: string | null
  /** Picker state: open with the current search term and results, or closed. */
  picker: { open: boolean; term: string; candidates: AssetCandidateRow[] } | null
}) {
  const flagged = new Map(availability.reasons.filter((reason) => reason.assetId).map((reason) => [reason.assetId as string, reason]))
  const groups = groupByCategory(kit.members)
  const baseHref = kitHref(kit.id, 'equipment')
  const editingMember = editing ? kit.members.find((member) => member.kitAssetId === editing) ?? null : null
  const pickerOpen = canManage && picker?.open && !membersBlocker

  return (
    <div className="space-y-4">
      <AvailabilityNotice availability={availability} />

      {canManage && editingMember ? (
        <MemberEditForm
          values={{
            kitAssetId: editingMember.kitAssetId,
            assetCode: editingMember.assetCode,
            assetName: editingMember.name,
            slotLabel: editingMember.slotLabel ?? '',
            isRequired: editingMember.isRequired,
          }}
          cancelHref={baseHref}
        />
      ) : null}

      {pickerOpen && picker ? <AssetPicker kitId={kit.id} term={picker.term} candidates={picker.candidates} closeHref={baseHref} /> : null}

      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
          <div>
            <h3 className="font-display text-[15px] font-semibold text-foreground">Equipment in this kit</h3>
            <p className="mt-0.5 text-xs text-muted">
              {kit.members.length} {kit.members.length === 1 ? 'item' : 'items'} · {availability.requiredCount} required. Required items must be available for the kit to be ready.
            </p>
          </div>
          {canManage ? (
            membersBlocker ? (
              <p className="max-w-sm text-xs text-muted" title={membersBlocker}>
                {membersBlocker}
              </p>
            ) : !pickerOpen ? (
              <Link href={kitHref(kit.id, 'equipment', { add: '1' })} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                <Plus aria-hidden className="h-4 w-4" />
                Add equipment
              </Link>
            ) : null
          ) : null}
        </header>

        {kit.members.length === 0 ? (
          <EmptyState
            compact
            icon={Boxes}
            title="No equipment in this kit"
            description={canManage ? 'Scan a barcode or search the inventory to add the first item.' : 'Equipment will be listed here once it has been added.'}
            action={canManage && !membersBlocker ? { href: kitHref(kit.id, 'equipment', { add: '1' }), label: 'Add equipment' } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={TH}>Asset code</th>
                  <th scope="col" className={TH}>Equipment</th>
                  <th scope="col" className={TH}>Slot</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>Serial number</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>ADM barcode</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>Accessories</th>
                  {canManage ? <th scope="col" className={`${TH} text-right`}>Actions</th> : null}
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.id}>
                  <tr className="border-t border-line bg-panel-header/60">
                    <th scope="rowgroup" colSpan={canManage ? 8 : 7} className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-foreground">
                      {group.name}
                      <span className="ml-2 font-normal tracking-normal text-subtle">{group.members.length}</span>
                    </th>
                  </tr>
                  {group.members.map((member) => {
                    const reason = flagged.get(member.assetId)
                    return (
                      <tr key={member.kitAssetId} className={reason ? 'border-t border-line bg-amber-50/40 dark:bg-amber-400/5' : 'border-t border-line transition-colors hover:bg-panel-header'}>
                        <td className={TD}>
                          <Link href={`/assets/${member.assetId}`} className="font-mono text-xs font-semibold text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                            {member.assetCode}
                          </Link>
                          <p className="mt-1">{member.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</p>
                        </td>
                        <td className={`${TD} max-w-[18rem]`}>
                          <Link href={`/assets/${member.assetId}`} className="block truncate font-medium text-foreground hover:underline">
                            {member.name}
                          </Link>
                          <p className="truncate text-xs text-muted">{[member.manufacturer, member.model].filter(Boolean).join(' ') || '—'}</p>
                        </td>
                        <td className={`${TD} text-foreground`}>{member.slotLabel ?? <Empty />}</td>
                        <td className={`${TD} hidden font-mono text-xs text-foreground lg:table-cell`}>{member.serialNumber ?? <Empty />}</td>
                        <td className={`${TD} hidden font-mono text-xs text-foreground lg:table-cell`}>{member.admBarcode ?? <Empty />}</td>
                        <td className={TD}>
                          <span className="flex flex-col items-start gap-1">
                            <AssetStatusBadge status={member.status} />
                            {member.activeMaintenanceCount > 0 ? <Badge tone="amber">Maintenance active</Badge> : null}
                            {reason ? <span className="text-xs text-amber-800 dark:text-amber-300">{reason.reason.replace(`${member.assetCode} `, '')}</span> : null}
                          </span>
                        </td>
                        <td className={`${TD} hidden md:table-cell`}>
                          <Accessories member={member} />
                        </td>
                        {canManage ? (
                          <td className={`${TD} text-right`}>
                            <div className="flex items-center justify-end gap-1">
                              <Link href={kitHref(kit.id, 'equipment', { member: member.kitAssetId })} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                                Edit
                              </Link>
                              <RemoveMemberForm kitAssetId={member.kitAssetId} assetCode={member.assetCode} blocker={memberRemovalBlockers[member.kitAssetId] ?? null} />
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
