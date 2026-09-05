import { ClipboardList } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { Badge } from '@/components/ui/badge'
import type { ChecklistTemplateItemRow, ChecklistTemplateOption } from '@/server/dal/catalogue.dal'
import type { KitChecklistSummary } from '@/server/dal/kits.dal'

import { ChecklistForm } from './checklist-form'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

const PHASE_LABEL: Record<ChecklistTemplateItemRow['phase'], string> = {
  HANDOVER: 'Handover',
  RETURN: 'Return',
  BOTH: 'Handover and return',
}

/**
 * Which checklist template new bookings of this kit start from. The template
 * is copied into each booking when it is created, so changing it here never
 * alters a booking that already exists.
 */
export function ChecklistPanel({
  kitId,
  template,
  fallback,
  items,
  options,
  canManage,
}: {
  kitId: string
  /** The kit's own template, or null when the system default applies. */
  template: KitChecklistSummary | null
  /** The system default template, shown when the kit has none of its own. */
  fallback: ChecklistTemplateOption | null
  items: ChecklistTemplateItemRow[]
  options: ChecklistTemplateOption[]
  canManage: boolean
}) {
  const effective = template ?? fallback
  const usingDefault = template === null

  return (
    <div className="space-y-4">
      {canManage ? <ChecklistForm kitId={kitId} templateId={template?.id ?? ''} options={options} /> : null}

      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-panel-header px-5 py-3">
          <div>
            <h3 className="font-display text-[15px] font-semibold text-foreground">
              Handover checklist{effective ? `: ${effective.name}` : ''}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {effective
                ? `${effective.itemCount} checks · version ${effective.version}${effective.description ? ` · ${effective.description}` : ''}`
                : 'No checklist template is assigned and no system default exists.'}
            </p>
          </div>
          <span className="flex items-center gap-2">
            {usingDefault && effective ? <Badge tone="neutral">System default</Badge> : template ? <Badge tone="blue">Kit specific</Badge> : null}
            {effective && !effective.isActive ? <Badge tone="amber">Inactive template</Badge> : null}
          </span>
        </header>

        {items.length === 0 ? (
          <EmptyState compact icon={ClipboardList} title="No checks to show" description="Checklist templates are maintained under Administration › Checklist Templates." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={`${TH} w-12`}>#</th>
                  <th scope="col" className={TH}>Check</th>
                  <th scope="col" className={TH}>Phase</th>
                  <th scope="col" className={TH}>Required</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className={`${TD} tabular-nums text-subtle`}>{index + 1}</td>
                    <td className={TD}>
                      <p className="font-medium text-foreground">{item.label}</p>
                      {item.description ? <p className="text-xs text-muted">{item.description}</p> : null}
                    </td>
                    <td className={`${TD} text-foreground`}>{PHASE_LABEL[item.phase]}</td>
                    <td className={TD}>{item.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</td>
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
