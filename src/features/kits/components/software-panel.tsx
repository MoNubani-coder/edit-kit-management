import { AppWindow } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { Badge } from '@/components/ui/badge'
import type { SoftwareApplicationOption } from '@/server/dal/catalogue.dal'
import type { KitSoftwareRow } from '@/server/dal/kits.dal'

import { AddSoftwareForm, RemoveSoftwareForm } from './software-forms'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

/**
 * Software the kit is expected to carry. Configuration only: whether each
 * application is actually installed is checked at handover, not here.
 */
export function SoftwarePanel({
  kitId,
  software,
  options,
  canManage,
}: {
  kitId: string
  software: KitSoftwareRow[]
  /** Applications not yet on the kit; empty when the actor cannot manage. */
  options: SoftwareApplicationOption[]
  canManage: boolean
}) {
  const listed = new Set(software.map((row) => row.software.id))
  const available = options.filter((option) => !listed.has(option.id))

  return (
    <div className="space-y-4">
      {canManage ? <AddSoftwareForm kitId={kitId} options={available} /> : null}

      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h3 className="font-display text-[15px] font-semibold text-foreground">Software expected on this kit</h3>
          <p className="mt-0.5 text-xs text-muted">Checked application by application at every handover. Required entries must be present for the handover to complete.</p>
        </header>
        {software.length === 0 ? (
          <EmptyState compact icon={AppWindow} title="No software listed" description="Applications the editor should find installed on the workstation go here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={TH}>Application</th>
                  <th scope="col" className={TH}>Version</th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>Vendor</th>
                  <th scope="col" className={TH}>Requirement</th>
                  {canManage ? <th scope="col" className={`${TH} text-right`}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {software.map((row) => (
                  <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                    <td className={`${TD} font-medium text-foreground`}>
                      {row.software.name}
                      {!row.software.isActive ? (
                        <Badge tone="neutral" className="ml-2">
                          Inactive application
                        </Badge>
                      ) : null}
                    </td>
                    <td className={`${TD} font-mono text-xs text-foreground`}>{row.software.version ?? <span className="text-subtle">any</span>}</td>
                    <td className={`${TD} hidden text-foreground md:table-cell`}>{row.software.vendor ?? <span className="text-subtle">—</span>}</td>
                    <td className={TD}>{row.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</td>
                    {canManage ? (
                      <td className={`${TD} text-right`}>
                        <RemoveSoftwareForm kitSoftwareId={row.id} label={row.software.version ? `${row.software.name} ${row.software.version}` : row.software.name} />
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
