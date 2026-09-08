import { Search, Users, X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { SectionTabs } from '@/components/common/section-tabs'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { UserRoleControl, UserStatusControl, UserUnlockControl } from '@/features/admin/components/user-row-actions'
import { ROLE_LABELS } from '@/lib/constants/roles'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { env } from '@/lib/env'
import { USER_FILTER_LABELS, USER_FILTERS, USER_ROLES, USER_STATUS_LABELS, type UserStatusValue, parseUserListParams, usersHref } from '@/lib/validation/admin'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { countUsersByFilter, listUsersPage } from '@/server/dal/admin.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Users' }

export const dynamic = 'force-dynamic'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

const STATUS_TONES: Record<UserStatusValue, 'green' | 'amber' | 'red' | 'neutral'> = {
  ACTIVE: 'green',
  INVITED: 'amber',
  SUSPENDED: 'red',
  DISABLED: 'neutral',
}

/**
 * Accounts: who can sign in, as what, and whether they are locked out.
 *
 * The three things this page does - change a role, suspend or reinstate, clear
 * a lockout - all revoke the target's sessions on the server, so each takes
 * effect on their next request rather than whenever they next sign in.
 *
 * Two things it deliberately does not do. It does not create accounts, because
 * an account without a password is an invitation and how that invitation
 * reaches somebody is a decision this system has not made yet. It does not set
 * passwords, for the same reason; `npm run auth:reset-password` remains the
 * break-glass path and revokes sessions as it goes. Both are stated on the
 * page rather than left as absent buttons somebody has to guess about.
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePermissionForPage('admin.users.manage')
  const params = parseUserListParams(await searchParams)
  const now = new Date()

  const [result, counts] = await Promise.all([listUsersPage(prisma, params, now), countUsersByFilter(prisma, now)])
  const filtered = Boolean(params.q || params.role || params.filter !== 'all')

  const tabs = USER_FILTERS.map((filter) => ({
    key: filter,
    label: USER_FILTER_LABELS[filter],
    href: usersHref(params, { filter, page: 1 }),
    count: counts[filter],
  }))

  return (
    <>
      <PageHeader
        eyebrow="Administration / Users"
        title="Users"
        description="Accounts, roles and lockouts. A role change or a suspension ends every session that account holds."
        tabs={<AdminTabs actor={actor} active="/admin/users" />}
      />

      <div className="space-y-4">
        <SectionTabs tabs={tabs} active={params.filter} label="Account filters" />

        <Alert variant="info" title="Passwords and new accounts">
          Accounts are created and passwords are set from the command line, with <code className="font-mono text-xs">npm run auth:reset-password</code>, which also signs the
          account out everywhere. That path is deliberate: it keeps the decision about how a password reaches somebody out of the browser.
        </Alert>

        <form method="get" action="/admin/users" className="theme-transition flex flex-wrap items-end gap-3 rounded-panel border border-line bg-panel p-4">
          {params.filter !== 'all' ? <input type="hidden" name="filter" value={params.filter} /> : null}
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle" htmlFor="user-q">
              Search
            </label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input id="user-q" name="q" type="search" defaultValue={params.q ?? ''} autoComplete="off" placeholder="Name, email or staff ID…" className="pl-9" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle" htmlFor="user-role">
              Role
            </label>
            <Select id="user-role" name="role" defaultValue={params.role ?? ''} className="w-44">
              <option value="">Any role</option>
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm">
            Apply
          </Button>
          {filtered ? (
            <Link href="/admin/users" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <X aria-hidden className="h-4 w-4" />
              Clear
            </Link>
          ) : null}
        </form>

        <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          {result.rows.length === 0 ? (
            <EmptyState icon={Users} title={filtered ? 'No accounts match' : 'No accounts'} description={filtered ? 'Try another filter or search.' : 'Seed the database or create an account from the command line.'} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[70rem] border-collapse text-sm">
                  <thead className="border-b border-line bg-panel-header">
                    <tr>
                      <th scope="col" className={TH}>
                        <Link href={usersHref(params, { sort: 'name', dir: params.sort === 'name' && params.dir === 'asc' ? 'desc' : 'asc', page: 1 })} className="hover:text-foreground">
                          Account
                        </Link>
                      </th>
                      <th scope="col" className={TH}>Linked profile</th>
                      <th scope="col" className={TH}>Role</th>
                      <th scope="col" className={TH}>Status</th>
                      <th scope="col" className={TH}>Sign-in</th>
                      <th scope="col" className={`${TH} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.rows.map((row) => {
                      const isSelf = row.id === actor.id
                      const locked = row.lockedUntil !== null && row.lockedUntil > now
                      return (
                        <tr key={row.id} className="transition-colors hover:bg-panel-header/60">
                          <td className={TD}>
                            <span className="block font-medium text-foreground">
                              {row.name}
                              {isSelf ? <span className="ml-2 text-xs font-normal text-subtle">you</span> : null}
                            </span>
                            <span className="block text-xs text-muted">{row.email}</span>
                            {row.staffId ? <span className="block font-mono text-[11px] text-subtle">{row.staffId}</span> : null}
                          </td>
                          <td className={`${TD} text-xs text-muted`}>
                            {row.editorProfileId ? (
                              <Link href={`/editors/${row.editorProfileId}`} className="text-accent-foreground hover:underline">
                                Editor · {row.editorName}
                              </Link>
                            ) : null}
                            {row.engineerName ? <span className="block">Engineer · {row.engineerName}</span> : null}
                            {!row.editorProfileId && !row.engineerName ? <span className="text-subtle">—</span> : null}
                          </td>
                          <td className={TD}>
                            <UserRoleControl userId={row.id} role={row.role} disabled={isSelf} disabledReason="You cannot change your own role." />
                          </td>
                          <td className={TD}>
                            <Badge tone={STATUS_TONES[row.status]} dot>
                              {USER_STATUS_LABELS[row.status]}
                            </Badge>
                            {locked ? (
                              <span className="mt-1 block text-[11px] text-rose-600 dark:text-rose-300">Locked until {formatDateTime(row.lockedUntil!, env.APP_TIMEZONE)}</span>
                            ) : null}
                            {!row.hasPassword ? <span className="mt-1 block text-[11px] text-subtle">No password set</span> : null}
                            {row.mustChangePassword ? <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">Must change password</span> : null}
                          </td>
                          <td className={`${TD} text-xs text-muted`}>
                            {row.lastLoginAt ? (
                              <>
                                <span className="block tabular-nums">{formatDateTime(row.lastLoginAt, env.APP_TIMEZONE)}</span>
                                {row.failedLoginAttempts > 0 ? <span className="block text-[11px] text-amber-700 dark:text-amber-300">{row.failedLoginAttempts} failed since</span> : null}
                              </>
                            ) : (
                              <span className="text-subtle">Never · created {formatDate(row.createdAt, env.APP_TIMEZONE)}</span>
                            )}
                          </td>
                          <td className={`${TD} text-right`}>
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {locked ? <UserUnlockControl userId={row.id} /> : null}
                              <UserStatusControl userId={row.id} status={row.status} disabled={isSelf} disabledReason={isSelf ? 'You cannot suspend your own account.' : undefined} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={(page) => usersHref(params, { page })} />
            </>
          )}
        </div>
      </div>
    </>
  )
}
