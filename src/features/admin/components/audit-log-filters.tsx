import { Search, X } from 'lucide-react'
import Link from 'next/link'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_ENTITY_LABELS,
  AUDIT_ENTITY_TYPES,
  AUDIT_GROUP_LABELS,
  AUDIT_GROUPS,
  type AuditListParams,
} from '@/lib/validation/audit'
import type { AuditActorOption } from '@/server/dal/audit.dal'

/**
 * The filter bar: a GET form, so every view the page can show is a URL that
 * can be bookmarked, shared with whoever asked the question, and read back
 * from the address bar. Nothing here mutates anything - the log cannot be
 * changed from this page or any other.
 */
export function AuditLogFilters({ params, actors, filtered }: { params: AuditListParams; actors: AuditActorOption[]; filtered: boolean }) {
  const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'

  return (
    <form method="get" action="/admin/audit-logs" className="theme-transition rounded-panel border border-line bg-panel p-4">
      {/* Paging restarts whenever the question changes. */}
      <input type="hidden" name="page" value="1" />
      {params.sort !== 'createdAt' ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {params.dir !== 'desc' ? <input type="hidden" name="dir" value={params.dir} /> : null}
      {params.pageSize !== AUDIT_DEFAULT_PAGE_SIZE ? <input type="hidden" name="pageSize" value={params.pageSize} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="audit-q">
            Search
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input id="audit-q" name="q" type="search" defaultValue={params.q ?? ''} autoComplete="off" placeholder="What happened, or who did it…" className="pl-9" />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="audit-group">
            Area
          </label>
          <Select id="audit-group" name="group" defaultValue={params.group}>
            {AUDIT_GROUPS.map((group) => (
              <option key={group} value={group}>
                {AUDIT_GROUP_LABELS[group]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className={label} htmlFor="audit-action">
            Action
          </label>
          <Select id="audit-action" name="action" defaultValue={params.action ?? ''}>
            <option value="">Any action</option>
            {[...AUDIT_ACTIONS]
              .sort((a, b) => AUDIT_ACTION_LABELS[a].localeCompare(AUDIT_ACTION_LABELS[b]))
              .map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_LABELS[action]}
                </option>
              ))}
          </Select>
        </div>

        <div>
          <label className={label} htmlFor="audit-actor">
            Who
          </label>
          <Select id="audit-actor" name="actorId" defaultValue={params.actorId ?? ''}>
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className={label} htmlFor="audit-entity">
            About
          </label>
          <Select id="audit-entity" name="entityType" defaultValue={params.entityType ?? ''}>
            <option value="">Anything</option>
            {AUDIT_ENTITY_TYPES.map((entity) => (
              <option key={entity} value={entity}>
                {AUDIT_ENTITY_LABELS[entity]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className={label} htmlFor="audit-from">
            From
          </label>
          <Input id="audit-from" name="from" type="date" defaultValue={params.from ?? ''} />
        </div>

        <div>
          <label className={label} htmlFor="audit-to">
            To
          </label>
          <Input id="audit-to" name="to" type="date" defaultValue={params.to ?? ''} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">
          Apply
        </Button>
        {filtered ? (
          <Link href="/admin/audit-logs" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <X aria-hidden className="h-4 w-4" />
            Clear
          </Link>
        ) : null}
        <p className="ml-auto text-xs text-muted">The log is append-only. Nothing on this page can change it.</p>
      </div>
    </form>
  )
}
