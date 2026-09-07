import type { NextRequest } from 'next/server'

import { forbiddenResponse, unauthorizedResponse } from '@/server/auth/api'
import { ForbiddenError, isAuthorizationError, isServiceUnavailableError } from '@/server/auth/errors'
import { requirePermission } from '@/server/auth/session'
import { prisma } from '@/server/db/prisma'
import { runReportCsv } from '@/server/services/reports.service'

/**
 * A report as a CSV download.
 *
 * The same authorisation as the page - `report.read` plus whatever the report
 * itself needs - and the same scope, so an editor exporting a booking report
 * gets their own bookings and nobody else's. A report id that does not exist
 * is reported as forbidden, exactly like one the caller may not run, so the
 * URL cannot be used to enumerate reports.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ report: string }> }): Promise<Response> {
  const { report } = await context.params

  let actor
  try {
    actor = await requirePermission('report.read')
  } catch (error) {
    if (isAuthorizationError(error)) return error.status === 401 ? unauthorizedResponse() : forbiddenResponse()
    if (isServiceUnavailableError(error)) {
      return Response.json(
        { error: 'unavailable', message: 'The service is temporarily unavailable. Please try again in a moment.' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
      )
    }
    throw error
  }

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries())

  let file
  try {
    file = await runReportCsv(prisma, actor, report, raw)
  } catch (error) {
    if (error instanceof ForbiddenError) return forbiddenResponse()
    throw error
  }

  return new Response(file.body, {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
