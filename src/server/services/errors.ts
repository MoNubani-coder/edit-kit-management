/**
 * Business-rule failures raised by services.
 *
 * Framework-free so services stay unit-testable. The Server Action wrapper
 * (`server/auth/action.ts`) turns a DomainError into a typed `rejected` result
 * with its field errors; pages can catch `not_found` and call `notFound()`.
 */

export type DomainErrorCode = 'validation' | 'conflict' | 'lifecycle' | 'not_found'

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly fieldErrors: Record<string, string> | undefined

  constructor(code: DomainErrorCode, message: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

/**
 * Translates a Prisma unique-constraint violation (P2002) into the field it
 * concerns. Works with both shapes Prisma emits - a `target` column list or a
 * constraint name such as `assets_serialNumber_key`.
 */
export function uniqueViolationField(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; meta?: { target?: unknown; constraint?: unknown }; message?: unknown }
  if (candidate.code !== 'P2002') return null

  const target = candidate.meta?.target
  const text = Array.isArray(target)
    ? target.join(',')
    : typeof target === 'string'
      ? target
      : String(candidate.meta?.constraint ?? candidate.message ?? '')

  for (const field of ['serialNumber', 'admBarcode', 'assetCode', 'kitCode', 'staffId', 'userId', 'name', 'code']) {
    if (new RegExp(`(^|[^a-zA-Z])${field}([^a-zA-Z]|$)`, 'i').test(text)) return field
  }
  return 'unique'
}
