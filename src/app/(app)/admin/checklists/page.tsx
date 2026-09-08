import { ClipboardCheck, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import {
  ChecklistItemForm,
  ChecklistItemRemoveButton,
  ChecklistTemplateForm,
  type ItemFormValues,
  TemplateActiveToggle,
  TemplateDefaultButton,
  type TemplateFormValues,
} from '@/features/admin/components/checklist-forms'
import { formatDate } from '@/lib/datetime'
import { env } from '@/lib/env'
import { pageSchema, pageSizeSchema } from '@/lib/pagination'
import { CHECKLIST_PHASE_LABELS, type ChecklistPhaseValue, first } from '@/lib/validation/admin'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { getChecklistTemplate, listChecklistTemplatesPage } from '@/server/dal/admin.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Checklist Templates' }

export const dynamic = 'force-dynamic'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

/**
 * Checklist templates: the checks a handover and a return ask an engineer to
 * make.
 *
 * The templates are live, not decorative. A kit can name a default template, a
 * booking takes one, and when the handover starts the booking copies the
 * template's items - so the copy is that booking's own record and editing the
 * template afterwards cannot rewrite what somebody signed. That is also why a
 * check which has already been copied cannot be removed, only edited.
 *
 * One template is the default, which is what a booking gets when its kit names
 * none. Deactivating the default is refused until another one takes over.
 */
export default async function AdminChecklistTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePermissionForPage('admin.checklists.manage')
  const query = await searchParams
  const selected = first(query.template) ?? null
  const editingTemplate = first(query.edit) ?? null
  const editingItem = first(query.item) ?? null
  const addingItem = first(query.add) === 'item'

  const result = await listChecklistTemplatesPage(prisma, {
    page: pageSchema.parse(first(query.page)),
    pageSize: pageSizeSchema().parse(first(query.pageSize)),
    includeInactive: true,
  })
  const templates = result.rows
  const hrefFor = (page: number) => {
    const search = new URLSearchParams()
    if (selected) search.set('template', selected)
    if (page > 1) search.set('page', String(page))
    if (result.pageSize !== 25) search.set('pageSize', String(result.pageSize))
    const text = search.toString()
    return text ? `/admin/checklists?${text}` : '/admin/checklists'
  }
  const detail = selected && selected !== 'new' ? await getChecklistTemplate(prisma, selected) : null

  const templateFormValues: TemplateFormValues | null =
    selected === 'new'
      ? { name: '', description: '' }
      : editingTemplate && detail
        ? { id: detail.id, name: detail.name, description: detail.description ?? '' }
        : null

  const itemBeingEdited = editingItem && detail ? detail.items.find((item) => item.id === editingItem) ?? null : null
  const itemFormValues: ItemFormValues | null = detail
    ? itemBeingEdited
      ? {
          itemId: itemBeingEdited.id,
          templateId: detail.id,
          label: itemBeingEdited.label,
          description: itemBeingEdited.description ?? '',
          phase: itemBeingEdited.phase as ChecklistPhaseValue,
          isRequired: itemBeingEdited.isRequired,
          sortOrder: itemBeingEdited.sortOrder,
        }
      : addingItem
        ? { templateId: detail.id, label: '', description: '', phase: 'BOTH', isRequired: true, sortOrder: detail.items.length }
        : null
    : null

  const templateHref = (id: string) => `/admin/checklists?template=${id}`

  return (
    <>
      <PageHeader
        eyebrow="Administration / Checklist Templates"
        title="Checklist Templates"
        description="The checks a handover and a return ask for. A booking copies its template when the handover starts, so editing a template never changes a record that has already been signed."
        actions={
          selected !== 'new' ? (
            <Link href="/admin/checklists?template=new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              New template
            </Link>
          ) : null
        }
        tabs={<AdminTabs actor={actor} active="/admin/checklists" />}
      />

      <div className="space-y-4">
        {templateFormValues ? <ChecklistTemplateForm values={templateFormValues} cancelHref={detail ? templateHref(detail.id) : '/admin/checklists'} /> : null}

        <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          {templates.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No templates yet"
              description="Create a template, add the checks an engineer should make, and make it the default so every booking picks it up."
              action={{ href: '/admin/checklists?template=new', label: 'New template' }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] border-collapse text-sm">
                <thead className="border-b border-line bg-panel-header">
                  <tr>
                    <th scope="col" className={TH}>Template</th>
                    <th scope="col" className={`${TH} text-right`}>Checks</th>
                    <th scope="col" className={`${TH} text-right`}>Handover</th>
                    <th scope="col" className={`${TH} text-right`}>Return</th>
                    <th scope="col" className={`${TH} text-right`}>In use</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>Updated</th>
                    <th scope="col" className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {templates.map((template) => (
                    <tr key={template.id} className={`transition-colors hover:bg-panel-header/60 ${detail?.id === template.id ? 'bg-panel-header/40' : ''}`}>
                      <td className={TD}>
                        <Link href={templateHref(template.id)} className="block font-medium text-accent-foreground underline-offset-2 hover:underline">
                          {template.name}
                        </Link>
                        {template.description ? <span className="mt-0.5 block max-w-md truncate text-xs text-muted">{template.description}</span> : null}
                      </td>
                      <td className={`${TD} text-right tabular-nums text-foreground`}>
                        {template.itemCount}
                        {template.requiredCount > 0 ? <span className="block text-[11px] font-normal text-subtle">{template.requiredCount} required</span> : null}
                      </td>
                      <td className={`${TD} text-right tabular-nums text-muted`}>{template.handoverCount}</td>
                      <td className={`${TD} text-right tabular-nums text-muted`}>{template.returnCount}</td>
                      <td className={`${TD} text-right tabular-nums text-muted`}>
                        {template.kitCount > 0 ? <span className="block">{template.kitCount} kits</span> : null}
                        {template.bookingCount > 0 ? <span className="block">{template.bookingCount} bookings</span> : null}
                        {template.kitCount === 0 && template.bookingCount === 0 ? <span className="text-subtle">—</span> : null}
                      </td>
                      <td className={TD}>
                        <div className="flex flex-wrap items-center gap-1">
                          {template.isDefault ? (
                            <Badge tone="blue" dot>
                              Default
                            </Badge>
                          ) : null}
                          {template.isActive ? (
                            <Badge tone="green" dot>
                              Active
                            </Badge>
                          ) : (
                            <Badge tone="neutral" dot>
                              Inactive
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted md:table-cell`}>{formatDate(template.updatedAt, env.APP_TIMEZONE)}</td>
                      <td className={`${TD} text-right`}>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Link href={`${templateHref(template.id)}&edit=1`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                            Rename
                          </Link>
                          {!template.isDefault && template.isActive ? <TemplateDefaultButton id={template.id} /> : null}
                          <TemplateActiveToggle id={template.id} isActive={template.isActive} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={hrefFor} />
        </div>

        {detail ? (
          <section className="theme-transition rounded-panel border border-line bg-panel">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
              <div>
                <h2 className="font-display text-[15px] font-semibold text-foreground">{detail.name}</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {detail.itemCount} {detail.itemCount === 1 ? 'check' : 'checks'} · {detail.handoverCount} at handover · {detail.returnCount} at return
                </p>
              </div>
              {!addingItem && !itemBeingEdited ? (
                <Link href={`${templateHref(detail.id)}&add=item`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  <Plus aria-hidden className="h-4 w-4" />
                  Add check
                </Link>
              ) : null}
            </header>

            <div className="space-y-4 p-5">
              {itemFormValues ? <ChecklistItemForm values={itemFormValues} cancelHref={templateHref(detail.id)} /> : null}

              {detail.bookingCount > 0 ? (
                <Alert variant="info">
                  {detail.bookingCount} {detail.bookingCount === 1 ? 'booking has' : 'bookings have'} already used this template. Their copies are unaffected by anything changed here.
                </Alert>
              ) : null}

              {detail.items.length === 0 ? (
                <EmptyState icon={ClipboardCheck} title="No checks yet" description="Add the first check an engineer should make." action={{ href: `${templateHref(detail.id)}&add=item`, label: 'Add check' }} />
              ) : (
                <ol className="divide-y divide-line rounded-lg border border-line">
                  {detail.items.map((item, index) => (
                    <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                          <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, '0')}</span>
                          {item.label}
                          {item.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
                          <Badge tone="slate">{CHECKLIST_PHASE_LABELS[item.phase as ChecklistPhaseValue]}</Badge>
                        </p>
                        {item.description ? <p className="mt-1 text-xs text-muted">{item.description}</p> : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Link href={`${templateHref(detail.id)}&item=${item.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                          Edit
                        </Link>
                        <ChecklistItemRemoveButton itemId={item.id} used={item.usedByBookings} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}
