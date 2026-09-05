import { type AssetListParams, DEFAULT_PAGE_SIZE } from '@/lib/validation/assets'

/**
 * URL for the equipment list with some parameters changed. Defaults are
 * omitted so links stay short; changing anything but the page resets to page 1.
 */
export function assetsHref(params: AssetListParams, overrides: Partial<AssetListParams> = {}): string {
  const next: AssetListParams = { ...params, ...overrides }
  const resetPage = Object.keys(overrides).some((key) => key !== 'page')
  const search = new URLSearchParams()

  if (next.q) search.set('q', next.q)
  if (next.category) search.set('category', next.category)
  if (next.view !== 'all') search.set('view', next.view)
  if (next.assignment !== 'all') search.set('assignment', next.assignment)
  if (next.sort !== 'assetCode') search.set('sort', next.sort)
  if (next.dir !== 'asc') search.set('dir', next.dir)
  if (next.pageSize !== DEFAULT_PAGE_SIZE) search.set('pageSize', String(next.pageSize))
  const page = resetPage ? 1 : next.page
  if (page > 1) search.set('page', String(page))

  const encoded = search.toString()
  return encoded ? `/assets?${encoded}` : '/assets'
}
