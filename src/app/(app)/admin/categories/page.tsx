import { Plus, Tags } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { CategoryActiveToggle } from '@/features/admin/components/category-active-toggle'
import { CategoryForm, type CategoryFormValues } from '@/features/admin/components/category-form'
import { formatDate } from '@/lib/datetime'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { listCategories } from '@/server/dal/catalogue.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Categories' }

export const dynamic = 'force-dynamic'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Equipment categories: list, create, edit, activate / deactivate. Categories
 * are never deleted while equipment references them - deactivation removes
 * them from the pickers and nothing else.
 */
export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requirePermissionForPage('admin.categories.manage')
  const editing = first((await searchParams).category) ?? null
  const categories = await listCategories(prisma, { includeInactive: true })

  const editingRow = editing && editing !== 'new' ? categories.find((category) => category.id === editing) ?? null : null
  const formValues: CategoryFormValues | null =
    editing === 'new'
      ? { name: '', code: '', description: '', icon: '', sortOrder: categories.length }
      : editingRow
        ? {
            id: editingRow.id,
            name: editingRow.name,
            code: editingRow.code,
            description: editingRow.description ?? '',
            icon: editingRow.icon ?? '',
            sortOrder: editingRow.sortOrder,
          }
        : null

  return (
    <>
      <PageHeader
        eyebrow="Administration / Categories"
        title="Categories"
        description="Equipment categories drive grouping, filters and the handover form. Deactivate rather than delete; existing equipment keeps its category."
        actions={
          editing !== 'new' ? (
            <Link href="/admin/categories?category=new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              New category
            </Link>
          ) : null
        }
        tabs={<AdminTabs actor={actor} active="/admin/categories" />}
      />

      <div className="space-y-4">
        {formValues ? <CategoryForm values={formValues} cancelHref="/admin/categories" /> : null}

        <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          {categories.length === 0 ? (
            <EmptyState icon={Tags} title="No categories yet" description="Create the first category to start recording equipment." action={{ href: '/admin/categories?category=new', label: 'New category' }} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Code</th>
                    <th scope="col" className={TH}>Name</th>
                    <th scope="col" className={`${TH} hidden lg:table-cell`}>Description</th>
                    <th scope="col" className={`${TH} text-right`}>Order</th>
                    <th scope="col" className={`${TH} text-right`}>Equipment</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>Updated</th>
                    <th scope="col" className={`${TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id} className="border-t border-line transition-colors hover:bg-panel-header">
                      <td className={`${TD} font-mono text-xs text-accent-foreground`}>{category.code}</td>
                      <td className={`${TD} font-medium text-foreground`}>{category.name}</td>
                      <td className={`${TD} hidden max-w-md truncate text-muted lg:table-cell`}>{category.description ?? <span className="text-subtle">—</span>}</td>
                      <td className={`${TD} text-right tabular-nums text-foreground`}>{category.sortOrder}</td>
                      <td className={`${TD} text-right tabular-nums text-foreground`}>
                        {category.assetCount > 0 ? (
                          <Link href={`/assets?category=${category.id}`} className="text-accent-foreground hover:underline">
                            {category.assetCount}
                          </Link>
                        ) : (
                          0
                        )}
                      </td>
                      <td className={TD}>{category.isActive ? <Badge tone="green" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>}</td>
                      <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted md:table-cell`}>{formatDate(category.updatedAt, env.APP_TIMEZONE)}</td>
                      <td className={`${TD} text-right`}>
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/admin/categories?category=${category.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                            Edit
                          </Link>
                          <CategoryActiveToggle id={category.id} isActive={category.isActive} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
