import { Search, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'

import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils/cn'
import type { ReportQuery } from '@/server/reports/filters'
import type { ReportDefinition } from '@/server/reports/types'

/**
 * The filter bar, built from the filters the report declares.
 *
 * A plain GET form, so every state of every report is a URL that can be
 * bookmarked, shared and exported. Filtering happens on the server; this only
 * decides which controls to draw.
 */
export function ReportFilters({
  report,
  query,
  kits,
  editors,
}: {
  report: ReportDefinition
  query: ReportQuery
  kits: Array<{ id: string; label: string }>
  editors: Array<{ id: string; label: string }>
}) {
  const has = (key: string) => report.filters.includes(key as never)
  const active = Boolean(query.search || query.from || query.to || query.status || query.kitId || query.editorId || query.severity)

  return (
    <form method="get" action={`/reports/${report.id}`} className="theme-transition rounded-panel border border-line bg-panel px-5 py-4">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
        <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
        Filters
      </p>

      <div className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-4">
        {has('search') ? (
          <FormField label="Search" htmlFor="report-search" className="xl:col-span-2">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input id="report-search" type="search" name="search" defaultValue={query.search ?? ''} autoComplete="off" placeholder="Code, name, number…" className="h-11 pl-9" />
            </div>
          </FormField>
        ) : null}

        {has('from') ? (
          <FormField label="From" htmlFor="report-from">
            <Input id="report-from" type="date" name="from" defaultValue={query.from ?? ''} className="h-11" />
          </FormField>
        ) : null}

        {has('to') ? (
          <FormField label="To" htmlFor="report-to" hint="Includes the whole of that day.">
            <Input id="report-to" type="date" name="to" defaultValue={query.to ?? ''} className="h-11" />
          </FormField>
        ) : null}

        {has('status') && report.statusOptions ? (
          <FormField label="Status" htmlFor="report-status">
            <Select id="report-status" name="status" defaultValue={query.status ?? ''} className="h-11">
              <option value="">Any</option>
              {report.statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        {has('severity') ? (
          <FormField label="Severity" htmlFor="report-severity">
            <Select id="report-severity" name="severity" defaultValue={query.severity ?? ''} className="h-11">
              <option value="">Any</option>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((severity) => (
                <option key={severity} value={severity}>
                  {severity.toLowerCase()}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        {has('kitId') && kits.length > 0 ? (
          <FormField label="Kit" htmlFor="report-kit">
            <Select id="report-kit" name="kitId" defaultValue={query.kitId ?? ''} className="h-11">
              <option value="">Any kit</option>
              {kits.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        {has('editorId') && editors.length > 0 ? (
          <FormField label="Editor" htmlFor="report-editor">
            <Select id="report-editor" name="editorId" defaultValue={query.editorId ?? ''} className="h-11">
              <option value="">Any editor</option>
              {editors.map((editor) => (
                <option key={editor.id} value={editor.id}>
                  {editor.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" size="lg">
            Apply
          </Button>
          {active ? (
            <Link href={`/reports/${report.id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'whitespace-nowrap')}>
              Clear
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  )
}
