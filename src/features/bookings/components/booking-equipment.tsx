import { Boxes } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { AssetStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { AvailabilityNotice } from '@/features/kits/components/availability-notice'
import type { KitDetail, KitMemberRow } from '@/server/dal/kits.dal'
import type { KitAvailability } from '@/server/services/kits.service'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-top'

function groupByCategory(members: KitMemberRow[]) {
  const groups = new Map<string, { name: string; sortOrder: number; members: KitMemberRow[] }>()
  for (const member of members) {
    const group = groups.get(member.category.id) ?? { name: member.category.name, sortOrder: member.category.sortOrder, members: [] }
    group.members.push(member)
    groups.set(member.category.id, group)
  }
  return [...groups.entries()].sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[1].name.localeCompare(b[1].name))
}

/**
 * The Equipment tab: what the booking will contain - the kit's current
 * composition, read-only, with the readiness verdict. The handover
 * inspection itself is Phase 8.
 */
export function BookingEquipment({ kit, readiness, canReadAssets }: { kit: KitDetail | null; readiness: KitAvailability | null; canReadAssets: boolean }) {
  if (!kit) {
    return <EmptyState icon={Boxes} title="Kit not available" description="The kit for this booking could not be loaded." />
  }
  const flagged = new Map((readiness?.reasons ?? []).filter((reason) => reason.assetId).map((reason) => [reason.assetId as string, reason]))
  const groups = groupByCategory(kit.members)

  return (
    <div className="space-y-4">
      {readiness ? <AvailabilityNotice availability={readiness} /> : null}
      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h3 className="font-display text-[15px] font-semibold text-foreground">
            Equipment in kit <span className="font-mono text-accent-foreground">{kit.kitCode}</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {kit.members.length} {kit.members.length === 1 ? 'item' : 'items'} as the kit stands today; the handover inspection records what actually leaves.
          </p>
        </header>
        {kit.members.length === 0 ? (
          <EmptyState compact icon={Boxes} title="The kit is empty" description="Add equipment to the kit before handing it over." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={TH}>Asset code</th>
                  <th scope="col" className={TH}>Equipment</th>
                  <th scope="col" className={TH}>Slot</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>Serial number</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>Accessories</th>
                </tr>
              </thead>
              {groups.map(([categoryId, group]) => (
                <tbody key={categoryId}>
                  <tr className="border-t border-line bg-panel-header/60">
                    <th scope="rowgroup" colSpan={6} className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-foreground">
                      {group.name}
                      <span className="ml-2 font-normal tracking-normal text-subtle">{group.members.length}</span>
                    </th>
                  </tr>
                  {group.members.map((member) => {
                    const reason = flagged.get(member.assetId)
                    return (
                      <tr key={member.kitAssetId} className={reason ? 'border-t border-line bg-amber-50/40 dark:bg-amber-400/5' : 'border-t border-line'}>
                        <td className={TD}>
                          {canReadAssets ? (
                            <Link href={`/assets/${member.assetId}`} className="font-mono text-xs font-semibold text-accent-foreground hover:underline">
                              {member.assetCode}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs font-semibold text-foreground">{member.assetCode}</span>
                          )}
                          <p className="mt-1">{member.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</p>
                        </td>
                        <td className={`${TD} max-w-[18rem]`}>
                          <p className="truncate font-medium text-foreground">{member.name}</p>
                          <p className="truncate text-xs text-muted">{[member.manufacturer, member.model].filter(Boolean).join(' ') || '—'}</p>
                        </td>
                        <td className={`${TD} text-foreground`}>{member.slotLabel ?? <span className="text-subtle">—</span>}</td>
                        <td className={`${TD} hidden font-mono text-xs text-foreground lg:table-cell`}>{member.serialNumber ?? <span className="text-subtle">—</span>}</td>
                        <td className={TD}>
                          <span className="flex flex-col items-start gap-1">
                            <AssetStatusBadge status={member.status} />
                            {reason ? <span className="text-xs text-amber-800 dark:text-amber-300">{reason.reason.replace(`${member.assetCode} `, '')}</span> : null}
                          </span>
                        </td>
                        <td className={`${TD} hidden text-xs text-muted md:table-cell`}>
                          {member.accessories.length === 0 ? 'None' : member.accessories.map((accessory) => accessory.label ?? accessory.typeName).join(', ')}
                        </td>
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
