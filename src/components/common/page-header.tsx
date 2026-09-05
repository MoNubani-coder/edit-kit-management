import type { ReactNode } from 'react'

/**
 * Workspace header: a breadcrumb-style eyebrow ("Operations / Bookings"), a
 * display-face title with actions on the right, one line of context, and an
 * optional row of horizontal tabs sitting on the closing hairline.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  tabs,
}: {
  /** Path-like context, e.g. `Operations / Bookings`. */
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
}) {
  const crumbs = eyebrow?.split('/').map((part) => part.trim()).filter(Boolean) ?? []

  return (
    <div className={tabs ? 'mb-6' : 'mb-8 border-b border-line pb-6'}>
      {crumbs.length > 0 ? (
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden className="text-accent">/</span> : null}
              <span className={index === crumbs.length - 1 ? 'text-accent-foreground' : undefined}>{crumb}</span>
            </span>
          ))}
        </p>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight text-foreground sm:text-[32px]">
            {title}
          </h1>
          {description ? <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2 sm:pt-1">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-6">{tabs}</div> : null}
    </div>
  )
}
