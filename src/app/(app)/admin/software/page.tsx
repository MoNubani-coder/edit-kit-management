import { AppWindow, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { SoftwareActiveToggle } from '@/features/admin/components/software-active-toggle'
import { SoftwareForm, type SoftwareFormValues } from '@/features/admin/components/software-form'
import { formatDate } from '@/lib/datetime'
import { env } from '@/lib/env'
import { pageSchema, pageSizeSchema } from '@/lib/pagination'
import { first } from '@/lib/validation/admin'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { getSoftware, listSoftwarePage } from '@/server/dal/admin.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Software' }

export const dynamic = 'force-dynamic'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

/**
 * The software catalogue: the applications a kit is expected to carry.
 *
 * This is not decoration. A kit lists the applications it should have, the
 * handover snapshots that list and asks the engineer to confirm each one, and
 * a required application that is not installed blocks the handover. The
 * catalogue is where those entries come from.
 *
 * Deactivate rather than delete: kits reference an application, and completed
 * handovers recorded what was checked at the time.
 */
export default async function AdminSoftwarePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePermissionForPage('admin.software.manage')
  const query = await searchParams
  const editing = first(query.software) ?? null
  const result = await listSoftwarePage(prisma, {
    page: pageSchema.parse(first(query.page)),
    pageSize: pageSizeSchema().parse(first(query.pageSize)),
    includeInactive: true,
  })
  const applications = result.rows
  const hrefFor = (page: number) => {
    const search = new URLSearchParams()
    if (editing) search.set('software', editing)
    if (page > 1) search.set('page', String(page))
    if (result.pageSize !== 25) search.set('pageSize', String(result.pageSize))
    const text = search.toString()
    return text ? `/admin/software?${text}` : '/admin/software'
  }

  // The row being edited may sit on another page; read it directly.
  const editingRow = editing && editing !== 'new' ? await getSoftware(prisma, editing) : null
  const formValues: SoftwareFormValues | null =
    editing === 'new'
      ? { name: '', vendor: '', version: '', licenseType: '', notes: '', sortOrder: result.total }
      : editingRow
        ? {
            id: editingRow.id,
            name: editingRow.name,
            vendor: editingRow.vendor ?? '',
            version: editingRow.version ?? '',
            licenseType: editingRow.licenseType ?? '',
            notes: editingRow.notes ?? '',
            sortOrder: editingRow.sortOrder,
          }
        : null

  return (
    <>
      <PageHeader
        eyebrow="Administration / Software"
        title="Software"
        description="Applications kits are expected to carry. A required application that is not installed blocks a handover, so what is listed here is what an engineer has to confirm."
        actions={
          editing !== 'new' ? (
            <Link href="/admin/software?software=new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              New application
            </Link>
          ) : null
        }
        tabs={<AdminTabs actor={actor} active="/admin/software" />}
      />

      <div className="space-y-4">
        {formValues ? <SoftwareForm values={formValues} cancelHref="/admin/software" /> : null}

        <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          {applications.length === 0 ? (
            <EmptyState
              icon={AppWindow}
              title="No applications yet"
              description="Add the applications your kits are expected to carry; they then appear on each kit and in every handover."
              action={{ href: '/admin/software?software=new', label: 'New application' }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-sm">
                <thead className="border-b border-line bg-panel-header">
                  <tr>
                    <th scope="col" className={TH}>Application</th>
                    <th scope="col" className={TH}>Vendor</th>
                    <th scope="col" className={TH}>Licence</th>
                    <th scope="col" className={`${TH} text-right`}>On kits</th>
                    <th scope="col" className={`${TH} text-right`}>Order</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>Updated</th>
                    <th scope="col" className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {applications.map((application) => (
                    <tr key={application.id} className="transition-colors hover:bg-panel-header/60">
                      <td className={TD}>
                        <span className="block font-medium text-foreground">{application.name}</span>
                        {application.version ? <span className="block font-mono text-[11px] text-muted">{application.version}</span> : null}
                        {application.notes ? <span className="mt-0.5 block max-w-md truncate text-xs text-subtle">{application.notes}</span> : null}
                      </td>
                      <td className={`${TD} text-muted`}>{application.vendor ?? <span className="text-subtle">—</span>}</td>
                      <td className={`${TD} text-muted`}>{application.licenseType ?? <span className="text-subtle">—</span>}</td>
                      <td className={`${TD} text-right tabular-nums text-foreground`}>
                        {application.kitCount}
                        {application.requiredKitCount > 0 ? <span className="block text-[11px] font-normal text-subtle">{application.requiredKitCount} required</span> : null}
                      </td>
                      <td className={`${TD} text-right tabular-nums text-foreground`}>{application.sortOrder}</td>
                      <td className={TD}>
                        {application.isActive ? (
                          <Badge tone="green" dot>
                            Active
                          </Badge>
                        ) : (
                          <Badge tone="neutral" dot>
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted md:table-cell`}>{formatDate(application.updatedAt, env.APP_TIMEZONE)}</td>
                      <td className={`${TD} text-right`}>
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/admin/software?software=${application.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                            Edit
                          </Link>
                          <SoftwareActiveToggle id={application.id} isActive={application.isActive} />
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
      </div>
    </>
  )
}
