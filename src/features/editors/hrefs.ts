import { EDITOR_DEFAULT_PAGE_SIZE, type EditorListParams, type EditorTab } from '@/lib/validation/editors'

/** URL for the editor list with some parameters changed; defaults are omitted. */
export function editorsHref(params: EditorListParams, overrides: Partial<EditorListParams> = {}): string {
  const next: EditorListParams = { ...params, ...overrides }
  const resetPage = Object.keys(overrides).some((key) => key !== 'page')
  const search = new URLSearchParams()

  if (next.q) search.set('q', next.q)
  if (next.view !== 'all') search.set('view', next.view)
  if (next.sort !== 'fullName') search.set('sort', next.sort)
  if (next.dir !== 'asc') search.set('dir', next.dir)
  if (next.pageSize !== EDITOR_DEFAULT_PAGE_SIZE) search.set('pageSize', String(next.pageSize))
  const page = resetPage ? 1 : next.page
  if (page > 1) search.set('page', String(page))

  const encoded = search.toString()
  return encoded ? `/editors?${encoded}` : '/editors'
}

/** URL for one editor workspace tab. */
export function editorHref(id: string, tab: EditorTab = 'overview', extra: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams()
  if (tab !== 'overview') search.set('tab', tab)
  for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value)
  const encoded = search.toString()
  return encoded ? `/editors/${id}?${encoded}` : `/editors/${id}`
}
